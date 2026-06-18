// WebBluetoothTransport.ts
//
// TypeScript port of docs/ble-manager.js behavior. Reads `navigator.bluetooth`
// (so the harness fake drives it like the legacy app). Preserves: FTMS Indoor
// Bike Data parse, HR measurement parse, ERG control (requestControl +
// startOrResume handshake, setTargetPower throttle/clamp), disconnect -> null
// sample, and the bikeSample/hrSample/bikeStatus/hrStatus/hrBattery/log events.

import type {
  TrainerTransport,
  TransportEvents,
  TransportEventType,
  BikeSample,
  TrainerState,
} from '../TrainerTransport.js';

// ---------- FTMS constants (verbatim from docs/ble-manager.js) ----------
const FTMS_SERVICE_UUID = 0x1826;
const HEART_RATE_SERVICE_UUID = 0x180d;
const BATTERY_SERVICE_UUID = 0x180f;
const INDOOR_BIKE_DATA_CHAR = 0x2ad2;
const FTMS_CONTROL_POINT_CHAR = 0x2ad9;
const HR_MEASUREMENT_CHAR = 0x2a37;
const BATTERY_LEVEL_CHAR = 0x2a19;

const FTMS_OPCODES = {
  requestControl: 0x00,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
};

const TRAINER_SEND_MIN_INTERVAL_SEC = 10;

// minimal structural typings for the Web Bluetooth surface we use
interface BtChar {
  writeValueWithResponse?(buf: BufferSource): Promise<void>;
  writeValue?(buf: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BtChar>;
  addEventListener(t: string, fn: (e: { target: { value: DataView } }) => void): void;
}
interface BtService {
  getCharacteristic(uuid: number): Promise<BtChar>;
}
interface BtServer {
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<BtService>;
}
interface BtDevice {
  id: string;
  name?: string;
  gatt: BtServer;
  addEventListener(t: string, fn: () => void): void;
}
interface BtNavigator {
  requestDevice(opts: unknown): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
}

function getBluetooth(): BtNavigator | null {
  const bt = (navigator as unknown as { bluetooth?: BtNavigator }).bluetooth;
  return bt || null;
}

export class WebBluetoothTransport implements TrainerTransport {
  private listeners: { [K in TransportEventType]: Set<(p: TransportEvents[K]) => void> } = {
    bikeSample: new Set(),
    hrSample: new Set(),
    bikeStatus: new Set(),
    hrStatus: new Set(),
    hrBattery: new Set(),
    log: new Set(),
  };

  private lastBikeSample: BikeSample = { power: null, cadence: null, speedKph: null, hrFromBike: null };

  private bikeConnected = false;
  private bikeControlPointChar: BtChar | null = null;

  private lastTrainerMode: 'erg' | 'resistance' | null = null;
  private lastErgTargetSent: number | null = null;
  private lastErgSendTs = -Infinity;
  private lastResistanceSent: number | null = null;
  private lastResistanceSendTs = -Infinity;

  private autoReconnectEnabled = true;
  private bikeDesiredDeviceId: string | null = null;
  private hrDesiredDeviceId: string | null = null;

  private nowSec(): number {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  private log(msg: string): void {
    this.emit('log', msg);
  }

  private emit<T extends TransportEventType>(type: T, payload: TransportEvents[T]): void {
    for (const fn of Array.from(this.listeners[type])) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[transport]', err);
      }
    }
  }

