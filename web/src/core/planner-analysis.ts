// planner-analysis.ts
//
// TypeScript port of the pure (non-DOM) helpers from docs/planner-analysis.js:
// the "actual power" interval builder for the day mini-charts, the
// power-duration curve builder for the ride detail view, and HR/cadence stats.
// Behavior is preserved verbatim from the legacy module.

import type { Sample } from './metrics.js';

/** [pStart, pEnd, durSec] step-line intervals describing recorded power. */
export type PowerInterval = [number, number, number];

export interface PowerSegmentsResult {
  intervals: PowerInterval[];
  maxPower: number;
  totalSec: number;
}

export interface HrCadStats {
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  maxCadence?: number | null;
}

export interface PowerCurvePoint {
  durSec: number;
  power: number;
}

export function computeHrCadStats(samples: Sample[] | null | undefined): HrCadStats {
  if (!Array.isArray(samples) || !samples.length) return {};
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let cadMax = 0;
  samples.forEach((s) => {
    if (Number.isFinite(s.hr as number)) {
      hrSum += s.hr as number;
      hrCount += 1;
      hrMax = Math.max(hrMax, s.hr as number);
    }
    if (Number.isFinite(s.cadence as number)) {
      cadSum += s.cadence as number;
      cadCount += 1;
      cadMax = Math.max(cadMax, s.cadence as number);
    }
  });
  return {
    avgHr: hrCount ? hrSum / hrCount : null,
    maxHr: hrCount ? hrMax : null,
    avgCadence: cadCount ? cadSum / cadCount : null,
    maxCadence: cadCount ? cadMax : null,
  };
}

export function buildPowerSegments(
  samples: Sample[] | null | undefined,
  durationSecHint: number,
): PowerSegmentsResult {
  if (!Array.isArray(samples) || !samples.length) {
    return { intervals: [], maxPower: 0, totalSec: 0 };
  }
  const sorted = [...samples].sort((a, b) => (a.t || 0) - (b.t || 0));
  const lastSample = sorted[sorted.length - 1];
  const totalSec = Math.max(1, durationSecHint || Math.round(lastSample?.t || 0) || 0);
  const bucketSize = 5;
  const bucketCount = Math.ceil(totalSec / bucketSize);
  const buckets: number[][] = new Array(bucketCount).fill(null).map(() => []);

  sorted.forEach((s) => {
    const t = Math.max(0, Math.round(s.t || 0));
    const idx = Math.min(bucketCount - 1, Math.floor(t / bucketSize));
    (buckets[idx] as number[]).push(Number(s.power) || 0);
  });

  const median = (arr: number[]): number => {
    if (!arr.length) return 0;
    const sortedVals = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedVals.length / 2);
    return sortedVals.length % 2 === 0
      ? ((sortedVals[mid - 1] as number) + (sortedVals[mid] as number)) / 2
      : (sortedVals[mid] as number);
  };

  let intervals: PowerInterval[] = [];
  buckets.forEach((vals, i) => {
    const power = median(vals);
    const durStart = i * bucketSize;
    const dur = i === bucketCount - 1 ? Math.max(1, totalSec - durStart) : bucketSize;
    intervals.push([power, power, dur]);
  });

  if (!intervals.length) return { intervals: [], maxPower: 0, totalSec };

  const slopeAngle = (p0: number, p1: number, dur: number) =>
    Math.atan(dur ? (p1 - p0) / dur : 0);

  let merged = true;
  while (merged && intervals.length > 1) {
    merged = false;
    const next: PowerInterval[] = [];
    for (let i = 0; i < intervals.length; i += 1) {
      const cur = intervals[i] as PowerInterval;
      const nxt = intervals[i + 1];
      if (!nxt) {
        next.push(cur);
        continue;
      }
      const durSum = cur[2] + nxt[2];
      const tolerance =
        durSum < 30
          ? (10 * Math.PI) / 180
          : durSum < 60
            ? (5 * Math.PI) / 180
            : durSum < 180
              ? (3 * Math.PI) / 180
              : durSum < 300
                ? (2 * Math.PI) / 180
                : (1 * Math.PI) / 180;
      const angCur = slopeAngle(cur[0], cur[1], cur[2]);
      const angNext = slopeAngle(nxt[0], nxt[1], nxt[2]);
      const diff = Math.abs(angCur - angNext);
      if (diff <= tolerance) {
        next.push([cur[0], nxt[1], cur[2] + nxt[2]]);
        merged = true;
        i += 1;
      } else {
        next.push(cur);
      }
    }
    intervals = next;
  }

  const maxPower = intervals.reduce(
    (m, [p0, p1]) => Math.max(m, Math.abs(p0 || 0), Math.abs(p1 || 0)),
    0,
  );

  return { intervals, maxPower, totalSec };
}

export function powerMaxFromIntervals(intervals: PowerInterval[] | null | undefined): number {
  if (!Array.isArray(intervals) || !intervals.length) return 0;
  return intervals.reduce((m, [p0, p1]) => Math.max(m, Math.abs(p0 || 0), Math.abs(p1 || 0)), 0);
}

export function buildPowerCurve(
  perSec: ArrayLike<number> | null | undefined,
  durations: number[],
): PowerCurvePoint[] {
  if (!perSec || !perSec.length) return [];
  const prefix = new Float64Array(perSec.length + 1);
  for (let i = 0; i < perSec.length; i += 1) {
    prefix[i + 1] = (prefix[i] as number) + (perSec[i] as number);
  }
  const maxDur = perSec.length;
  const dynDurations: number[] = [];
  for (let d = 1; d <= Math.min(maxDur, 60); d += 1) dynDurations.push(d);
  for (let d = 62; d <= Math.min(maxDur, 180); d += 2) dynDurations.push(d);
  for (let d = 182; d <= Math.min(maxDur, 360); d += 5) dynDurations.push(d);
  for (let d = 365; d <= Math.min(maxDur, 1800); d += 10) dynDurations.push(d);
  for (let d = 1810; d <= Math.min(maxDur, 7200); d += 30) dynDurations.push(d);
  for (let d = 7230; d <= Math.min(maxDur, 28800); d += 60) dynDurations.push(d);
  const allDurations = Array.from(new Set([...durations, ...dynDurations]))
    .filter((d) => d >= 1 && d <= maxDur)
    .sort((a, b) => a - b);

  const result: PowerCurvePoint[] = [];
  allDurations.forEach((durRaw) => {
    const dur = Math.max(1, Math.round(durRaw));
    let best = 0;
    let windowSum = (prefix[dur] as number) - (prefix[0] as number);
    best = windowSum / dur;
    for (let i = dur; i < perSec.length; i += 1) {
      windowSum += (perSec[i] as number) - (perSec[i - dur] as number);
      const avg = windowSum / dur;
      if (avg > best) best = avg;
    }
    result.push({ durSec: dur, power: best });
  });
  return result;
}

export const POWER_CURVE_DURS = [
  1, 2, 5, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2400, 3600,
  5400, 7200, 14400, 28800,
];
