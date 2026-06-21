// history.ts
//
// Pure ride-history analytics. These functions take parsed FIT data / samples
// and return the planner's preview / detail models — no I/O, no DOM, no caching.
// WebFileStore keeps the file/cache I/O and CALLS buildHistoryPreview; the
// planner's openDetail CALLS buildRideDetail. The stats-cache + planner tests
// pin the behavior.

import type { CanonicalWorkout, RawSegment } from './model.js';
import type { ParseFitResult } from './fit.js';

/** A raw FIT history file entry (name + parsed contents). */
export interface HistoryFitEntry {
  fileName: string;
  parsed: ParseFitResult;
}
import {
  DEFAULT_FTP,
  computeMetricsFromSamples,
  inferZoneFromSegments,
  type Sample,
} from './metrics.js';
import {
  buildPowerSegments,
  buildPowerCurve,
  computeHrCadStats,
  powerMaxFromIntervals,
  POWER_CURVE_DURS,
  type PowerInterval,
  type PowerCurvePoint,
} from './planner-analysis.js';

/**
 * A computed per-ride history preview (the planner calendar card model). Built
 * by buildHistoryPreview from a parsed FIT + cached by file name (by
 * WebFileStore) so repeat opens skip the parse + metric/segment math.
 * `startedAt` is serialized as an ISO string in the cache and rehydrated to a
 * Date.
 */
export interface HistoryPreview {
  fileName: string;
  workoutTitle: string;
  durationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  startedAt: Date | null;
  rawSegments: RawSegment[];
  powerSegments: PowerInterval[];
  powerMax: number;
  zone: string;
}

/**
 * The full ride detail-view model (stat chips + power curve + planned-vs-actual
 * chart). Built by buildRideDetail from a parsed FIT. Carries the VI/EF/paused/
 * HR-cad derivations the planner detail panel renders.
 */
export interface RideDetail {
  fileName: string;
  workoutTitle: string;
  durationSec: number;
  activeDurationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  avgPower?: number;
  normalizedPower?: number | null;
  vi: number | null;
  ef: number | null;
  ftp: number;
  rawSegments: RawSegment[];
  samples: { t?: number; power?: number | null; hr?: number | null; cadence?: number | null }[];
  powerCurve: PowerCurvePoint[];
  startedAt: Date | null;
  pausedSec: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  maxCadence?: number | null;
  zone: string;
}

/**
 * Build the per-ride preview model from a parsed FIT + its file name. Pure.
 */
export function buildHistoryPreview(fileName: string, parsed: ParseFitResult): HistoryPreview {
  const cw = parsed.canonicalWorkout || ({} as CanonicalWorkout);
  const meta = parsed.meta || {};
  const ftp = meta.ftp || DEFAULT_FTP;
  // FitSample lacks the index signature Sample carries; the fields used are
  // identical, so widen for the metric/segment helpers (same call PlannerView
  // makes against parsed.samples).
  const samples = (parsed.samples || []) as Sample[];
  const lastSample = samples.length ? samples[samples.length - 1] : null;
  const durationSecHint =
    meta.totalTimerSec != null
      ? Math.max(1, Math.round(meta.totalTimerSec))
      : meta.startedAt && meta.endedAt
        ? Math.max(1, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
        : Math.max(1, Math.round(lastSample?.t || 0));
  const metrics = computeMetricsFromSamples(samples, ftp, durationSecHint);
  const powerSegments = buildPowerSegments(samples, durationSecHint).intervals;
  return {
    fileName,
    workoutTitle: cw.workoutTitle || fileName.replace(/\.fit$/i, ''),
    durationSec: metrics.durationSec || durationSecHint || 0,
    kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
    ifValue: metrics.ifValue,
    tss: metrics.tss,
    startedAt: meta.startedAt || null,
    rawSegments: cw.rawSegments || [],
    powerSegments,
    powerMax: powerMaxFromIntervals(powerSegments),
    zone: inferZoneFromSegments(cw.rawSegments || []),
  };
}

/**
 * Build the full ride detail model from a parsed FIT, its file name, and the
 * preview-level fallbacks (title / startedAt / zone) the planner already had.
 * `startedAtFallback` is used when the FIT carried no startedAt (falls back to
 * the file's day key). Pure: VI/EF/paused/HR-cad math.
 */
export function buildRideDetail(
  fileName: string,
  parsed: ParseFitResult,
  fallback: {
    workoutTitle: string;
    startedAt: Date | null;
    startedAtFallback: Date | null;
    zone: string;
  },
): RideDetail {
  const cw = parsed.canonicalWorkout || ({} as CanonicalWorkout);
  const meta = parsed.meta || {};
  const samples = parsed.samples || [];
  const ftp = meta.ftp || DEFAULT_FTP;
  const lastSample = samples.length ? samples[samples.length - 1] : null;
  const durationSecHint =
    meta.totalTimerSec != null
      ? Math.max(1, Math.round(meta.totalTimerSec))
      : meta.startedAt && meta.endedAt
        ? Math.max(1, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
        : Math.max(1, Math.round(lastSample?.t || 0));
  const metrics = computeMetricsFromSamples(samples as Sample[], ftp, durationSecHint);
  const totalTimerSec = meta.totalTimerSec || metrics.durationSec || durationSecHint || 0;
  const totalElapsedSec =
    meta.totalElapsedSec ||
    (meta.startedAt && meta.endedAt
      ? Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
      : totalTimerSec);
  const pausedSec = Math.max(0, totalElapsedSec - totalTimerSec);
  const hrStats = computeHrCadStats(samples as Sample[]);
  const curvePoints = buildPowerCurve(metrics.perSecondPower || [], POWER_CURVE_DURS);
  const activeDurationSec =
    totalTimerSec || Math.max(0, (metrics.durationSec || durationSecHint || 0) - pausedSec);
  const vi =
    metrics.avgPower && metrics.avgPower > 0 && metrics.normalizedPower
      ? metrics.normalizedPower / metrics.avgPower
      : null;
  const ef = metrics.avgHr && metrics.avgHr > 0 ? (metrics.normalizedPower || 0) / metrics.avgHr : null;

  return {
    fileName,
    workoutTitle: cw.workoutTitle || fallback.workoutTitle,
    durationSec: metrics.durationSec || durationSecHint || 0,
    activeDurationSec,
    kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
    ifValue: metrics.ifValue,
    tss: metrics.tss,
    avgPower: metrics.avgPower,
    normalizedPower: metrics.normalizedPower,
    vi,
    ef,
    ftp,
    rawSegments: cw.rawSegments || [],
    samples,
    powerCurve: curvePoints,
    startedAt: meta.startedAt || fallback.startedAt || fallback.startedAtFallback,
    pausedSec,
    avgHr: hrStats.avgHr,
    maxHr: hrStats.maxHr,
    avgCadence: hrStats.avgCadence,
    maxCadence: hrStats.maxCadence,
    zone: fallback.zone || inferZoneFromSegments(cw.rawSegments || []),
  };
}
