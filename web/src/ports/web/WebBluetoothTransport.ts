// WebBluetoothTransport.ts
//
// Reads `navigator.bluetooth` (so the harness fake drives it). Handles: FTMS
// Indoor Bike Data parse, HR measurement parse, ERG control (requestControl +
// startOrResume handshake, setTargetPower throttle/clamp), disconnect -> null
// sample, and the bikeSample/hrSample/bikeStatus/hrStatus/hrBattery/log events.

import type {
  TrainerTransport,
  TransportEvents,
  TransportEventType,
  BikeSample,
  TrainerState,
} from '../TrainerTransport.js';

// ---------- FTMS constants ----------
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

const MIN_RECONNECT_DELAY_MS = 1000; // 1s
const MAX_RECONNECT_DELAY_MS = 10000; // cap at 10s

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
  connected?: boolean;
}
interface BtDevice {
  id: string;
  name?: string;
  gatt: BtServer;
  addEventListener(t: string, fn: () => void): void;
  removeEventListener?(t: string, fn: () => void): void;
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

  // Known device objects by id (from getDevices() or requestDevice()), so the
  // backoff reconnect timers can re-`gatt.connect()` the same BtDevice.
  private bikeKnownDevices = new Map<string, BtDevice>();
  private hrKnownDevices = new Map<string, BtDevice>();

  // Per-device exponential-backoff reconnect (1s → ×2 → cap 10s).
  private bikeReconnectTimerId: number | null = null;
  private hrReconnectTimerId: number | null = null;
  private bikeReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
  private hrReconnectDelayMs = MIN_RECONNECT_DELAY_MS;

  private hrConnected = false;
  private bikeServer: BtServer | null = null;
  private hrServer: BtServer | null = null;

  // Suppress auto-reconnect for the SPECIFIC server we manually tear down when
  // re-pairing. Binding to the server (not a global boolean) means a real
  // hardware drop racing the manual teardown can't mis-consume the flag.
  private bikeSuppressReconnectServer: BtServer | null = null;
  private hrSuppressReconnectServer: BtServer | null = null;

  // Disconnect listeners (so we can detach a previous connection's handler).
  private bikeDisconnectHandler: (() => void) | null = null;
  private hrDisconnectHandler: (() => void) | null = null;

  // Persist newly paired device ids for next-load reconnect (set by the
  // composition root).
  private persistBikeId: ((id: string | null) => void) | null = null;
  private persistHrId: ((id: string | null) => void) | null = null;

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

  /** How to persist a newly paired device id. */
  setPersistDeviceIds(cb: {
    saveBikeId: (id: string | null) => void;
    saveHrId: (id: string | null) => void;
  }): void {
    this.persistBikeId = cb.saveBikeId;
    this.persistHrId = cb.saveHrId;
  }

  // -------- auto-reconnect via getDevices() --------

  private async maybeReconnectSavedDevices(): Promise<void> {
    const bt = getBluetooth();
    if (!bt || !bt.getDevices) {
      this.log('Web Bluetooth getDevices() not supported, skipping auto-reconnect.');
      return;
    }
    if (!this.bikeDesiredDeviceId && !this.hrDesiredDeviceId) {
      this.log('No saved BLE device IDs, skipping auto-reconnect.');
      return;
    }
    let devices: BtDevice[] = [];
    try {
      devices = await bt.getDevices();
    } catch (err) {
      this.log('getDevices() failed: ' + err);
      return;
    }
    this.log(`getDevices() returned ${devices.length} devices.`);

    const bikeDevice = this.bikeDesiredDeviceId
      ? devices.find((d) => d.id === this.bikeDesiredDeviceId)
      : null;
    const hrDevice = this.hrDesiredDeviceId
      ? devices.find((d) => d.id === this.hrDesiredDeviceId)
      : null;

    if (bikeDevice) {
      this.bikeKnownDevices.set(bikeDevice.id, bikeDevice);
      this.bikeReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      this.log(
        `Found previously paired bike "${bikeDevice.name || 'bike'}", reconnecting…`,
      );
      // Connect immediately on load (a found device is already paired); fall
      // back to backoff scheduling only if that attempt fails.
      this.connectToBike(bikeDevice).catch((err) => {
        this.log('Auto-reconnect bike failed: ' + err);
        this.scheduleBikeAutoReconnect(true);
      });
    } else if (this.bikeDesiredDeviceId) {
      this.log('Saved bike ID not available in getDevices() (permission revoked?).');
    }

    if (hrDevice) {
      this.hrKnownDevices.set(hrDevice.id, hrDevice);
      this.hrReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      this.log(
        `Found previously paired HRM "${hrDevice.name || 'heart-rate monitor'}", reconnecting…`,
      );
      this.connectToHr(hrDevice).catch((err) => {
        this.log('Auto-reconnect HR failed: ' + err);
        this.scheduleHrAutoReconnect(true);
      });
    } else if (this.hrDesiredDeviceId) {
      this.log('Saved HRM ID not available in getDevices() (permission revoked?).');
    }
  }