  on<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): () => void {
    if (!this.listeners[type]) throw new Error('Unknown event type: ' + type);
    this.listeners[type].add(fn);
    return () => this.off(type, fn);
  }

  off<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): void {
    this.listeners[type]?.delete(fn);
  }

  init(opts?: { autoReconnect?: boolean }): void {
    this.autoReconnectEnabled = opts?.autoReconnect !== false;
    if (this.autoReconnectEnabled) {
      void this.maybeReconnectSavedDevices();
    }
  }

  /** Saved-device IDs to attempt to reconnect on load (set by the composition root). */
  setSavedDeviceIds(ids: { bikeId?: string | null; hrId?: string | null }): void {
    this.bikeDesiredDeviceId = ids.bikeId || null;
    this.hrDesiredDeviceId = ids.hrId || null;
  }

  private async maybeReconnectSavedDevices(): Promise<void> {
    const bt = getBluetooth();
    if (!bt || !bt.getDevices) return;
    let devices: BtDevice[] = [];
    try {
      devices = await bt.getDevices();
    } catch {
      return;
    }
    if (this.bikeDesiredDeviceId) {
      const dev = devices.find((d) => d.id === this.bikeDesiredDeviceId);
      if (dev) {
        try {
          await this.connectToBike(dev);
        } catch (err) {
          this.log('Auto-reconnect bike failed: ' + err);
        }
      }
    }
    if (this.hrDesiredDeviceId) {
      const dev = devices.find((d) => d.id === this.hrDesiredDeviceId);
      if (dev) {
        try {
          await this.connectToHr(dev);
        } catch (err) {
          this.log('Auto-reconnect HR failed: ' + err);
        }
      }
    }
  }

  async connectBikeViaPicker(): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth not available');
    this.updateBikeStatus('connecting');
    const device = await bt.requestDevice({
      filters: [{ services: [FTMS_SERVICE_UUID] }],
      optionalServices: [FTMS_SERVICE_UUID],
    });
    this.bikeDesiredDeviceId = device.id;
    await this.connectToBike(device);
  }

  async connectHrViaPicker(): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth not available');
    this.updateHrStatus('connecting');
    const device = await bt.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE_UUID] }],
      optionalServices: [HEART_RATE_SERVICE_UUID, BATTERY_SERVICE_UUID],
    });
    this.hrDesiredDeviceId = device.id;
    await this.connectToHr(device);
  }

  // ---------- bike connect + parse ----------

  private async connectToBike(device: BtDevice): Promise<void> {
    this.updateBikeStatus('connecting');
    const server = await device.gatt.connect();
    const ftmsService = await server.getPrimaryService(FTMS_SERVICE_UUID);
    const indoorChar = await ftmsService.getCharacteristic(INDOOR_BIKE_DATA_CHAR);
    const cpChar = await ftmsService.getCharacteristic(FTMS_CONTROL_POINT_CHAR);

    await cpChar.startNotifications();
    indoorChar.addEventListener('characteristicvaluechanged', (e) => {
      this.parseIndoorBikeData(e.target.value);
    });
    await indoorChar.startNotifications();

    this.bikeControlPointChar = cpChar;

    // requestControl + startOrResume handshake (both fatal on failure)
    await this.writeFtmsControlPoint(cpChar, FTMS_OPCODES.requestControl, null);
    await this.writeFtmsControlPoint(cpChar, FTMS_OPCODES.startOrResume, null);
    this.log('FTMS requestControl + startOrResume sent.');

    this.bikeConnected = true;
    this.updateBikeStatus('connected');

    device.addEventListener('gattserverdisconnected', () => this.onBikeDisconnect());
  }

  private onBikeDisconnect(): void {
    this.bikeConnected = false;
    this.bikeControlPointChar = null;
    this.updateBikeStatus('error', 'Trainer disconnected.');
    this.lastBikeSample = { power: null, cadence: null, speedKph: null, hrFromBike: null };
    this.emit('bikeSample', { ...this.lastBikeSample });
  }

  private parseIndoorBikeData(dataView: DataView): void {
    if (!dataView || dataView.byteLength < 4) return;
    let index = 0;
    const flags = dataView.getUint16(index, true);
    index += 2;

    // Speed present when bit 0 is CLEAR (inverted-presence per FTMS spec)
    if ((flags & 0x0001) === 0 && dataView.byteLength >= index + 2) {
      const raw = dataView.getUint16(index, true);
      index += 2;
      this.lastBikeSample.speedKph = raw / 100.0;
    }
    if (flags & (1 << 1)) index += 2;
    if (flags & (1 << 2)) {
      if (dataView.byteLength >= index + 2) {
        const rawCad = dataView.getUint16(index, true);
        index += 2;
        this.lastBikeSample.cadence = rawCad / 2.0;
      }
    }
    if (flags & (1 << 3)) index += 2;
    if (flags & (1 << 4)) index += 3;
    if (flags & (1 << 5)) index += 1;
    if (flags & (1 << 6)) {
      if (dataView.byteLength >= index + 2) {
        const power = dataView.getInt16(index, true);
        index += 2;
        this.lastBikeSample.power = power;
      }
    }
    if (flags & (1 << 7)) index += 2;
    if (flags & (1 << 8)) index += 5;
    if (flags & (1 << 9)) {
      if (dataView.byteLength >= index + 1) {
        this.lastBikeSample.hrFromBike = dataView.getUint8(index);
        index += 1;
      }
    }
    this.emit('bikeSample', { ...this.lastBikeSample });
  }

  // ---------- HR connect + parse ----------

  private async connectToHr(device: BtDevice): Promise<void> {
    this.updateHrStatus('connecting');
    const server = await device.gatt.connect();
    const hrService = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
    const hrChar = await hrService.getCharacteristic(HR_MEASUREMENT_CHAR);
    hrChar.addEventListener('characteristicvaluechanged', (e) => {
      this.parseHrMeasurement(e.target.value);
    });
    await hrChar.startNotifications();

    let batteryService: BtService | null = null;
    try {
      batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
    } catch {
      batteryService = null;
    }
    if (batteryService) {
      try {
        const batChar = await batteryService.getCharacteristic(BATTERY_LEVEL_CHAR);
        const val = await batChar.readValue();
        const pct = val.getUint8(0);
        this.emit('hrBattery', pct);
      } catch (err) {
        this.log('HR battery read failed: ' + err);
      }
    }

    this.updateHrStatus('connected');
    device.addEventListener('gattserverdisconnected', () => this.onHrDisconnect());
  }

  private onHrDisconnect(): void {
    this.updateHrStatus('error', 'Heart-rate monitor disconnected.');
    this.emit('hrBattery', null);
    this.emit('hrSample', null);
  }

  private parseHrMeasurement(dataView: DataView): void {
    if (!dataView || dataView.byteLength < 2) return;
    let offset = 0;
    const flags = dataView.getUint8(offset);
    offset += 1;
    const is16bit = (flags & 0x1) !== 0;
    let hr: number | null = null;
    if (is16bit && dataView.byteLength >= offset + 2) hr = dataView.getUint16(offset, true);
    else if (!is16bit) hr = dataView.getUint8(offset);
    if (hr != null) this.emit('hrSample', hr);
  }

  // ---------- ERG control ----------

  private async writeFtmsControlPoint(
    cpChar: BtChar,
    opCode: number,
    sint16Param: number | null,
  ): Promise<void> {
    let buffer: ArrayBuffer;
    if (sint16Param == null) {
      buffer = new Uint8Array([opCode]).buffer;
    } else {
      buffer = new ArrayBuffer(3);
      const view = new DataView(buffer);
      view.setUint8(0, opCode);
      view.setInt16(1, sint16Param, true);
    }
    const fn = cpChar.writeValueWithResponse || cpChar.writeValue;
    if (!fn) throw new Error('Control point characteristic not writable');
    await fn.call(cpChar, buffer);
  }

  private async sendErgSetpointRaw(targetWatts: number): Promise<void> {
    if (!this.bikeControlPointChar) return;
    const val = Math.max(0, Math.min(2000, targetWatts | 0));
    try {
      await this.writeFtmsControlPoint(this.bikeControlPointChar, FTMS_OPCODES.setTargetPower, val);
      this.log(`ERG target → ${val} W`);
    } catch (err) {
      this.log('Failed to set ERG target: ' + err);
    }
  }

  private async sendResistanceLevelRaw(level: number): Promise<void> {
    if (!this.bikeControlPointChar) return;
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const tenth = clamped * 10;
    try {
      await this.writeFtmsControlPoint(
        this.bikeControlPointChar,
        FTMS_OPCODES.setTargetResistanceLevel,
        tenth,
      );
      this.log(`Resistance target → ${clamped}`);
    } catch (err) {
      this.log('Failed to set resistance target: ' + err);
    }
  }

  async setTrainerState(state: TrainerState, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    if (!this.bikeConnected || !this.bikeControlPointChar) return;
    const tNow = this.nowSec();

    if (state.kind === 'erg') {
      const target = Math.round(state.value);
      const needsSend =
        force ||
        this.lastTrainerMode !== 'erg' ||
        this.lastErgTargetSent !== target ||
        tNow - this.lastErgSendTs >= TRAINER_SEND_MIN_INTERVAL_SEC;
      if (needsSend) {
        await this.sendErgSetpointRaw(target);
        this.lastTrainerMode = 'erg';
        this.lastErgTargetSent = target;
        this.lastErgSendTs = tNow;
      }
    } else if (state.kind === 'resistance') {
      const target = Math.round(state.value);
      const needsSend =
        force ||
        this.lastTrainerMode !== 'resistance' ||
        this.lastResistanceSent !== target ||
        tNow - this.lastResistanceSendTs >= TRAINER_SEND_MIN_INTERVAL_SEC;
      if (needsSend) {
        await this.sendResistanceLevelRaw(target);
        this.lastTrainerMode = 'resistance';
        this.lastResistanceSent = target;
        this.lastResistanceSendTs = tNow;
      }
    }
  }

  // ---------- status helpers ----------

  private defaultStatusMessage(kind: string, state: string): string {
    if (state === 'connecting') return `Connecting to ${kind}…`;
    if (state === 'connected') return `Connected to ${kind}.`;
    if (state === 'error') return `Error with ${kind} connection.`;
    return '';
  }

  private updateBikeStatus(state: 'connecting' | 'connected' | 'error', message?: string): void {
    this.emit('bikeStatus', { state, message: message ?? this.defaultStatusMessage('bike', state) });
  }

  private updateHrStatus(state: 'connecting' | 'connected' | 'error', message?: string): void {
    this.emit('hrStatus', {
      state,
      message: message ?? this.defaultStatusMessage('heart-rate monitor', state),
    });
  }
}
