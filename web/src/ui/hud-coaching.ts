// hud-coaching.ts
//
// Live coaching for the running HUD center title. Produces:
//   * per-segment instruction ("Maintain N watts for D at C RPM",
//     "Ramp up/down to N watts", "Free ride at N watts/resistance")
//   * an "In N - " lookahead when the current segment is >=20s and <=10s
//     remain (shows the NEXT segment's instruction)
//   * "Speed up / Slow down - target N RPM" after >=5s sustained off-cadence.
//
// The cadence-coaching needs persistence across renders (it accrues seconds),
// so it lives in a small stateful CadenceCoach the BottomNav owns.

import type { EngineViewModel } from '../core/engine.js';
import type { RawSegment } from '../core/model.js';
import { DEFAULT_FTP, formatDurationMinSec } from '../core/metrics.js';
import { getRawCadence, isFreeRideSegment, segDurationSec } from '../core/segments.js';

export interface SegInfo {
  index: number;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  pStartRel: number;
  pEndRel: number;
  cadenceRpm: number | null;
  isFreeRide: boolean;
}

export function getSegmentAtTime(rawSegments: RawSegment[] | undefined, tSec: number): SegInfo | null {
  if (!Array.isArray(rawSegments) || !rawSegments.length) return null;
  let acc = 0;
  for (let i = 0; i < rawSegments.length; i += 1) {
    const seg = rawSegments[i]!;
    const minutes = Number(seg?.[0]) || 0;
    const dur = segDurationSec(minutes);
    const start = acc;
    const end = acc + dur;
    if (tSec < end) {
      const startPct = Number(seg?.[1]) || 0;
      const endPct = seg?.[2] != null ? Number(seg?.[2]) : startPct;
      return {
        index: i,
        startTimeSec: start,
        endTimeSec: end,
        durationSec: dur,
        pStartRel: startPct / 100,
        pEndRel: endPct / 100,
        cadenceRpm: getRawCadence(seg),
        isFreeRide: isFreeRideSegment(seg),
      };
    }
    acc = end;
  }
  return null;
}

export interface TitlePart {
  text: string;
  strong?: boolean;
}

/** Build the segment instruction parts (with an optional "In N - " prefix). */
export function buildSegmentDescriptionParts(
  vm: EngineViewModel,
  segInfo: SegInfo | null,
  prefix = '',
): TitlePart[] {
  if (!segInfo) return [{ text: vm.canonicalWorkout?.workoutTitle || 'Workout' }];
  const ftp = vm.currentFtp || DEFAULT_FTP;
  const cadence = Number.isFinite(segInfo.cadenceRpm as number)
    ? Math.round(segInfo.cadenceRpm as number)
    : null;
  const pStart = segInfo.pStartRel || 0;
  const pEnd = segInfo.pEndRel != null ? segInfo.pEndRel : pStart;
  const ramping = Math.abs(pEnd - pStart) > 1e-6;
  const endW = Math.round(pEnd * ftp);
  const durationLabel = Number.isFinite(segInfo.durationSec)
    ? formatDurationMinSec(segInfo.durationSec)
    : null;
  const parts: TitlePart[] = [];

  if (prefix) parts.push({ text: prefix });

  if (segInfo.isFreeRide) {
    if (vm.freeRideMode === 'erg') {
      const watts = Math.round(vm.manualErgTarget || ftp * 0.6);
      parts.push({ text: 'Free ride at ' });
      parts.push({ text: String(watts), strong: true });
      parts.push({ text: ' watts' });
    } else {
      const resistance = Math.round(vm.manualResistance || 0);
      parts.push({ text: 'Free ride at ' });
      parts.push({ text: String(resistance), strong: true });
      parts.push({ text: ' resistance' });
    }
    if (durationLabel) {
      parts.push({ text: ' for ' });
      parts.push({ text: durationLabel, strong: true });
    }
    return parts;
  }

  if (ramping) {
    const rampDir = pEnd >= pStart ? 'Ramp up to ' : 'Ramp down to ';
    parts.push({ text: rampDir });
    parts.push({ text: String(endW), strong: true });
    parts.push({ text: ' watts' });
  } else {
    const watts = Math.round(pStart * ftp);
    parts.push({ text: 'Maintain ' });
    parts.push({ text: String(watts), strong: true });
    parts.push({ text: ' watts' });
  }

  if (durationLabel) {
    parts.push({ text: ' for ' });
    parts.push({ text: durationLabel, strong: true });
  }

  if (cadence != null) {
    parts.push({ text: ' at ' });
    parts.push({ text: String(cadence), strong: true });
    parts.push({ text: ' RPM' });
  }

  return parts;
}