  private cancelBikeAutoReconnect(): void {
    if (this.bikeReconnectTimerId != null) {
      window.clearTimeout(this.bikeReconnectTimerId);
      this.bikeReconnectTimerId = null;
    }
  }

  private cancelHrAutoReconnect(): void {
    if (this.hrReconnectTimerId != null) {
      window.clearTimeout(this.hrReconnectTimerId);
      this.hrReconnectTimerId = null;
    }
  }

  private scheduleBikeAutoReconnect(resetDelay = false): void {
    if (!this.autoReconnectEnabled || !this.bikeDesiredDeviceId) return;
    const device = this.bikeKnownDevices.get(this.bikeDesiredDeviceId);
    if (!device || this.bikeConnected) return;
    if (resetDelay || !this.bikeReconnectDelayMs) {
      this.bikeReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    }
    this.cancelBikeAutoReconnect();
    const name = device.name || 'bike';
    this.updateBikeStatus(
      'error',
      `Device "${name}" disconnected. Will retry in ${Math.round(this.bikeReconnectDelayMs / 1000)}s…`,
    );
    this.bikeReconnectTimerId = window.setTimeout(() => {
      this.bikeReconnectTimerId = null;
      if (!this.autoReconnectEnabled || !this.bikeDesiredDeviceId) return;
      const dev = this.bikeKnownDevices.get(this.bikeDesiredDeviceId);
      if (!dev) return;
      this.log(`Auto-reconnect: attempting reconnect to "${dev.name || 'bike'}"…`);
      this.connectToBike(dev).catch((err) => {
        this.log(`Auto-reconnect (bike) failed: ` + err);
        this.bikeReconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, this.bikeReconnectDelayMs * 2);
        this.scheduleBikeAutoReconnect(false);
      });
    }, this.bikeReconnectDelayMs) as unknown as number;
  }

  private scheduleHrAutoReconnect(resetDelay = false): void {
    if (!this.autoReconnectEnabled || !this.hrDesiredDeviceId) return;
    const device = this.hrKnownDevices.get(this.hrDesiredDeviceId);
    if (!device || this.hrConnected) return;
    if (resetDelay || !this.hrReconnectDelayMs) {
      this.hrReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    }
    this.cancelHrAutoReconnect();
    const name = device.name || 'heart-rate monitor';
    this.updateHrStatus(
      'error',
      `Device "${name}" disconnected. Will retry in ${Math.round(this.hrReconnectDelayMs / 1000)}s…`,
    );
    this.hrReconnectTimerId = window.setTimeout(() => {
      this.hrReconnectTimerId = null;
      if (!this.autoReconnectEnabled || !this.hrDesiredDeviceId) return;
      const dev = this.hrKnownDevices.get(this.hrDesiredDeviceId);
      if (!dev) return;
      this.log(`Auto-reconnect: attempting HRM reconnect to "${dev.name || 'heart-rate monitor'}"…`);
      this.connectToHr(dev).catch((err) => {
        this.log(`Auto-reconnect (HR) failed: ` + err);
        this.hrReconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, this.hrReconnectDelayMs * 2);
        this.scheduleHrAutoReconnect(false);
      });
    }, this.hrReconnectDelayMs) as unknown as number;
  }

  async connectBikeViaPicker(): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth not available');
    // A manual connect cancels any pending auto-reconnect for this device.
    this.cancelBikeAutoReconnect();
    const wasConnected = this.bikeConnected;
    this.updateBikeStatus('connecting');
    let device: BtDevice;
    try {
      device = await bt.requestDevice({
        filters: [{ services: [FTMS_SERVICE_UUID] }],
        optionalServices: [FTMS_SERVICE_UUID],
      });
    } catch (err) {
      this.log('Bike picker cancelled or failed: ' + err);
      // Re-pair was cancelled: tear down the old connection, suppressing the
      // resulting disconnect's auto-reconnect once.
      if (wasConnected && this.bikeServer?.connected) {
        this.bikeSuppressReconnectServer = this.bikeServer;
        try {
          this.bikeServer.disconnect();
        } catch {
          /* ignore */
        }
      } else if (!wasConnected) {
        // Nothing was connected and the user cancelled the chooser — return the
        // status dot to idle (we set 'connecting' above), NOT an error color.
        this.updateBikeStatus('idle');
      }
      throw err;
    }
    this.bikeDesiredDeviceId = device.id;
    this.bikeKnownDevices.set(device.id, device);
    this.bikeReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    try {
      await this.connectToBike(device);
    } catch (err) {
      // Even if the user connect fails, keep auto-retrying this id.
      this.scheduleBikeAutoReconnect(true);
      throw err;
    }
  }

  async connectHrViaPicker(): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth not available');
    this.cancelHrAutoReconnect();
    const wasConnected = this.hrConnected;
    this.updateHrStatus('connecting');
    let device: BtDevice;
    try {
      device = await bt.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE_UUID] }],
        optionalServices: [HEART_RATE_SERVICE_UUID, BATTERY_SERVICE_UUID],
      });
    } catch (err) {
      this.log('HR picker cancelled or failed: ' + err);
      if (wasConnected && this.hrServer?.connected) {
        this.hrSuppressReconnectServer = this.hrServer;
        try {
          this.hrServer.disconnect();
        } catch {
          /* ignore */
        }
      } else if (!wasConnected) {
        // User cancelled the chooser with nothing connected — back to idle.
        this.updateHrStatus('idle');
      }
      throw err;
    }
    this.hrDesiredDeviceId = device.id;
    this.hrKnownDevices.set(device.id, device);
    this.hrReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    try {
      await this.connectToHr(device);
    } catch (err) {
      this.scheduleHrAutoReconnect(true);
      throw err;
    }
  }

  // ---------- bike connect + parse ----------

  private async connectToBike(device: BtDevice): Promise<void> {
    this.bikeKnownDevices.set(device.id, device);
    const deviceId = device.id;
    const friendlyName = device.name || 'bike';
    this.updateBikeStatus('connecting');
    let server: BtServer | null = null;
    try {
      server = await device.gatt.connect();
      const ftmsService = await server.getPrimaryService(FTMS_SERVICE_UUID);
      const indoorChar = await ftmsService.getCharacteristic(INDOOR_BIKE_DATA_CHAR);
      const cpChar = await ftmsService.getCharacteristic(FTMS_CONTROL_POINT_CHAR);

      // Log FTMS Control Point indications (result codes).
      cpChar.addEventListener('characteristicvaluechanged', (e) => {
        const dv = e.target.value;
        if (!dv || dv.byteLength < 3) return;
        const op = dv.getUint8(0);
        const reqOp = dv.getUint8(1);
        const resCode = dv.getUint8(2);
        this.log(
          `FTMS CP <- Indication: op=0x${op.toString(16).padStart(2, '0')}, ` +
            `req=0x${reqOp.toString(16).padStart(2, '0')}, ` +
            `result=0x${resCode.toString(16).padStart(2, '0')}`,
        );
      });
      await cpChar.startNotifications();
      indoorChar.addEventListener('characteristicvaluechanged', (e) => {
        this.parseIndoorBikeData(e.target.value);
      });
      await indoorChar.startNotifications();

      // requestControl + startOrResume handshake (both fatal on failure). Uses
      // the LOCAL cpChar; this.bikeControlPointChar is committed only after the
      // stale-id check below.
      await this.writeFtmsControlPoint(cpChar, FTMS_OPCODES.requestControl, null);
      await this.writeFtmsControlPoint(cpChar, FTMS_OPCODES.startOrResume, null);
      this.log('FTMS requestControl + startOrResume sent.');

      // Only commit + save the id if this device is still the desired one
      // (the desired id can change mid-connect on a re-pair).
      if (deviceId !== this.bikeDesiredDeviceId) {
        this.log(`Bike connect succeeded for stale device ${deviceId}; tearing down.`);
        try {
          server.disconnect();
        } catch {
          /* ignore */
        }
        return;
      }

      // Persist the paired device id for next-load auto-reconnect.
      this.persistBikeId?.(deviceId);

      // Detach a previous connection's disconnect handler.
      if (this.bikeDisconnectHandler) {
        try {
          device.removeEventListener?.('gattserverdisconnected', this.bikeDisconnectHandler);
        } catch {
          /* ignore */
        }
      }
      const handler = (): void => this.onBikeDisconnect(friendlyName, server);
      this.bikeDisconnectHandler = handler;
      device.addEventListener('gattserverdisconnected', handler);

      // Commit the control-point char only here, AFTER the stale-id check, so a
      // re-pair that lands mid-connect can't leave ERG writes pointed at a
      // torn-down GATT char.
      this.bikeControlPointChar = cpChar;
      this.bikeServer = server;
      this.bikeConnected = true;
      this.updateBikeStatus('connected', `Connected to "${friendlyName}".`);
    } catch (err) {
      if (deviceId === this.bikeDesiredDeviceId) {
        this.bikeConnected = false;
        this.updateBikeStatus('error', `Failed to connect to "${friendlyName}": ` + err);
      }
      if (server?.connected) {
        try {
          server.disconnect();
        } catch {
          /* ignore */
        }
      }
      throw err;
    }
  }

  private onBikeDisconnect(friendlyName = 'bike', server: BtServer | null = null): void {
    this.bikeConnected = false;
    this.bikeControlPointChar = null;
    this.bikeServer = null;

    // Suppress auto-reconnect only for the exact server we manually tore down.
    const suppressed = server != null && server === this.bikeSuppressReconnectServer;
    const willRetry = this.autoReconnectEnabled && !suppressed && !!this.bikeDesiredDeviceId;
    this.updateBikeStatus(
      'error',
      willRetry
        ? `Device "${friendlyName}" disconnected. Will retry shortly…`
        : `Device "${friendlyName}" disconnected.`,
    );

    this.lastBikeSample = { power: null, cadence: null, speedKph: null, hrFromBike: null };
    this.emit('bikeSample', { ...this.lastBikeSample });

    // Resume regular auto-reconnect with reset backoff (unless suppressed once).
    this.bikeReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    if (suppressed) {
      this.bikeSuppressReconnectServer = null;
      this.log('Bike auto-reconnect suppressed for the manually torn-down connection.');
    } else {
      this.scheduleBikeAutoReconnect(true);
    }
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
    // Instantaneous Resistance Level is SINT16 (2 bytes) per the FTMS Indoor
    // Bike Data spec. Advancing only 1 byte would misalign the following fields
    // (power/HR) for any trainer that sets this flag.
    if (flags & (1 << 5)) index += 2;
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
    this.hrKnownDevices.set(device.id, device);
    const deviceId = device.id;
    const friendlyName = device.name || 'heart-rate monitor';
    this.updateHrStatus('connecting');
    let server: BtServer | null = null;
    try {
      server = await device.gatt.connect();
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

      if (deviceId !== this.hrDesiredDeviceId) {
        this.log(`HR connect succeeded for stale device ${deviceId}; tearing down.`);
        try {
          server.disconnect();
        } catch {
          /* ignore */
        }
        return;
      }

      this.persistHrId?.(deviceId);

      if (this.hrDisconnectHandler) {
        try {
          device.removeEventListener?.('gattserverdisconnected', this.hrDisconnectHandler);
        } catch {
          /* ignore */
        }
      }
      const handler = (): void => this.onHrDisconnect(friendlyName, server);
      this.hrDisconnectHandler = handler;
      device.addEventListener('gattserverdisconnected', handler);

      this.hrServer = server;
      this.hrConnected = true;
      this.updateHrStatus('connected', `Connected to "${friendlyName}".`);
    } catch (err) {
      if (deviceId === this.hrDesiredDeviceId) {
        this.hrConnected = false;
        this.updateHrStatus('error', `Failed to connect to "${friendlyName}": ` + err);
      }
      if (server?.connected) {
        try {
          server.disconnect();
        } catch {
          /* ignore */
        }
      }
      throw err;
    }
  }

  private onHrDisconnect(friendlyName = 'heart-rate monitor', server: BtServer | null = null): void {
    this.hrConnected = false;
    this.hrServer = null;

    const suppressed = server != null && server === this.hrSuppressReconnectServer;
    const willRetry = this.autoReconnectEnabled && !suppressed && !!this.hrDesiredDeviceId;
    this.updateHrStatus(
      'error',
      willRetry
        ? `Device "${friendlyName}" disconnected. Will retry shortly…`
        : `Device "${friendlyName}" disconnected.`,
    );

    this.emit('hrBattery', null);
    this.emit('hrSample', null);

    this.hrReconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    if (suppressed) {
      this.hrSuppressReconnectServer = null;
      this.log('HR auto-reconnect suppressed for the manually torn-down connection.');
    } else {
      this.scheduleHrAutoReconnect(true);
    }
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

  // Return whether the write actually landed, so setTrainerState only commits
  // dedupe state on success: a swallowed GATT failure must be retried.
  private async sendErgSetpointRaw(targetWatts: number): Promise<boolean> {
    if (!this.bikeControlPointChar) return false;
    const val = Math.max(0, Math.min(2000, targetWatts | 0));
    try {
      await this.writeFtmsControlPoint(this.bikeControlPointChar, FTMS_OPCODES.setTargetPower, val);
      this.log(`ERG target → ${val} W`);
      return true;
    } catch (err) {
      this.log('Failed to set ERG target: ' + err);
      return false;
    }
  }

  private async sendResistanceLevelRaw(level: number): Promise<boolean> {
    if (!this.bikeControlPointChar) return false;
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const tenth = clamped * 10;
    try {
      await this.writeFtmsControlPoint(
        this.bikeControlPointChar,
        FTMS_OPCODES.setTargetResistanceLevel,
        tenth,
      );
      this.log(`Resistance target → ${clamped}`);
      return true;
    } catch (err) {
      this.log('Failed to set resistance target: ' + err);
      return false;
    }
  }

  async setTrainerState(state: TrainerState, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    if (!this.bikeConnected || !this.bikeControlPointChar) return;
    // Drop a non-finite target rather than coercing it to 0 W (which
    // `targetWatts | 0` would do) and busy-looping the dedupe (NaN !== NaN).
    if (!Number.isFinite(state.value)) return;
    const tNow = this.nowSec();

    if (state.kind === 'erg') {
      const target = Math.round(state.value);
      const needsSend =
        force ||
        this.lastTrainerMode !== 'erg' ||
        this.lastErgTargetSent !== target ||
        tNow - this.lastErgSendTs >= TRAINER_SEND_MIN_INTERVAL_SEC;
      if (needsSend) {
        // Only record the target as sent when the write actually landed, so a
        // swallowed GATT failure is retried on the next tick rather than deduped
        // away (trainer left at the wrong watts for up to 10 s).
        const ok = await this.sendErgSetpointRaw(target);
        if (ok) {
          this.lastTrainerMode = 'erg';
          this.lastErgTargetSent = target;
          this.lastErgSendTs = tNow;
        }
      }
    } else if (state.kind === 'resistance') {
      const target = Math.round(state.value);
      const needsSend =
        force ||
        this.lastTrainerMode !== 'resistance' ||
        this.lastResistanceSent !== target ||
        tNow - this.lastResistanceSendTs >= TRAINER_SEND_MIN_INTERVAL_SEC;
      if (needsSend) {
        const ok = await this.sendResistanceLevelRaw(target);
        if (ok) {
          this.lastTrainerMode = 'resistance';
          this.lastResistanceSent = target;
          this.lastResistanceSendTs = tNow;
        }
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

  private updateBikeStatus(
    state: 'idle' | 'connecting' | 'connected' | 'error',
    message?: string,
  ): void {
    this.emit('bikeStatus', { state, message: message ?? this.defaultStatusMessage('bike', state) });
  }

  private updateHrStatus(
    state: 'idle' | 'connecting' | 'connected' | 'error',
    message?: string,
  ): void {
    this.emit('hrStatus', {
      state,
      message: message ?? this.defaultStatusMessage('heart-rate monitor', state),
    });
  }
}
