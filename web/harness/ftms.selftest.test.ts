// harness/ftms.selftest.test.ts
//
// Sim-vs-parser self-test: encode a known Indoor Bike Data frame with the
// harness FTMS simulator's encoder, then decode it with the reference decoder
// (a faithful copy of docs/ble-manager.js `parseIndoorBikeData`) and assert the
// decoded sample equals the input. This proves the simulator is the inverse of
// the legacy BLE parser, so closed-loop scenarios are grounded in real bytes.

import {describe, it, expect} from "vitest";
import {
  encodeIndoorBikeData,
  decodeIndoorBikeData,
  parseControlPointWrite,
  encodeControlPointResponse,
  FTMS_OPCODES,
} from "./ftms.js";

describe("FTMS sim ↔ legacy parser round-trip", () => {
  it("decodes power+cadence+hr exactly as the legacy parser would", () => {
    const input = {power: 237, cadence: 92, speedKph: 31.4, hr: 148};
    const frame = encodeIndoorBikeData(input);
    const decoded = decodeIndoorBikeData(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.power).toBe(237);
    expect(decoded!.cadence).toBe(92); // 92*2 = 184 raw, /2 = 92
    expect(decoded!.speedKph).toBeCloseTo(31.4, 5);
    expect(decoded!.hrFromBike).toBe(148);
  });

  it("handles negative power (sint16)", () => {
    const frame = encodeIndoorBikeData({power: -25});
    const decoded = decodeIndoorBikeData(frame);
    expect(decoded!.power).toBe(-25);
  });

  it("omits absent fields and leaves them null", () => {
    const frame = encodeIndoorBikeData({power: 180}); // no speed/cadence/hr
    const decoded = decodeIndoorBikeData(frame);
    expect(decoded!.power).toBe(180);
    expect(decoded!.cadence).toBeNull();
    expect(decoded!.hrFromBike).toBeNull();
    // speed flag bit0 SET => absent
    expect(decoded!.speedKph).toBeNull();
  });

  it("round-trips half-rpm cadence resolution", () => {
    const frame = encodeIndoorBikeData({power: 100, cadence: 87.5});
    const decoded = decodeIndoorBikeData(frame);
    expect(decoded!.cadence).toBe(87.5); // 175 raw /2
  });

  it("preserves cadence + power without speed/hr", () => {
    const frame = encodeIndoorBikeData({power: 312, cadence: 101});
    const decoded = decodeIndoorBikeData(frame);
    expect(decoded!.power).toBe(312);
    expect(decoded!.cadence).toBe(101);
  });
});

describe("FTMS Control Point encode/decode", () => {
  it("decodes setTargetPower writes to watts", () => {
    const dv = new DataView(new ArrayBuffer(3));
    dv.setUint8(0, FTMS_OPCODES.setTargetPower);
    dv.setInt16(1, 215, true);
    const w = parseControlPointWrite(dv.buffer);
    expect(w.opcode).toBe(FTMS_OPCODES.setTargetPower);
    expect(w.param).toBe(215);
    expect(w.value).toBe(215);
  });

  it("decodes setTargetResistanceLevel (level*10) back to level", () => {
    const dv = new DataView(new ArrayBuffer(3));
    dv.setUint8(0, FTMS_OPCODES.setTargetResistanceLevel);
    dv.setInt16(1, 30 * 10, true); // level 30 sent as 300
    const w = parseControlPointWrite(dv.buffer);
    expect(w.opcode).toBe(FTMS_OPCODES.setTargetResistanceLevel);
    expect(w.value).toBe(30);
  });

  it("builds the [0x80, reqOpcode, 0x01] indicate response", () => {
    const resp = encodeControlPointResponse(FTMS_OPCODES.requestControl);
    expect(resp.getUint8(0)).toBe(0x80);
    expect(resp.getUint8(1)).toBe(FTMS_OPCODES.requestControl);
    expect(resp.getUint8(2)).toBe(0x01);
  });
});
