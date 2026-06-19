// hud-format.ts
//
// Pure presentation helpers ported from docs/workout.js render layer
// (formatting, target-power, current cadence target, zone color). These map the
// engine view-model to display values exactly as the legacy HUD does.

import type { EngineViewModel } from '../core/engine.js';
import { DEFAULT_FTP } from '../core/metrics.js';
import { getRawCadence, isFreeRideSegment, segDurationSec } from '../core/segments.js';
import { zoneInfoFromRel, mixColors, getCssVar } from '../core/chart.js';

export function formatTimeMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatTimeHHMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Workout target watts at absolute time t (interpolated). null for freeride. */
export function getWorkoutTargetAtTime(vm: EngineViewModel, tSec: number): number | null {
  const cw = vm.canonicalWorkout;
  if (!cw || !cw.rawSegments?.length) return null;
  const ftp = vm.currentFtp || DEFAULT_FTP;
  let total = 0;
  for (const seg of cw.rawSegments) total += segDurationSec(seg[0] || 0);
  const t = Math.min(Math.max(0, tSec), total);

  let acc = 0;
  for (const seg of cw.rawSegments) {
    const dur = segDurationSec(seg[0] || 0);
    const end = acc + dur;
    if (t < end) {
      if (isFreeRideSegment(seg)) return null;
      const pStartRel = (seg[1] || 0) / 100;
      const pEndRel = (seg[2] != null ? seg[2] : seg[1] || 0) / 100;
      const rel = (t - acc) / dur;
      const startW = pStartRel * ftp;
      const endW = pEndRel * ftp;
      return Math.round(startW + (endW - startW) * Math.min(1, Math.max(0, rel)));
    }
    acc = end;
  }
  return null;
}

export function timeForTarget(vm: EngineViewModel): number {
  return vm.workoutRunning || vm.elapsedSec > 0 ? vm.elapsedSec : 0;
}

export function computeTargetPower(vm: EngineViewModel): number | null {
  if (vm.isFreeRideActive && vm.freeRideMode === 'erg') return vm.manualErgTarget;
  if (vm.canonicalWorkout?.rawSegments?.length) {
    return getWorkoutTargetAtTime(vm, timeForTarget(vm));
  }
  return null;
}

export function getCurrentCadenceTarget(vm: EngineViewModel): number | null {
  const cw = vm.canonicalWorkout;
  if (!cw || !cw.rawSegments?.length) return null;
  const t = timeForTarget(vm);
  let acc = 0;
  for (const seg of cw.rawSegments) {
    const dur = segDurationSec(seg[0] || 0);
    const end = acc + dur;
    let total = 0;
    for (const s of cw.rawSegments) total += segDurationSec(s[0] || 0);
    const tc = Math.min(Math.max(0, t), total);
    if (tc < end) {
      if (isFreeRideSegment(seg)) return null;
      const cad = getRawCadence(seg);
      return cad != null && Number.isFinite(cad) ? Math.round(cad) : null;
    }
    acc = end;
  }
  return null;
}

/** ▾ (too fast) / ▴ (too slow) / "" — threshold strictly > 5 rpm. */
export function cadenceIndicator(vm: EngineViewModel): string {
  const actual = Number.isFinite(vm.lastSampleCadence as number)
    ? Math.round(vm.lastSampleCadence as number)
    : null;
  const target = getCurrentCadenceTarget(vm);
  if (actual == null || target == null) return '';
  const delta = actual - target;
  if (Math.abs(delta) > 5) return delta > 0 ? '▾' : '▴';
  return '';
}

/** Zone-derived color shared by every stat value (darkened 30%). */
export function statColor(vm: EngineViewModel): string {
  let rel: number;
  if (vm.isFreeRideActive && vm.freeRideMode === 'erg') {
    rel = (vm.manualErgTarget || 0) / (vm.currentFtp || DEFAULT_FTP);
  } else {
    const target = getWorkoutTargetAtTime(vm, timeForTarget(vm));
    const ref =
      target != null
        ? target
        : vm.lastSamplePower != null
          ? vm.lastSamplePower
          : (vm.currentFtp || DEFAULT_FTP) * 0.6;
    rel = ref / (vm.currentFtp || DEFAULT_FTP);
  }
  const zone = zoneInfoFromRel(rel);
  const base = zone.color || getCssVar('--text-main');
  return mixColors(base, '#000000', 0.3);
}

export function powerText(vm: EngineViewModel): string {
  if (vm.lastSamplePower == null) return '--';
  const p = Math.round(vm.lastSamplePower);
  return String(p < 0 ? 0 : p);
}

export function hrText(vm: EngineViewModel): string {
  return vm.lastSampleHr != null ? String(Math.round(vm.lastSampleHr)) : '--';
}

export function cadenceText(vm: EngineViewModel): string {
  return Number.isFinite(vm.lastSampleCadence as number)
    ? String(Math.round(vm.lastSampleCadence as number))
    : '--';
}

export function targetPowerText(vm: EngineViewModel): string {
  const target = computeTargetPower(vm);
  return target != null ? String(Math.round(target)) : '--';
}
