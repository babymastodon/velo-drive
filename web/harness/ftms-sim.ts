// harness/ftms-sim.ts
//
// A fake `navigator.bluetooth` whose GATT graph speaks real FTMS bytes, the
// inverse of docs/ble-manager.js. It exposes exactly the surface ble-manager
// touches:
//   navigator.bluetooth.requestDevice / getDevices
//   device.gatt.connect / getPrimaryService / getCharacteristic
//   char.startNotifications / addEventListener('characteristicvaluechanged')
//        / writeValueWithResponse|writeValue / readValue
//   device.addEventListener('gattserverdisconnected')
//
// It HOLDS trainer state the test drives (setReportedPower / setReportedCadence
// / setReportedHr) and emits Indoor Bike Data frames via `emitBikeData()` (call
// it after stepping the clock to push a 0x2AD2 notification). It also RECORDS
// every Control-Point write for assertions (`controlPointWrites`).
//
// HR (0x180D/0x2A37) and battery (0x180F/0x2A19) are faked on the same device
// (a combined bike+HR trainer) and on a dedicated HR device.

import {
  FTMS,
  FTMS_OPCODES,
  encodeIndoorBikeData,
  encodeControlPointResponse,
  encodeHrMeasurement,
  parseControlPointWrite,
  type ControlPointWrite,
  type BikeSampleInput,
} from "./ftms.js";

type Listener = (ev: {target: {value: DataView}}) => void;
type DisconnectListener = () => void;

class FakeCharacteristic {
  uuid: number;
  value: DataView | null = null;
  private listeners = new Set<Listener>();
  // writes recorder + responder are wired by the service.
  onWrite: ((buf: ArrayBuffer) => void) | null = null;
  readFactory: (() => DataView) | null = null;

  constructor(uuid: number) {
    this.uuid = uuid;
  }

  async startNotifications(): Promise<FakeCharacteristic> {
    return this;
  }
  async stopNotifications(): Promise<FakeCharacteristic> {
    return this;
  }
  addEventListener(type: string, fn: Listener): void {
    if (type === "characteristicvaluechanged") this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    if (type === "characteristicvaluechanged") this.listeners.delete(fn);
  }
  /** Push a notification frame to all subscribers (sets `.value` first). */
  notify(value: DataView): void {
    this.value = value;
    for (const fn of [...this.listeners]) {
      try {
        fn({target: {value}});
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[ftms-sim] characteristicvaluechanged listener threw:", err);
      }
    }
  }
  async writeValueWithResponse(buffer: ArrayBuffer): Promise<void> {
    if (this.onWrite) this.onWrite(buffer);
  }
  async writeValue(buffer: ArrayBuffer): Promise<void> {
    if (this.onWrite) this.onWrite(buffer);
  }
  async readValue(): Promise<DataView> {
    if (this.readFactory) {
      const v = this.readFactory();
      this.value = v;
      return v;
    }
    return this.value ?? new DataView(new ArrayBuffer(0));
  }
}

class FakeService {
  uuid: number;
  private chars = new Map<number, FakeCharacteristic>();
  constructor(uuid: number) {
    this.uuid = uuid;
  }
  addCharacteristic(c: FakeCharacteristic): FakeCharacteristic {
    this.chars.set(c.uuid, c);
    return c;
  }
  async getCharacteristic(uuid: number): Promise<FakeCharacteristic> {
    const c = this.chars.get(uuid);
    if (!c) {
      const err = new Error(`Characteristic ${uuid} not found`);
      err.name = "NotFoundError";
      throw err;
    }
    return c;
  }
}

class FakeGattServer {
  connected = false;
  device: FakeDevice;
  private services: Map<number, FakeService>;
  constructor(device: FakeDevice, services: Map<number, FakeService>) {
    this.device = device;
    this.services = services;
  }
  async connect(): Promise<FakeGattServer> {
    this.connected = true;
    return this;
  }
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.device._fireDisconnected();
  }
  async getPrimaryService(uuid: number): Promise<FakeService> {
    const s = this.services.get(uuid);
    if (!s) {
      const err = new Error(`Service ${uuid} not found`);
      err.name = "NotFoundError";
      throw err;
    }
    return s;
  }
}

class FakeDevice {
  id: string;
  name: string;
  gatt: FakeGattServer;
  private services = new Map<number, FakeService>();
  private disconnectListeners = new Set<DisconnectListener>();

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.gatt = new FakeGattServer(this, this.services);
  }
  _addService(s: FakeService): FakeService {
    this.services.set(s.uuid, s);
    return s;
  }
  addEventListener(type: string, fn: DisconnectListener): void {
    if (type === "gattserverdisconnected") this.disconnectListeners.add(fn);
  }
  removeEventListener(type: string, fn: DisconnectListener): void {
    if (type === "gattserverdisconnected") this.disconnectListeners.delete(fn);
  }
  _fireDisconnected(): void {
    for (const fn of [...this.disconnectListeners]) {
      try {
        fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[ftms-sim] gattserverdisconnected listener threw:", err);
      }
    }
  }
}

export interface TrainerState {
  power: number | null;
  cadence: number | null;
  speedKph: number | null;
  hr: number | null;
  batteryPercent: number;
}

export interface FtmsSimOptions {
  deviceId?: string;
  deviceName?: string;
  hrDeviceId?: string;
  hrDeviceName?: string;
  initial?: Partial<TrainerState>;
}

