// harness/ftms.ts
//
// FTMS byte-layout helpers shared by the trainer simulator and the
// sim-vs-parser self-test. These are the *inverse* of the decode logic in
// docs/ble-manager.js (`parseIndoorBikeData`) and encode the Control-Point
// frames that `parseControlPointWrite` reads back.
//
// Indoor Bike Data (characteristic 0x2AD2), flags are uint16 LE:
//   bit0  set => instantaneous speed ABSENT (legacy: present when bit0 == 0)
//   bit1  average speed present (uint16)            -- not emitted
//   bit2  instantaneous cadence present (uint16, 1/2 rpm)
//   bit3  average cadence present (uint16)          -- not emitted
//   bit4  total distance present (uint24)           -- not emitted
//   bit5  resistance level present (sint16/uint8?)  -- legacy skips 1 byte
//   bit6  instantaneous power present (sint16, watts)
//   bit7  average power present (sint16)            -- not emitted
//   bit8  expended energy present (5 bytes)         -- not emitted
//   bit9  heart rate present (uint8, bpm)
// Speed scale 1/100 km/h, cadence scale 1/2 rpm, power 1 W, hr 1 bpm.

export const FTMS = {
  SERVICE: 0x1826,
  HEART_RATE_SERVICE: 0x180d,
  BATTERY_SERVICE: 0x180f,
  INDOOR_BIKE_DATA_CHAR: 0x2ad2,
  CONTROL_POINT_CHAR: 0x2ad9,
  HR_MEASUREMENT_CHAR: 0x2a37,
  BATTERY_LEVEL_CHAR: 0x2a19,
} as const;

export const FTMS_OPCODES = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  setTargetHeartRate: 0x06,
  startOrResume: 0x07,
  stopOrPause: 0x08,
} as const;

// Indoor-Bike-Data flag bits (matching legacy decode).
const FLAG_SPEED_ABSENT = 0x0001; // bit0 == 0 means speed present
const FLAG_CADENCE = 1 << 2;
const FLAG_POWER = 1 << 6;
const FLAG_HR = 1 << 9;

export interface BikeSampleInput {
  /** instantaneous power in watts (sint16). Omit to omit the field. */
  power?: number | null;
  /** cadence in rpm (encoded ×2). Omit to omit the field. */
  cadence?: number | null;
  /** speed in km/h (encoded ×100). Present when provided. */
  speedKph?: number | null;
  /** heart rate from bike in bpm (uint8). Omit to omit the field. */
  hr?: number | null;
}

/**
 * Encode an Indoor Bike Data (0x2AD2) frame. Field order must match the legacy
 * parser's flag-walk: speed, [avg speed], cadence, ..., power, ..., hr.
 */
export function encodeIndoorBikeData(s: BikeSampleInput): DataView {
  const hasSpeed = s.speedKph != null;
  const hasCadence = s.cadence != null;
  const hasPower = s.power != null;
  const hasHr = s.hr != null;

  let flags = 0;
  // bit0 SET means speed ABSENT; clear it (leave 0) when speed present.
  if (!hasSpeed) flags |= FLAG_SPEED_ABSENT;
  if (hasCadence) flags |= FLAG_CADENCE;
  if (hasPower) flags |= FLAG_POWER;
  if (hasHr) flags |= FLAG_HR;

  let len = 2; // flags
  if (hasSpeed) len += 2;
  if (hasCadence) len += 2;
  if (hasPower) len += 2;
  if (hasHr) len += 1;

  const buf = new ArrayBuffer(len);
  const dv = new DataView(buf);
  let i = 0;
  dv.setUint16(i, flags, true); i += 2;
  if (hasSpeed) { dv.setUint16(i, Math.round((s.speedKph as number) * 100), true); i += 2; }
  if (hasCadence) { dv.setUint16(i, Math.round((s.cadence as number) * 2), true); i += 2; }
  if (hasPower) { dv.setInt16(i, Math.round(s.power as number), true); i += 2; }
  if (hasHr) { dv.setUint8(i, Math.round(s.hr as number) & 0xff); i += 1; }
  return dv;
}

