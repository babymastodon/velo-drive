// metrics.ts
//
// TypeScript port of docs/workout-metrics.js — pure workout metrics + helpers.
//
// Behavior is preserved EXACTLY from the legacy module, with ONE intentional
// divergence: the legacy `getAdjustedKjForPicker` `baseFtp <= 0` branch
// referenced an undefined `workout` variable (docs/workout-metrics.js:375),
// which throws at runtime. The port returns the correct value (`baseKj`)
// instead. This is the only behavior change in M1; it is covered by a unit
// test asserting the fixed behavior.

import type { RawSegment } from './model.js';
import { FREERIDE_SEGMENT_FLAG, isFreeRideSegment, segDurationSec } from './segments.js';

export const DEFAULT_FTP = 250;

/**
 * Power-zone upper thresholds (% of FTP). A power percentage falls in zone `i`
 * when `pct < ZONE_THRESHOLDS[i]`, or the top (anaerobic) zone when it exceeds
 * every threshold. Single source of truth shared by `zoneIndexForPct` here and
 * the chart's `zoneInfoFromRel` colorer — the two must stay byte-identical.
 */
export const ZONE_THRESHOLDS = [60, 76, 90, 105, 119] as const;

/**
 * Index (0..ZONE_THRESHOLDS.length) of the power zone a % of FTP falls in.
 * 0 = recovery … last = anaerobic. Callers map the index to their own labels.
 */
export function zoneIndexForPct(pct: number): number {
  for (let i = 0; i < ZONE_THRESHOLDS.length; i++) {
    if (pct < (ZONE_THRESHOLDS[i] as number)) return i;
  }
  return ZONE_THRESHOLDS.length;
}

export function formatDurationMinSec(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (!m) return sec ? `${sec} sec` : '0 min';
  if (!sec) return `${m} min`;
  return `${m} min ${sec} sec`;
}

// --------------------------- Metrics from segments ---------------------------

export interface SegmentMetrics {
  totalSec: number;
  durationMin: number;
  ifValue: number | null;
  tss: number | null;
  kj: number | null;
  ftp: number | null;
}

/**
 * Compute workout metrics from canonical rawSegments.
 *
 * rawSegments: Array<[minutes, startPct, endPct]>
 * ftp: numeric FTP (W)
 */
export function computeMetricsFromSegments(
  rawSegments: RawSegment[] | null | undefined,
  ftp: number | null | undefined,
): SegmentMetrics {
  const ftpVal = Number(ftp) || 0;
  if (!ftpVal || !rawSegments?.length) {
    return {
      totalSec: 0,
      durationMin: 0,
      ifValue: null,
      tss: null,
      kj: null,
      ftp: ftpVal || null,
    };
  }

  let totalSec = 0;
  let powerSec = 0;
  let sumFrac = 0; // sum of relative power samples
  const perSec: number[] = [];
  let sumFrac4 = 0; // sum of (relative power^4)

  for (const seg of rawSegments as unknown as number[][]) {
    const [minutes, startPct, endPct] = seg;
    const dur = segDurationSec(minutes as number);
    const isFreeRide = isFreeRideSegment(seg);
    totalSec += dur;

    if (isFreeRide) {
      continue;
    }

    const p0 = (startPct as number) / 100; // relative FTP 0–1
    const dp = ((endPct as number) - (startPct as number)) / 100; // delta relative FTP

    for (let i = 0; i < dur; i++) {
      const rel = p0 + dp * ((i + 0.5) / dur); // mid-point power
      sumFrac += rel;
      sumFrac4 += rel ** 4;
      perSec.push(rel);
      powerSec++;
    }
  }

  if (!powerSec) {
    return {
      totalSec,
      durationMin: totalSec / 60,
      ifValue: null,
      tss: null,
      kj: null,
      ftp: ftpVal,
    };
  }

  const durationMin = totalSec / 60;
  const window = 30;
  let sumPow4 = 0;
  if (perSec.length <= window) {
    const avg = perSec.reduce((s, v) => s + v, 0) / perSec.length;
    sumPow4 = avg ** 4 * perSec.length;
  } else {
    let windowSum = 0;
    for (let i = 0; i < perSec.length; i += 1) {
      windowSum += perSec[i] as number;
      if (i >= window) {
        windowSum -= perSec[i - window] as number;
      }
      if (i >= window - 1) {
        const avg = windowSum / window;
        sumPow4 += avg ** 4;
      }
    }
  }
  const samplesForNp = Math.max(1, perSec.length - (window - 1));
  const IF = Math.pow(sumPow4 / samplesForNp, 0.25);
  const tss = (powerSec * IF * IF) / 36;
  const kj = (ftpVal * sumFrac) / 1000;

  return {
    totalSec,
    durationMin,
    ifValue: IF,
    tss,
    kj,
    ftp: ftpVal,
  };
}