export interface FtmsSim {
  /** The object to install as `navigator.bluetooth`. */
  bluetooth: {
    requestDevice: (opts?: unknown) => Promise<FakeDevice>;
    getDevices: () => Promise<FakeDevice[]>;
  };
  /** Recorded Control-Point writes (decoded), in order. */
  controlPointWrites: ControlPointWrite[];
  /** Mutable trainer state the test drives. */
  state: TrainerState;
  setReportedPower: (w: number | null) => void;
  setReportedCadence: (rpm: number | null) => void;
  setReportedHr: (bpm: number | null) => void;
  setReportedSpeed: (kph: number | null) => void;
  /** Emit one Indoor Bike Data frame reflecting current state. */
  emitBikeData: (override?: BikeSampleInput) => void;
  /** Emit one HR Measurement frame on the HR device (and bike if hr set). */
  emitHr: (bpm?: number) => void;
  /** Force a disconnect of the bike GATT (drives reconnect/null-sample paths). */
  disconnectBike: () => void;
  /** ids the harness seeds into settings so auto-reconnect picks them up. */
  bikeDeviceId: string;
  hrDeviceId: string;
}

export function createFtmsSim(opts: FtmsSimOptions = {}): FtmsSim {
  const bikeId = opts.deviceId ?? "sim-bike-0001";
  const bikeName = opts.deviceName ?? "VeloDrive Sim Trainer";
  const hrId = opts.hrDeviceId ?? "sim-hr-0001";
  const hrName = opts.hrDeviceName ?? "VeloDrive Sim HRM";

  const state: TrainerState = {
    power: opts.initial?.power ?? 150,
    cadence: opts.initial?.cadence ?? 90,
    speedKph: opts.initial?.speedKph ?? 30,
    hr: opts.initial?.hr ?? 140,
    batteryPercent: opts.initial?.batteryPercent ?? 88,
  };

  const controlPointWrites: ControlPointWrite[] = [];

  // ---- bike device (FTMS + battery) ----
  const bike = new FakeDevice(bikeId, bikeName);
  const ftms = bike._addService(new FakeService(FTMS.SERVICE));
  const bikeBattery = bike._addService(new FakeService(FTMS.BATTERY_SERVICE));

  const indoorBikeChar = ftms.addCharacteristic(new FakeCharacteristic(FTMS.INDOOR_BIKE_DATA_CHAR));
  const controlPointChar = ftms.addCharacteristic(new FakeCharacteristic(FTMS.CONTROL_POINT_CHAR));
  const bikeBatteryChar = bikeBattery.addCharacteristic(new FakeCharacteristic(FTMS.BATTERY_LEVEL_CHAR));
  bikeBatteryChar.readFactory = () => {
    const dv = new DataView(new ArrayBuffer(1));
    dv.setUint8(0, state.batteryPercent & 0xff);
    return dv;
  };

  // Control point: record the write, then indicate [0x80, reqOpcode, 0x01].
  controlPointChar.onWrite = (buf: ArrayBuffer) => {
    const decoded = parseControlPointWrite(buf);
    controlPointWrites.push(decoded);
    // Only the set/handshake opcodes get an indicate in real FTMS; ble-manager
    // ignores the body beyond logging, so always indicate success.
    const resp = encodeControlPointResponse(decoded.opcode, 0x01);
    // Fire asynchronously-ish but synchronously here is fine (listeners just log).
    controlPointChar.notify(resp);
  };

  // ---- HR device (HR + battery) ----
  const hrDev = new FakeDevice(hrId, hrName);
  const hrService = hrDev._addService(new FakeService(FTMS.HEART_RATE_SERVICE));
  const hrBattery = hrDev._addService(new FakeService(FTMS.BATTERY_SERVICE));
  const hrChar = hrService.addCharacteristic(new FakeCharacteristic(FTMS.HR_MEASUREMENT_CHAR));
  const hrBatteryChar = hrBattery.addCharacteristic(new FakeCharacteristic(FTMS.BATTERY_LEVEL_CHAR));
  hrBatteryChar.readFactory = () => {
    const dv = new DataView(new ArrayBuffer(1));
    dv.setUint8(0, state.batteryPercent & 0xff);
    return dv;
  };

  const bluetooth = {
    async requestDevice(options?: unknown): Promise<FakeDevice> {
      // Choose device by requested service filter (FTMS vs HR).
      const wantsHr = JSON.stringify(options ?? {}).includes(String(FTMS.HEART_RATE_SERVICE));
      return wantsHr ? hrDev : bike;
    },
    async getDevices(): Promise<FakeDevice[]> {
      return [bike, hrDev];
    },
  };

  function emitBikeData(override?: BikeSampleInput): void {
    const frame = encodeIndoorBikeData({
      power: override?.power !== undefined ? override.power : state.power,
      cadence: override?.cadence !== undefined ? override.cadence : state.cadence,
      speedKph: override?.speedKph !== undefined ? override.speedKph : state.speedKph,
      hr: override?.hr !== undefined ? override.hr : null,
    });
    indoorBikeChar.notify(frame);
  }

  function emitHr(bpm?: number): void {
    const v = bpm ?? state.hr ?? 0;
    hrChar.notify(encodeHrMeasurement(v));
  }

  return {
    bluetooth,
    controlPointWrites,
    state,
    setReportedPower: (w) => { state.power = w; },
    setReportedCadence: (rpm) => { state.cadence = rpm; },
    setReportedHr: (bpm) => { state.hr = bpm; },
    setReportedSpeed: (kph) => { state.speedKph = kph; },
    emitBikeData,
    emitHr,
    disconnectBike: () => bike.gatt.disconnect(),
    bikeDeviceId: bikeId,
    hrDeviceId: hrId,
  };
}

// Re-export so callers have one import site.
export {FTMS_OPCODES};