function getCurrentCadenceTarget(vm: EngineViewModel): number | null {
  const raws = vm.canonicalWorkout?.rawSegments;
  if (!Array.isArray(raws) || !raws.length) return null;
  const t = vm.workoutRunning || vm.elapsedSec > 0 ? vm.elapsedSec : 0;
  const seg = getSegmentAtTime(raws, t);
  if (!seg || seg.isFreeRide) return null;
  if (!Number.isFinite(seg.cadenceRpm as number)) return null;
  return Math.round(seg.cadenceRpm as number);
}

/**
 * Stateful tracker for sustained off-cadence direction. Accrues seconds while
 * the rider stays >5 rpm out of band; the title shows "Speed up/Slow down" once
 * >=5s in one direction.
 */
export class CadenceCoach {
  private seconds = 0;
  private direction: 'fast' | 'slow' | null = null;
  private lastElapsedSec: number | null = null;

  reset(): void {
    this.seconds = 0;
    this.direction = null;
    this.lastElapsedSec = null;
  }

  update(vm: EngineViewModel): { seconds: number; direction: 'fast' | 'slow' | null } {
    const canTrack = !!(vm && vm.workoutRunning && !vm.workoutPaused && !vm.workoutStarting);
    if (!canTrack) {
      this.reset();
      return { seconds: this.seconds, direction: this.direction };
    }
    const elapsed = Math.max(0, vm.elapsedSec || 0);
    const cadenceTarget = getCurrentCadenceTarget(vm);
    const cadenceActual = Number.isFinite(vm.lastSampleCadence as number)
      ? Math.round(vm.lastSampleCadence as number)
      : null;
    let nextDirection: 'fast' | 'slow' | null = null;
    if (cadenceTarget != null && cadenceActual != null) {
      if (cadenceActual > cadenceTarget + 5) nextDirection = 'fast';
      if (cadenceActual < cadenceTarget - 5) nextDirection = 'slow';
    }
    if (this.lastElapsedSec == null) {
      this.lastElapsedSec = elapsed;
      this.seconds = nextDirection ? 1 : 0;
      this.direction = nextDirection;
      return { seconds: this.seconds, direction: this.direction };
    }
    if (elapsed > this.lastElapsedSec) {
      const delta = Math.max(1, elapsed - this.lastElapsedSec);
      if (!nextDirection) {
        this.seconds = 0;
        this.direction = null;
      } else if (this.direction && this.direction !== nextDirection) {
        this.seconds = delta;
        this.direction = nextDirection;
      } else {
        this.seconds += delta;
        this.direction = nextDirection;
      }
      this.lastElapsedSec = elapsed;
    }
    return { seconds: this.seconds, direction: this.direction };
  }
}

export interface CoachingTitle {
  // When `text` is set, render it as plain text (cadence coaching / fallback).
  // When `parts` is set, render the rich strong/plain run.
  text?: string;
  parts?: TitlePart[];
}

/**
 * Compute the running-title content for the current VM. Returns plain `text`
 * for cadence coaching / non-running fallback, or rich `parts` for the segment
 * instruction (with optional "In N - " lookahead).
 */
export function computeCoachingTitle(vm: EngineViewModel, coach: CadenceCoach): CoachingTitle {
  const cw = vm.canonicalWorkout;

  if (vm.workoutPaused || vm.workoutStarting) coach.reset();

  if (vm.workoutRunning && !vm.workoutPaused && cw?.rawSegments?.length) {
    const cadenceTarget = getCurrentCadenceTarget(vm);
    const cadenceState = coach.update(vm);
    if (cadenceTarget != null && cadenceState.seconds >= 5 && cadenceState.direction) {
      const verb = cadenceState.direction === 'slow' ? 'Speed up' : 'Slow down';
      return { text: `${verb} - target ${cadenceTarget} RPM` };
    }
    const elapsed = Math.max(0, vm.elapsedSec || 0);
    const currentSeg = getSegmentAtTime(cw.rawSegments, elapsed);
    let targetSeg = currentSeg;
    let prefix = '';
    if (currentSeg) {
      const remaining = currentSeg.endTimeSec - elapsed;
      if (currentSeg.durationSec >= 20 && remaining <= 10) {
        const nextSeg = getSegmentAtTime(cw.rawSegments, currentSeg.endTimeSec + 0.1);
        if (nextSeg) {
          targetSeg = nextSeg;
          const remainingSec = Math.max(1, Math.ceil(remaining));
          prefix = `In ${remainingSec} - `;
        }
      }
    }
    return { parts: buildSegmentDescriptionParts(vm, targetSeg, prefix) };
  }

  return { text: cw?.workoutTitle || 'Workout running' };
}
