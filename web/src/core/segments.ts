// segments.ts
//
// Single source of truth for the positional `RawSegment` tuple
// (`[minutes, startPct, endPct, type?, cadence?]`). These helpers were
// previously copy-pasted across engine/chart/metrics/zwo/builder-backend and
// the HUD modules; they are consolidated here WITHOUT changing the tuple shape
// or any computed value.
//
// CRITICAL: the tuple layout is load-bearing for the FIT/zwo codecs. These
// accessors only WRAP the existing positional indices (seg[0]..seg[4]); they do
// not restructure the tuple or alter any value.

import type { RawSegment } from './model.js';

/** Flag value in slot [3] that marks a free-ride segment. */
export const FREERIDE_SEGMENT_FLAG = 'freeride';

/** Relative power (% of FTP, 0–1) used to draw/serialize free-ride segments. */
export const FREERIDE_POWER_REL = 0.5;

/**
 * The tuple is hand-indexed across the codebase and several call sites pass a
 * loosely-typed array (`unknown[]`). Accept that union here so a single set of
 * accessors serves every caller without per-site casts.
 */
type RawSegmentLike = RawSegment | readonly unknown[] | null | undefined;

/** Duration in minutes (slot [0]). */
export function getRawMinutes(seg: RawSegmentLike): number {
  return Number((seg as unknown[] | undefined)?.[0]) || 0;
}

/** Start power % FTP (slot [1]). */
export function getRawStartPct(seg: RawSegmentLike): unknown {
  return (seg as unknown[] | undefined)?.[1];
}

/** End power % FTP (slot [2]). */
export function getRawEndPct(seg: RawSegmentLike): unknown {
  return (seg as unknown[] | undefined)?.[2];
}

/** Type flag (slot [3]) — e.g. 'freeride', `null`, or a numeric cadence. */
export function getRawType(seg: RawSegmentLike): unknown {
  return (seg as unknown[] | undefined)?.[3];
}

/**
 * Segment duration in whole seconds. The canonical formula
 * `Math.max(1, Math.round(min * 60))`.
 */
export function segDurationSec(minutes: number): number {
  return Math.max(1, Math.round((minutes || 0) * 60));
}

/** True when the segment's type slot is the free-ride flag. */
export function isFreeRideSegment(seg: RawSegmentLike): boolean {
  return Array.isArray(seg) && seg[3] === FREERIDE_SEGMENT_FLAG;
}

/**
 * Cadence target (rpm) for the segment, or `null`: free-ride has none;
 * otherwise prefer slot [4], falling back to a numeric slot [3].
 */
export function getRawCadence(seg: RawSegmentLike): number | null {
  if (!Array.isArray(seg)) return null;
  if (seg[3] === FREERIDE_SEGMENT_FLAG) return null;
  if (Number.isFinite(seg[4] as number)) return Number(seg[4]);
  if (typeof seg[3] === 'number' && Number.isFinite(seg[3])) return Number(seg[3]);
  return null;
}