// --------------------------- Metrics from recorded samples -------------------

export interface Sample {
  t?: number;
  power?: number | null;
  hr?: number | null;
  cadence?: number | null;
  [key: string]: unknown;
}

export function buildPerSecondPower(
  samples: Sample[] | null | undefined,
  durationSec: number,
): Float32Array {
  const totalSec = Math.max(1, Math.ceil(durationSec || 0));
  const arr = new Float32Array(totalSec);
  if (!Array.isArray(samples) || !samples.length) return arr;

  const sorted = [...samples].sort((a, b) => (a.t || 0) - (b.t || 0));
  let idx = 0;
  let current = sorted[0];
  let power = Number(current?.power) || 0;

  for (let s = 0; s < totalSec; s += 1) {
    while (idx + 1 < sorted.length && ((sorted[idx + 1] as Sample).t || 0) <= s) {
      idx += 1;
      current = sorted[idx];
      power = Number(current?.power) || 0;
    }
    arr[s] = power;
  }
  return arr;
}

export interface SamplesMetrics {
  durationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  ftp: number;
  minutePower: number[];
  avgPower?: number;
  normalizedPower?: number | null;
  perSecondPower?: Float32Array;
  avgHr?: number | null;
}

export function computeMetricsFromSamples(
  samples: Sample[] | null | undefined,
  ftp: number | null | undefined,
  durationSecHint?: number,
): SamplesMetrics {
  const ftpVal = Number(ftp) || DEFAULT_FTP;
  const durationSec =
    durationSecHint ||
    (samples?.length
      ? Math.max(1, Math.round((samples[samples.length - 1] as Sample).t || 0))
      : 0);
  if (!durationSec || !samples?.length) {
    return {
      durationSec: 0,
      kj: null,
      ifValue: null,
      tss: null,
      ftp: ftpVal,
      minutePower: [],
    };
  }

  const perSec = buildPerSecondPower(samples, durationSec);

  let sumJ = 0;
  const perMin: number[] = [];
  let minSum = 0;
  let minCount = 0;
  for (let i = 0; i < perSec.length; i += 1) {
    const p = perSec[i] || 0;
    sumJ += p;
    minSum += p;
    minCount += 1;
    const atBoundary = (i + 1) % 60 === 0 || i === perSec.length - 1;
    if (atBoundary) {
      perMin.push(minCount ? minSum / minCount : 0);
      minSum = 0;
      minCount = 0;
    }
  }

  // Normalized power via 30s rolling avg
  const window = 30;
  let sumPow4 = 0;
  if (perSec.length <= window) {
    const avg = perSec.reduce((s, v) => s + v, 0) / perSec.length;
    sumPow4 = avg ** 4 * perSec.length;
  } else {
    let windowSum = 0;
    for (let i = 0; i < perSec.length; i += 1) {
      windowSum += perSec[i] as number;
      if (i >= window) {
        windowSum -= perSec[i - window] as number;
      }
      if (i >= window - 1) {
        const avg = windowSum / window;
        sumPow4 += avg ** 4;
      }
    }
  }
  const samplesForNp = Math.max(1, perSec.length - (window - 1));
  const np = Math.pow(sumPow4 / samplesForNp, 0.25);
  const IF = np && ftpVal ? np / ftpVal : null;
  const tss = IF != null ? (durationSec * IF * IF) / 36 : null;

  const avgPower = perSec.length ? sumJ / perSec.length : 0;
  const avgHr =
    samples?.length && samples.some((s) => Number.isFinite(s.hr))
      ? samples.reduce<{ sum: number; count: number }>(
          (acc, s) => ({
            sum: acc.sum + (Number.isFinite(s.hr) ? (s.hr as number) : 0),
            count: acc.count + (Number.isFinite(s.hr) ? 1 : 0),
          }),
          { sum: 0, count: 0 },
        )
      : { sum: 0, count: 0 };
  const avgHrVal = avgHr.count ? avgHr.sum / avgHr.count : null;

  return {
    durationSec,
    kj: sumJ / 1000,
    ifValue: IF,
    tss,
    ftp: ftpVal,
    minutePower: perMin,
    avgPower,
    normalizedPower: np || null,
    perSecondPower: perSec,
    avgHr: avgHrVal,
  };
}

// --------------------------- Scheduled workout helpers -----------------------

export interface ScheduledMetrics {
  durationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  zone: string;
}

