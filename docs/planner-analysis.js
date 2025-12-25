import {drawPowerCurveChart, drawWorkoutChart} from "./workout-chart.js";
import {loadWorkoutDirHandle, loadTrashDirHandle, ensureDirPermission} from "./storage.js";
import {formatDurationMinSec} from "./workout-metrics.js";

export function computeHrCadStats(samples) {
  if (!Array.isArray(samples) || !samples.length) return {};
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let cadMax = 0;
  samples.forEach((s) => {
    if (Number.isFinite(s.hr)) {
      hrSum += s.hr;
      hrCount += 1;
      hrMax = Math.max(hrMax, s.hr);
    }
    if (Number.isFinite(s.cadence)) {
      cadSum += s.cadence;
      cadCount += 1;
      cadMax = Math.max(cadMax, s.cadence);
    }
  });
  return {
    avgHr: hrCount ? hrSum / hrCount : null,
    maxHr: hrCount ? hrMax : null,
    avgCadence: cadCount ? cadSum / cadCount : null,
    maxCadence: cadCount ? cadMax : null,
  };
}

export function formatDuration(sec) {
  return formatDurationMinSec(sec);
}

export function buildPowerSegments(samples, durationSecHint) {
  if (!Array.isArray(samples) || !samples.length) {
    return { intervals: [], maxPower: 0, totalSec: 0 };
  }
  const sorted = [...samples].sort((a, b) => (a.t || 0) - (b.t || 0));
  const lastSample = sorted[sorted.length - 1];
  const totalSec = Math.max(
    1,
    durationSecHint || Math.round(lastSample?.t || 0) || 0,
  );
  const bucketSize = 5;
  const bucketCount = Math.ceil(totalSec / bucketSize);
  const buckets = new Array(bucketCount).fill(null).map(() => []);

  sorted.forEach((s) => {
    const t = Math.max(0, Math.round(s.t || 0));
    const idx = Math.min(bucketCount - 1, Math.floor(t / bucketSize));
    buckets[idx].push(Number(s.power) || 0);
  });

  const median = (arr) => {
    if (!arr.length) return 0;
    const sortedVals = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedVals.length / 2);
    return sortedVals.length % 2 === 0
      ? (sortedVals[mid - 1] + sortedVals[mid]) / 2
      : sortedVals[mid];
  };

  let intervals = [];
  buckets.forEach((vals, i) => {
    const power = median(vals);
    const durStart = i * bucketSize;
    const dur =
      i === bucketCount - 1 ? Math.max(1, totalSec - durStart) : bucketSize;
    intervals.push([power, power, dur]);
  });

  if (!intervals.length) return { intervals: [], maxPower: 0, totalSec };

  const slopeAngle = (p0, p1, dur) => Math.atan(dur ? (p1 - p0) / dur : 0);

  let merged = true;
  while (merged && intervals.length > 1) {
    merged = false;
    const next = [];
    for (let i = 0; i < intervals.length; i += 1) {
      const cur = intervals[i];
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
        // merge
        next.push([cur[0], nxt[1], cur[2] + nxt[2]]);
        merged = true;
        i += 1; // skip next interval this pass
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

export function powerMaxFromIntervals(intervals) {
  if (!Array.isArray(intervals) || !intervals.length) return 0;
  return intervals.reduce(
    (m, [p0, p1]) => Math.max(m, Math.abs(p0 || 0), Math.abs(p1 || 0)),
    0,
  );
}

const STAT_TOOLTIPS = {
  NP: {
    name: "Normalized Power",
    desc: "Estimates steady power that would feel like this ride's variability.",
  },
  IF: {
    name: "Intensity Factor",
    desc: "Normalized power divided by FTP to show how hard the ride was.",
  },
  TSS: {
    name: "Training Stress Score",
    desc: "Combines intensity and duration to gauge training load.",
  },
  VI: {
    name: "Variability Index",
    desc: "Normalized power over average power; indicates pacing smoothness.",
  },
  EF: {
    name: "Efficiency Factor",
    desc: "Normalized power over average HR to track aerobic efficiency.",
  },
};

function getStatTooltip(label) {
  const meta = STAT_TOOLTIPS[label];
  if (!meta) return null;
  return `${meta.name} — ${meta.desc}`;
}

export function renderDetailStats(detailStatsEl, detail, formatSelectedLabel, formatDuration) {
  if (!detailStatsEl) return;
  detailStatsEl.innerHTML = "";
  if (detail.startedAt) {
    const header = document.createElement("div");
    header.className = "planner-detail-date";
    try {
      const datePart = formatSelectedLabel(detail.startedAt);
      const timePart = detail.startedAt.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
      header.textContent = `${datePart} • ${timePart}`;
    } catch (_err) {
      header.textContent = detail.startedAt.toString();
    }
    detailStatsEl.appendChild(header);
  }
  const row = document.createElement("div");
  row.className = "wb-stats-row";
  const pushStat = (label, value) => {
    if (value == null || value === "") return;
    const chip = document.createElement("div");
    chip.className = "wb-stat-chip";
    const lbl = document.createElement("div");
    lbl.className = "wb-stat-label";
    lbl.textContent = label;
    const val = document.createElement("div");
    val.className = "wb-stat-value";
    val.textContent = value;
    const tooltip = getStatTooltip(label);
    if (tooltip) chip.title = tooltip;

    chip.appendChild(lbl);
    chip.appendChild(val);
    row.appendChild(chip);
  };

  pushStat("Duration", formatDuration(detail.durationSec));
  if (Number.isFinite(detail.pausedSec) && detail.pausedSec > 0) {
    pushStat("Paused", formatDuration(detail.pausedSec));
  }
  if (detail.zone) pushStat("Zone", detail.zone);
  if (Number.isFinite(detail.avgPower))
    pushStat("Avg Power", `${Math.round(detail.avgPower)} W`);
  if (Number.isFinite(detail.normalizedPower))
    pushStat("NP", `${Math.round(detail.normalizedPower)} W`);
  if (Number.isFinite(detail.kj)) pushStat("Work", `${Math.round(detail.kj)} kJ`);
  if (Number.isFinite(detail.ifValue)) pushStat("IF", detail.ifValue.toFixed(2));
  if (Number.isFinite(detail.tss)) pushStat("TSS", Math.round(detail.tss));
  if (Number.isFinite(detail.vi)) pushStat("VI", detail.vi.toFixed(2));
  if (Number.isFinite(detail.ef)) pushStat("EF", detail.ef.toFixed(2));
  if (Number.isFinite(detail.avgHr))
    pushStat("Avg HR", `${Math.round(detail.avgHr)} bpm`);
  if (Number.isFinite(detail.maxHr))
    pushStat("Max HR", `${Math.round(detail.maxHr)} bpm`);
  if (Number.isFinite(detail.avgCadence))
    pushStat("Avg Cadence", `${Math.round(detail.avgCadence)} rpm`);
  if (Number.isFinite(detail.maxCadence))
    pushStat("Max Cadence", `${Math.round(detail.maxCadence)} rpm`);

  if (row.children.length) {
    detailStatsEl.appendChild(row);
  }
}

export function renderPowerCurveDetail(powerCurveSvg, detail) {
  if (!powerCurveSvg) return;
  const rect = powerCurveSvg.getBoundingClientRect();
  drawPowerCurveChart({
    svg: powerCurveSvg,
    width: rect.width || 600,
    height: rect.height || 300,
    ftp: detail.ftp || 0,
    points: detail.powerCurve || [],
    maxDurationSec: detail.durationSec || 0,
  });
}

export function renderDetailChart(detailChartSvg, detailChartPanel, detailChartTooltip, detail) {
  if (!detailChartSvg || !detailChartPanel) return;
  const rect = detailChartPanel.getBoundingClientRect();
  drawWorkoutChart({
    svg: detailChartSvg,
    panel: detailChartPanel,
    tooltipEl: detailChartTooltip,
    width: rect.width || 1000,
    height: rect.height || 320,
    mode: "workout",
    ftp: detail.ftp || 0,
    rawSegments: detail.rawSegments || [],
    elapsedSec: detail.durationSec || 0,
    liveSamples: detail.samples || [],
    manualErgTarget: 0,
    showProgress: false,
  });
}

export function buildPowerCurve(perSec, durations) {
  if (!perSec || !perSec.length) return [];
  const prefix = new Float64Array(perSec.length + 1);
  for (let i = 0; i < perSec.length; i += 1) {
    prefix[i + 1] = prefix[i] + perSec[i];
  }
  const maxDur = perSec.length;
  const dynDurations = [];
  for (let d = 1; d <= Math.min(maxDur, 60); d += 1) dynDurations.push(d);
  for (let d = 62; d <= Math.min(maxDur, 180); d += 2) dynDurations.push(d);
  for (let d = 182; d <= Math.min(maxDur, 360); d += 5) dynDurations.push(d);
  for (let d = 365; d <= Math.min(maxDur, 1800); d += 10) dynDurations.push(d);
  for (let d = 1810; d <= Math.min(maxDur, 7200); d += 30) dynDurations.push(d);
  for (let d = 7230; d <= Math.min(maxDur, 28800); d += 60) dynDurations.push(d);
  const allDurations = Array.from(new Set([...durations, ...dynDurations]))
    .filter((d) => d >= 1 && d <= maxDur)
    .sort((a, b) => a - b);

  const result = [];
  allDurations.forEach((durRaw) => {
    const dur = Math.max(1, Math.round(durRaw));
    let best = 0;
    let windowSum = prefix[dur] - prefix[0];
    best = windowSum / dur;
    for (let i = dur; i < perSec.length; i += 1) {
      windowSum += perSec[i] - perSec[i - dur];
      const avg = windowSum / dur;
      if (avg > best) best = avg;
    }
    result.push({ durSec: dur, power: best });
  });
  return result;
}

export async function moveHistoryFileToTrash(fileName) {
  const srcDirHandle = await loadWorkoutDirHandle();
  const trashDirHandle = await loadTrashDirHandle();

  if (!srcDirHandle) {
    alert(
      "No history folder configured.\n\nOpen Settings and choose a VeloDrive folder first.",
    );
    return false;
  }
  if (!trashDirHandle) {
    alert(
      "No trash folder is configured.\n\nOpen Settings and pick a VeloDrive folder so the trash folder can be created.",
    );
    return false;
  }

  const [hasSrcPerm, hasTrashPerm] = await Promise.all([
    ensureDirPermission(srcDirHandle),
    ensureDirPermission(trashDirHandle),
  ]);
  if (!hasSrcPerm) {
    alert(
      "VeloDrive does not have permission to modify your history folder.\n\nPlease re-authorize the folder in Settings.",
    );
    return false;
  }
  if (!hasTrashPerm) {
    alert(
      "VeloDrive does not have permission to write to your trash folder.\n\nPlease re-authorize the VeloDrive folder in Settings.",
    );
    return false;
  }

  try {
    const srcFileHandle = await srcDirHandle.getFileHandle(fileName, {
      create: false,
    });
    const srcFile = await srcFileHandle.getFile();
    const dotIdx = fileName.lastIndexOf(".");
    const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let destFileName = `${base} (${stamp})${ext}`;
    if (destFileName.length > 160) {
      destFileName = `${base.slice(0, 120)} (${stamp})${ext}`;
    }
    const destFileHandle = await trashDirHandle.getFileHandle(destFileName, {
      create: true,
    });
    const writable = await destFileHandle.createWritable();
    await writable.write(srcFile);
    await writable.close();
    await srcDirHandle.removeEntry(fileName);
    return true;
  } catch (err) {
    console.error("[Planner] Failed to move history file to trash:", err);
    alert("Moving this workout to the trash folder failed. See logs for details.");
    return false;
  }
}
