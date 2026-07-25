import {describe, expect, test} from "vitest";
import type {CanonicalWorkout} from "../../src/core/model.js";
import {
  generateDemoTelemetry,
  workoutDurationSec,
} from "../docs/demo-data.js";

const FTP = 250;

function simpleStepWorkout(): CanonicalWorkout {
  return {
    source: "VeloDrive",
    sourceURL: "",
    workoutTitle: "Telemetry check",
    description: "",
    rawSegments: [
      [5, 50, 50],
      [5, 100, 100],
      [5, 50, 50],
    ],
    textEvents: [],
  };
}

describe("documentation demo data", () => {
  test("power follows its target closely outside a few marked deviations", () => {
    const workout = simpleStepWorkout();
    const samples = generateDemoTelemetry(workout, FTP);
    const ordinary = samples.filter((sample) => !sample.isGap && sample.targetPower > 0);
    const gaps = samples.filter((sample) => sample.isGap);
    const ordinaryErrors = ordinary.map(
      (sample) => Math.abs(sample.power - sample.targetPower) / sample.targetPower,
    );
    const gapErrors = gaps.map(
      (sample) => Math.abs(sample.power - sample.targetPower) / sample.targetPower,
    );

    expect(Math.max(...ordinaryErrors)).toBeLessThanOrEqual(0.035);
    expect(ordinaryErrors.reduce((sum, value) => sum + value, 0) / ordinaryErrors.length).toBeLessThan(
      0.012,
    );
    expect(gaps.length / samples.length).toBeLessThan(0.025);
    expect(Math.max(...gapErrors)).toBeGreaterThan(0.08);
    expect(samples[0]!.t).toBe(1);
    expect(samples.at(-1)!.t).toBe(workoutDurationSec(workout));

    const prefix = generateDemoTelemetry(workout, FTP, 7 * 60);
    expect(prefix).toEqual(samples.slice(0, 7 * 60));
  });

  test("heart rate reacts gradually and recovers more slowly than power", () => {
    const samples = generateDemoTelemetry(simpleStepWorkout(), FTP);

    // The target doubles at 5:00, but HR cannot jump with it.
    expect(Math.abs(samples[300]!.hr - samples[299]!.hr)).toBeLessThanOrEqual(2);
    expect(samples[420]!.hr).toBeGreaterThan(samples[300]!.hr + 15);

    // The target halves at 10:00. HR remains elevated at the transition and
    // then falls over the next minute instead of mirroring power instantly.
    expect(Math.abs(samples[600]!.hr - samples[599]!.hr)).toBeLessThanOrEqual(2);
    expect(samples[660]!.hr).toBeLessThan(samples[600]!.hr - 8);

    const hrs = samples.map((sample) => sample.hr);
    expect(Math.min(...hrs)).toBeGreaterThanOrEqual(88);
    expect(Math.max(...hrs)).toBeLessThanOrEqual(190);
  });

  test("cadence remains near the prescribed value with small variation", () => {
    const workout: CanonicalWorkout = {
      ...simpleStepWorkout(),
      rawSegments: [[10, 70, 70, null, 92]],
    };
    const samples = generateDemoTelemetry(workout, FTP);
    const cadence = samples.map((sample) => sample.cadence);

    expect(Math.min(...cadence)).toBeGreaterThanOrEqual(89);
    expect(Math.max(...cadence)).toBeLessThanOrEqual(95);
    expect(new Set(cadence).size).toBeGreaterThan(2);
  });

  test("cadence slews instead of stepping instantly at an interval boundary", () => {
    const samples = generateDemoTelemetry(simpleStepWorkout(), FTP);
    const before = samples[299]!.cadence;
    const firstHardSample = samples[300]!.cadence;
    const settledHardSample = samples[330]!.cadence;

    expect(firstHardSample - before).toBeLessThanOrEqual(4);
    expect(settledHardSample).toBeGreaterThan(firstHardSample + 4);
  });
});