export function computeScheduledMetrics(
  entry: { rawSegments?: RawSegment[] } | null | undefined,
  ftpInput: number | null | undefined,
): ScheduledMetrics | null {
  if (!entry || !entry.rawSegments?.length) return null;
  const ftpVal = Number(ftpInput) || DEFAULT_FTP;
  const metrics = computeMetricsFromSegments(entry.rawSegments, ftpVal);
  const zone = inferZoneFromSegments(entry.rawSegments);
  return {
    durationSec: metrics.totalSec || 0,
    kj: metrics.kj,
    ifValue: metrics.ifValue,
    tss: metrics.tss,
    zone,
  };
}

// --------------------------- Zone inference ---------------------------

/**
 * rawSegments: [[minutes, startPct, endPct?], ...]
 * pct values are in % of FTP (e.g. 75 for 75%).
 */
export function inferZoneFromSegments(
  rawSegments: RawSegment[] | null | undefined,
): string {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return 'Uncategorized';
  }

  const zoneTime: Record<string, number> = {
    recovery: 0,
    endurance: 0,
    tempo: 0,
    threshold: 0,
    vo2: 0,
    anaerobic: 0,
  };

  let totalSec = 0;
  let workSec = 0;

  for (const seg of rawSegments as unknown as unknown[][]) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const minutes = Number(seg[0]);
    const startPct = Number(seg[1]);
    const endPct = seg.length > 2 && seg[2] != null ? Number(seg[2]) : startPct;
    const isFreeRide = seg[3] === FREERIDE_SEGMENT_FLAG;

    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(startPct) ||
      !Number.isFinite(endPct)
    ) {
      continue;
    }

    const durSec = minutes * 60;
    if (durSec <= 0) continue;

    const avgPct = (startPct + endPct) / 2;
    if (isFreeRide) {
      totalSec += durSec;
      zoneTime.recovery = (zoneTime.recovery ?? 0) + durSec;
      continue;
    }

    totalSec += durSec;

    const zoneKey = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'anaerobic'][
      zoneIndexForPct(avgPct)
    ] as string;

    zoneTime[zoneKey] = (zoneTime[zoneKey] as number) + durSec;

    if (avgPct >= 75) workSec += durSec;
  }

  if (totalSec === 0) return 'Uncategorized';

  const z = zoneTime;
  const hiSec = (z.vo2 as number) + (z.anaerobic as number);
  const thrSec = z.threshold as number;
  const tempoSec = z.tempo as number;

  const workFrac = workSec / totalSec;

  // Light / easy: mostly recovery / endurance
  if (workFrac < 0.15) {
    if ((z.recovery as number) / totalSec >= 0.7) return 'Recovery';
    return 'Endurance';
  }

  const safeDiv = workSec || 1;
  const fracWork = {
    hi: hiSec / safeDiv,
    thr: thrSec / safeDiv,
    tempo: tempoSec / safeDiv,
  };

  if (fracWork.hi >= 0.2) {
    const anaerFrac = (z.anaerobic as number) / safeDiv;
    if (anaerFrac >= 0.1) {
      return 'Anaerobic';
    }
    return 'VO2Max';
  }

  if (fracWork.thr + fracWork.hi >= 0.35) {
    return 'Threshold';
  }

  if (fracWork.tempo + fracWork.thr + fracWork.hi >= 0.5) {
    return 'Tempo';
  }

  return 'Endurance';
}

// --------------------------- Picker helpers ---------------------------

/**
 * Buckets duration into label used by the duration filter.
 */
export function getDurationBucket(durationMin: number): string {
  if (!Number.isFinite(durationMin)) return '>240';
  if (durationMin <= 30) return '1-30';
  if (durationMin <= 45) return '31-45';
  if (durationMin <= 60) return '46-60';
  if (durationMin <= 75) return '61-75';
  if (durationMin <= 90) return '76-90';
  if (durationMin <= 120) return '91-120';
  if (durationMin <= 180) return '121-180';
  if (durationMin <= 240) return '181-240';
  return '>240';
}

/**
 * Adjust kJ to the current FTP (used in picker list sorting).
 *
 * NOTE (intentional M1 divergence): the legacy version returned
 * `workout.baseKj` in the `baseFtp <= 0` branch, where `workout` is undefined
 * and throws a ReferenceError. The fixed behavior returns `baseKj`, which is
 * the value the branch clearly intended to pass through unchanged.
 */
export function getAdjustedKjForPicker(
  baseKj: number | null | undefined,
  baseFtp: number,
  currentFtp: number,
): number | null | undefined {
  if (
    baseKj == null ||
    !Number.isFinite(baseFtp) ||
    !Number.isFinite(currentFtp)
  ) {
    return baseKj;
  }
  if (baseFtp <= 0) return baseKj; // fixed: legacy referenced undefined `workout`
  return baseKj * (currentFtp / baseFtp);
}
