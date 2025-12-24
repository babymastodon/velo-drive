// workout-metrics.js
// Pure workout metrics + ZWO parsing helpers shared across the app.

export const DEFAULT_FTP = 250;
const FREERIDE_SEGMENT_FLAG = "freeride";

export function formatDurationMinSec(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (!sec) return `${m} min`;
  return `${m} min ${sec} sec`;
}


// --------------------------- Metrics from segments ---------------------------

/**
 * Compute workout metrics from canonical rawSegments.
 *
 * rawSegments: Array<[minutes:number, startPct:number, endPct:number]>
 * ftp: numeric FTP (W)
 *
 * Returns: { totalSec, durationMin, ifValue, tss, kj, ftp }
 */
export function computeMetricsFromSegments(rawSegments, ftp) {
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
  let sumFrac = 0;   // sum of relative power samples
  let sumFrac4 = 0;  // sum of (relative power^4)

  for (const seg of rawSegments) {
    const [minutes, startPct, endPct] = seg;
    const dur = Math.max(1, Math.round(minutes * 60));
    const isFreeRide =
      Array.isArray(seg) && seg[3] === FREERIDE_SEGMENT_FLAG;
    totalSec += dur;

    if (isFreeRide) {
      continue;
    }

    const p0 = startPct / 100;       // relative FTP 0–1
    const dp = (endPct - startPct) / 100;  // delta relative FTP

    for (let i = 0; i < dur; i++) {
      const rel = p0 + dp * ((i + 0.5) / dur); // mid-point power
      sumFrac += rel;
      sumFrac4 += rel ** 4;
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
  const IF = Math.pow(sumFrac4 / powerSec, 0.25);
  const tss = (powerSec * IF * IF) / 36;
  const kj = ftpVal * sumFrac / 1000;

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

export function buildPerSecondPower(samples, durationSec) {
  const totalSec = Math.max(1, Math.ceil(durationSec || 0));
  const arr = new Float32Array(totalSec);
  if (!Array.isArray(samples) || !samples.length) return arr;

  const sorted = [...samples].sort((a, b) => (a.t || 0) - (b.t || 0));
  let idx = 0;
  let current = sorted[0];
  let power = Number(current?.power) || 0;

  for (let s = 0; s < totalSec; s += 1) {
    while (idx + 1 < sorted.length && (sorted[idx + 1].t || 0) <= s) {
      idx += 1;
      current = sorted[idx];
      power = Number(current?.power) || 0;
    }
    arr[s] = power;
  }
  return arr;
}

export function computeMetricsFromSamples(samples, ftp, durationSecHint) {
  const ftpVal = Number(ftp) || DEFAULT_FTP;
  const durationSec =
    durationSecHint ||
    (samples?.length
      ? Math.max(1, Math.round(samples[samples.length - 1].t || 0))
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
  const perMin = [];
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
      windowSum += perSec[i];
      if (i >= window) {
        windowSum -= perSec[i - window];
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
      ? samples.reduce(
          (acc, s) => ({
            sum: acc.sum + (Number.isFinite(s.hr) ? s.hr : 0),
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

export function computeScheduledMetrics(entry, ftpInput) {
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
export function inferZoneFromSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return "Uncategorized";
  }

  const zoneTime = {
    recovery: 0,
    endurance: 0,
    tempo: 0,
    threshold: 0,
    vo2: 0,
    anaerobic: 0,
  };

  let totalSec = 0;
  let workSec = 0;

  for (const seg of rawSegments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const minutes = Number(seg[0]);
    const startPct = Number(seg[1]);
    const endPct =
      seg.length > 2 && seg[2] != null ? Number(seg[2]) : startPct;
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
      continue;
    }

    totalSec += durSec;

    let zoneKey;
    if (avgPct < 60) zoneKey = "recovery";
    else if (avgPct < 76) zoneKey = "endurance";
    else if (avgPct < 90) zoneKey = "tempo";
    else if (avgPct < 105) zoneKey = "threshold";
    else if (avgPct < 119) zoneKey = "vo2";
    else zoneKey = "anaerobic";

    zoneTime[zoneKey] += durSec;

    if (avgPct >= 75) workSec += durSec;
  }

  if (totalSec === 0) return "Uncategorized";

  const z = zoneTime;
  const hiSec = z.vo2 + z.anaerobic;
  const thrSec = z.threshold;
  const tempoSec = z.tempo;

  const workFrac = workSec / totalSec;

  // Light / easy: mostly recovery / endurance
  if (workFrac < 0.15) {
    if (z.recovery / totalSec >= 0.7) return "Recovery";
    return "Endurance";
  }

  const safeDiv = workSec || 1;
  const fracWork = {
    hi: hiSec / safeDiv,
    thr: thrSec / safeDiv,
    tempo: tempoSec / safeDiv,
  };

  if (fracWork.hi >= 0.2) {
    const anaerFrac = z.anaerobic / safeDiv;
    if (anaerFrac >= 0.1) {
      return "HIIT";
    }
    return "VO2Max";
  }

  if (fracWork.thr + fracWork.hi >= 0.35) {
    return "Threshold";
  }

  if (fracWork.tempo + fracWork.thr + fracWork.hi >= 0.5) {
    return "Tempo";
  }

  return "Endurance";
}

// --------------------------- Picker helpers ---------------------------

/**
 * Buckets duration into label used by the duration filter.
 */
export function getDurationBucket(durationMin) {
  if (!Number.isFinite(durationMin)) return ">240";
  if (durationMin <= 30) return "1-30";
  if (durationMin <= 60) return "31-60";
  if (durationMin <= 90) return "61-90";
  if (durationMin <= 120) return "91-120";
  if (durationMin <= 150) return "121-150";
  if (durationMin <= 180) return "151-180";
  if (durationMin <= 210) return "181-210";
  if (durationMin <= 240) return "211-240";
  return ">240";
}

/**
 * Adjust kJ to the current FTP (used in picker list sorting).
 */
export function getAdjustedKjForPicker(baseKj, baseFtp, currentFtp) {
  if (
    baseKj == null ||
    !Number.isFinite(baseFtp) ||
    !Number.isFinite(currentFtp)
  ) {
    return baseKj;
  }
  if (baseFtp <= 0) return workout.baseKj;
  return baseKj * (currentFtp / baseFtp);
}