export interface DecodedBikeSample {
  power: number | null;
  cadence: number | null;
  speedKph: number | null;
  hrFromBike: number | null;
}

/**
 * Reference decoder — a faithful re-implementation of
 * docs/ble-manager.js `parseIndoorBikeData`. Used by the self-test to prove the
 * encoder is the inverse of the legacy parser. Returns null on malformed input
 * (matching the legacy `byteLength < 4` guard).
 */
export function decodeIndoorBikeData(dataView: DataView): DecodedBikeSample | null {
  if (!dataView || dataView.byteLength < 4) return null;
  const out: DecodedBikeSample = {power: null, cadence: null, speedKph: null, hrFromBike: null};

  let index = 0;
  const flags = dataView.getUint16(index, true);
  index += 2;

  if ((flags & 0x0001) === 0 && dataView.byteLength >= index + 2) {
    const raw = dataView.getUint16(index, true);
    index += 2;
    out.speedKph = raw / 100.0;
  }
  if (flags & (1 << 1)) index += 2;
  if (flags & (1 << 2)) {
    if (dataView.byteLength >= index + 2) {
      const rawCad = dataView.getUint16(index, true);
      index += 2;
      out.cadence = rawCad / 2.0;
    }
  }
  if (flags & (1 << 3)) index += 2;
  if (flags & (1 << 4)) index += 3;
  if (flags & (1 << 5)) index += 1;
  if (flags & (1 << 6)) {
    if (dataView.byteLength >= index + 2) {
      out.power = dataView.getInt16(index, true);
      index += 2;
    }
  }
  if (flags & (1 << 7)) index += 2;
  if (flags & (1 << 8)) index += 5;
  if (flags & (1 << 9)) {
    if (dataView.byteLength >= index + 1) {
      out.hrFromBike = dataView.getUint8(index);
      index += 1;
    }
  }
  return out;
}

export interface ControlPointWrite {
  opcode: number;
  /** decoded sint16 param for set* opcodes, else null. */
  param: number | null;
  /** decoded semantic value: watts for power, level for resistance, else null. */
  value: number | null;
  raw: number[];
}

/** Decode an FTMS Control Point (0x2AD9) write into a structured record. */
export function parseControlPointWrite(buffer: ArrayBuffer | DataView): ControlPointWrite {
  const dv = buffer instanceof DataView ? buffer : new DataView(buffer);
  const opcode = dv.getUint8(0);
  let param: number | null = null;
  if (dv.byteLength >= 3) param = dv.getInt16(1, true);

  let value: number | null = null;
  if (opcode === FTMS_OPCODES.setTargetPower) value = param; // watts
  else if (opcode === FTMS_OPCODES.setTargetResistanceLevel) value = param == null ? null : param / 10; // level = tenth/10

  const raw: number[] = [];
  for (let i = 0; i < dv.byteLength; i++) raw.push(dv.getUint8(i));
  return {opcode, param, value, raw};
}

/** Build the Control Point indicate response: [0x80, reqOpcode, 0x01]. */
export function encodeControlPointResponse(reqOpcode: number, resultCode = 0x01): DataView {
  const dv = new DataView(new ArrayBuffer(3));
  dv.setUint8(0, 0x80);
  dv.setUint8(1, reqOpcode);
  dv.setUint8(2, resultCode);
  return dv;
}

/** Encode a Heart Rate Measurement (0x2A37) frame: uint8 flags + uint8 bpm. */
export function encodeHrMeasurement(bpm: number): DataView {
  const dv = new DataView(new ArrayBuffer(2));
  dv.setUint8(0, 0x00); // flags: 8-bit HR value
  dv.setUint8(1, Math.round(bpm) & 0xff);
  return dv;
}
