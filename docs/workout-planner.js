import { parseFitFile } from "./fit-file.js";
import { drawMiniHistoryChart, drawPowerCurveChart, drawWorkoutChart } from "./workout-chart.js";
import { DEFAULT_FTP, computeMetricsFromSegments, inferZoneFromSegments } from "./workout-metrics.js";
import {
  loadWorkoutDirHandle,
  loadWorkoutStatsCache,
  saveWorkoutStatsCache,
  loadScheduleEntries,
  saveScheduleEntries,
  loadZwoDirHandle,
} from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WEEKS = 16;
const SCROLL_BUFFER_ROWS = 2;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const POWER_CURVE_DURS = [
  1, 2, 5, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800,
  2400, 3600, 5400, 7200, 14400, 28800,
];

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // sunday = 0
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split("-").map((n) => Number(n));
  return new Date(y, (m || 1) - 1, d || 1);
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatSelectedLabel(date) {
  if (!date) return "";
  try {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch (err) {
    console.warn("[Planner] Failed to format date", err);
    return date.toDateString();
  }
}

export function createWorkoutPlanner({
  overlay,
  modal,
  closeBtn,
  calendarBody,
  selectedLabel,
  scheduleBtn,
  agg7dEl,
  agg30dEl,
  footerEl,
  detailView,
  detailStatsEl,
  powerCurveSvg,
  detailChartSvg,
  detailChartPanel,
  detailChartTooltip,
  backBtn,
  titleEl,
  onScheduleRequested,
  onScheduledEditRequested,
  onScheduledLoadRequested,
  getCurrentFtp,
} = {}) {
  if (!overlay || !calendarBody) {
    return {
      open: () => {},
      close: () => {},
      isOpen: () => false,
    };
  }

  let isOpen = false;
  let selectedDate = null;
  let anchorStart = startOfWeek(new Date());
  let weekRows = [];
  let firstIndex = 0;
  let lastIndex = 0;
  let rowHeightPx = Math.max(140, Math.round(window.innerHeight * 0.24));
  let scrollTicking = false;
  const today = new Date();
  const historyIndex = new Map(); // dateKey -> {handle, name}
  const historyCache = new Map(); // dateKey -> Promise<{...}>
  const historyData = new Map(); // dateKey -> Array<preview>
  const scheduledMap = new Map(); // dateKey -> Array<entry>
  const scheduledCache = new Map(); // fileName -> {rawSegments, workoutTitle}
  let historyIndexPromise = null;
  let schedulePromise = null;
  let statsCache = null;
  const STATS_CACHE_VERSION = 30; // bump whenever cache format/logic changes
  const aggTotals = {
    "3": {sec: 0, kj: 0, tss: 0},
    "7": {sec: 0, kj: 0, tss: 0},
    "30": {sec: 0, kj: 0, tss: 0},
  };
  let detailChartData = null;
  let detailMode = false;
  let detailState = null;

  function updateRowHeightVar() {
    const next = Math.max(140, Math.round(window.innerHeight * 0.24));
    rowHeightPx = next;
    if (modal) {
      modal.style.setProperty("--planner-row-height", `${next}px`);
    }
  }

  function dateKeyFromHandleName(name) {
    const parts = name.split(" ");
    if (!parts.length) return null;
    const isoPart = parts[0];
    const datePart = isoPart.split("T")[0];
    if (!datePart || datePart.length < 10) return null;
    return datePart;
  }

  function resetHistoryIndex() {
    historyIndex.clear();
    historyCache.clear();
    historyData.clear();
    historyIndexPromise = null;
    scheduledMap.clear();
    schedulePromise = null;
    scheduledCache.clear();
  }

  async function ensureStatsCache() {
    if (statsCache) return statsCache;
    try {
      const raw = await loadWorkoutStatsCache();
      if (raw && raw.version === STATS_CACHE_VERSION && raw.entries) {
        statsCache = raw;
      } else {
        statsCache = {version: STATS_CACHE_VERSION, entries: {}};
      }
    } catch (_err) {
      statsCache = {version: STATS_CACHE_VERSION, entries: {}};
    }
    return statsCache;
  }

  async function ensureHistoryIndex() {
    if (historyIndexPromise) return historyIndexPromise;
    historyIndexPromise = (async () => {
      const dir = await loadWorkoutDirHandle();
      if (!dir) return;
      try {
        for await (const [name, handle] of dir.entries()) {
          if (!name || !name.toLowerCase().endsWith(".fit")) continue;
          const dateKey = dateKeyFromHandleName(name);
          if (!dateKey) continue;
          const arr = historyIndex.get(dateKey) || [];
          arr.push({ name, handle });
          historyIndex.set(dateKey, arr);
        }
        historyIndex.forEach((arr, key) => {
          historyIndex.set(
            key,
            arr.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)),
          );
        });
      } catch (err) {
        console.warn("[Planner] Failed to list history dir:", err);
      }
    })();
    return historyIndexPromise;
  }

  async function ensureScheduleLoaded() {
    if (schedulePromise) return schedulePromise;
    schedulePromise = (async () => {
      const entries = await loadScheduleEntries();
      scheduledMap.clear();
      entries.forEach((e) => {
        if (!e || !e.date) return;
        const key = e.date;
        const arr = scheduledMap.get(key) || [];
        e.metrics = computeScheduledMetrics(e);
        if (e.metrics) {
          e.durationSec = e.metrics.durationSec;
          e.kj = e.metrics.kj;
          e.ifValue = e.metrics.ifValue;
          e.tss = e.metrics.tss;
          e.zone = e.metrics.zone;
        }
        if (e.metrics) {
          e.zone = e.zone || e.metrics.zone;
        }
        arr.push(e);
        scheduledMap.set(key, arr);
      });
    })();
    return schedulePromise;
  }

  async function persistSchedule() {
    const entries = [];
    scheduledMap.forEach((arr) => {
      arr.forEach((e) => entries.push(e));
    });
    await saveScheduleEntries(entries);
  }

  function buildPerSecondPower(samples, durationSec) {
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

  function computeMetricsFromSamples(samples, ftp, durationSecHint) {
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
            {sum: 0, count: 0},
          )
        : {sum: 0, count: 0};
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

  function computeHrCadStats(samples) {
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

  function buildPowerCurve(perSec, durations) {
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

  async function ensureScheduledWorkout(entry) {
    if (!entry) return entry;
    if (entry.rawSegments && entry.rawSegments.length) return entry;
    if (!entry.fileName) return entry;
    const cached = scheduledCache.get(entry.fileName);
    if (cached) {
      entry.rawSegments = cached.rawSegments || [];
      entry.workoutTitle = entry.workoutTitle || cached.workoutTitle;
      return entry;
    }
    try {
      const dir = await loadZwoDirHandle();
      if (!dir) return entry;
      const handle = await dir.getFileHandle(entry.fileName, {create: false});
      const file = await handle.getFile();
      const text = await file.text();
      const {parseZwoXmlToCanonicalWorkout} = await import("./zwo.js");
      const canonical = parseZwoXmlToCanonicalWorkout(text) || {};
      const rawSegments = canonical.rawSegments || [];
      scheduledCache.set(entry.fileName, {
        rawSegments,
        workoutTitle: canonical.workoutTitle || entry.workoutTitle,
      });
      entry.rawSegments = rawSegments;
      entry.workoutTitle = entry.workoutTitle || canonical.workoutTitle;
    } catch (_err) {
      // ignore
    }
    return entry;
  }

  function computeScheduledMetrics(entry) {
    if (!entry || !entry.rawSegments?.length) return null;
    const ftp =
      typeof getCurrentFtp === "function"
        ? Number(getCurrentFtp()) || DEFAULT_FTP
        : DEFAULT_FTP;
    const metrics = computeMetricsFromSegments(entry.rawSegments, ftp);
    const zone = inferZoneFromSegments(entry.rawSegments);
    return {
      durationSec: metrics.totalSec || 0,
      kj: metrics.kj,
      ifValue: metrics.ifValue,
      tss: metrics.tss,
      zone,
    };
  }

  function buildPowerSegments(samples, durationSecHint) {
    if (!Array.isArray(samples) || !samples.length) {
      return {intervals: [], maxPower: 0, totalSec: 0};
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
        i === bucketCount - 1
          ? Math.max(1, totalSec - durStart)
          : bucketSize;
      intervals.push([power, power, dur]);
    });

    if (!intervals.length) return {intervals: [], maxPower: 0, totalSec};

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

    return {intervals, maxPower, totalSec};
  }

  function powerMaxFromIntervals(intervals) {
    if (!Array.isArray(intervals) || !intervals.length) return 0;
    return intervals.reduce(
      (m, [p0, p1]) => Math.max(m, Math.abs(p0 || 0), Math.abs(p1 || 0)),
      0,
    );
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.round(s / 60);
    return `${m} min`;
  }

  function renderHistoryCard(cell, data) {
    if (!cell || !data) return;
    const content = cell.querySelector(".planner-day-content");
    if (!content) return;
    content.classList.add("has-history");
    const card = document.createElement("div");
    card.className = "planner-workout-card";
    card.title = "View workout analysis";

    const header = document.createElement("div");
    header.className = "planner-workout-header";
    const name = document.createElement("div");
    name.className = "planner-workout-name";
    name.textContent = data.workoutTitle || "Workout";
    header.appendChild(name);

    const stats = document.createElement("div");
    stats.className = "planner-workout-stats";
    const parts = [];
    if (data.durationSec) parts.push(formatDuration(data.durationSec));
    if (data.zone) parts.push(data.zone);
    if (Number.isFinite(data.kj)) parts.push(`${Math.round(data.kj)} kJ`);
    if (Number.isFinite(data.tss)) parts.push(`TSS ${Math.round(data.tss)}`);
    if (Number.isFinite(data.ifValue))
      parts.push(`IF ${data.ifValue.toFixed(2)}`);
    parts.forEach((p, idx) => {
      const chip = document.createElement("span");
      chip.className = "planner-workout-stat-chip";
      chip.textContent = p;
      stats.appendChild(chip);
      if (idx !== parts.length - 1) {
        const sep = document.createElement("span");
        sep.className = "planner-workout-stat-chip planner-workout-stat-sep";
        sep.textContent = "·";
        stats.appendChild(sep);
      }
    });
    header.appendChild(stats);

    const chartWrap = document.createElement("div");
    chartWrap.className = "planner-workout-chart";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chartWrap.appendChild(svg);

    card.appendChild(header);
    card.appendChild(chartWrap);
    const firstScheduled = content.querySelector(".planner-scheduled-card");
    if (firstScheduled) {
      content.insertBefore(card, firstScheduled);
    } else {
      content.appendChild(card);
    }

    const dateKey = cell.dataset.date;
    card.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openDetailView(dateKey, data);
    });

    requestAnimationFrame(() => {
      const rect = chartWrap.getBoundingClientRect();
      drawMiniHistoryChart({
        svg,
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: data.rawSegments || [],
        actualLineSegments: data.powerSegments || [],
        actualPowerMax: data.powerMax || powerMaxFromIntervals(data.powerSegments),
        durationSec: data.durationSec || 0,
      });
      chartWrap._plannerChartData = {
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: data.rawSegments || [],
        actualLineSegments: data.powerSegments || [],
        actualPowerMax: data.powerMax || powerMaxFromIntervals(data.powerSegments),
        durationSec: data.durationSec || 0,
      };
    });
  }

  function renderScheduledCard(cell, entry) {
    if (!cell || !entry) return;
    const content = cell.querySelector(".planner-day-content");
    if (!content) return;
    content.classList.add("has-history");
    const card = document.createElement("div");
    card.className = "planner-workout-card planner-scheduled-card";
    card.title = "Start scheduled workout";

    const topRow = document.createElement("div");
    topRow.className = "planner-scheduled-top";
    const tag = document.createElement("div");
    tag.className = "planner-scheduled-tag";
    tag.textContent = "Scheduled";
    topRow.appendChild(tag);
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "nav-icon-button planner-scheduled-edit-btn";
    editBtn.title = "Edit scheduled workout";
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    editBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (typeof onScheduledEditRequested === "function") {
        onScheduledEditRequested(cell.dataset.date, entry);
      }
    });
    topRow.appendChild(editBtn);
    card.appendChild(topRow);

    const header = document.createElement("div");
    header.className = "planner-workout-header";
    const name = document.createElement("div");
    name.className = "planner-workout-name";
    name.textContent = entry.workoutTitle || "Workout";
    header.appendChild(name);

    const stats = document.createElement("div");
    stats.className = "planner-workout-stats";
    const parts = [];
    if (entry.durationSec) parts.push(formatDuration(entry.durationSec));
    if (entry.zone) parts.push(entry.zone);
    if (Number.isFinite(entry.kj)) parts.push(`${Math.round(entry.kj)} kJ`);
    if (Number.isFinite(entry.tss)) parts.push(`TSS ${Math.round(entry.tss)}`);
    if (Number.isFinite(entry.ifValue))
      parts.push(`IF ${entry.ifValue.toFixed(2)}`);
    parts.forEach((p, idx) => {
      const chip = document.createElement("span");
      chip.className = "planner-workout-stat-chip";
      chip.textContent = p;
      stats.appendChild(chip);
      if (idx !== parts.length - 1) {
        const sep = document.createElement("span");
        sep.className = "planner-workout-stat-chip planner-workout-stat-sep";
        sep.textContent = "·";
        stats.appendChild(sep);
      }
    });
    header.appendChild(stats);

    const chartWrap = document.createElement("div");
    chartWrap.className = "planner-workout-chart";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chartWrap.appendChild(svg);

    card.appendChild(header);
    card.appendChild(chartWrap);
    const historyCards = content.querySelectorAll(".planner-workout-card:not(.planner-scheduled-card)");
    if (historyCards.length) {
      historyCards[historyCards.length - 1].after(card);
    } else {
      content.appendChild(card);
    }

    const dateKey = cell.dataset.date;
    card.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (typeof onScheduledLoadRequested === "function") {
        onScheduledLoadRequested(entry);
      }
    });

    requestAnimationFrame(() => {
      const rect = chartWrap.getBoundingClientRect();
      drawMiniHistoryChart({
        svg,
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: entry.rawSegments || [],
        durationSec: entry.durationSec || 0,
      });
      chartWrap._plannerChartData = {
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: entry.rawSegments || [],
        durationSec: entry.durationSec || 0,
      };
    });
  }

  function renderDetailStats(detail) {
    if (!detailStatsEl) return;
    detailStatsEl.innerHTML = "";
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
      chip.appendChild(lbl);
      chip.appendChild(val);
      row.appendChild(chip);
    };

    pushStat("Duration", formatDuration(detail.durationSec));
    if (detail.zone) pushStat("Zone", detail.zone);
    if (Number.isFinite(detail.avgPower))
      pushStat("Avg Power", `${Math.round(detail.avgPower)} W`);
    if (Number.isFinite(detail.normalizedPower))
      pushStat("NP", `${Math.round(detail.normalizedPower)} W`);
    if (Number.isFinite(detail.kj)) pushStat("Work", `${Math.round(detail.kj)} kJ`);
    if (Number.isFinite(detail.ifValue))
      pushStat("IF", detail.ifValue.toFixed(2));
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
    if (detail.startedAt) {
      try {
        pushStat(
          "Started",
          detail.startedAt.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}),
        );
      } catch (_err) {
        pushStat("Started", detail.startedAt.toTimeString().slice(0, 5));
      }
    }

    if (row.children.length) {
      detailStatsEl.appendChild(row);
    }
  }

  function renderPowerCurve(detail) {
    if (!powerCurveSvg) return;
    const rect = powerCurveSvg.getBoundingClientRect();
    drawPowerCurveChart({
      svg: powerCurveSvg,
      width: rect.width || 600,
      height: rect.height || 300,
      ftp: detail.ftp || DEFAULT_FTP,
      points: detail.powerCurve || [],
      maxDurationSec: detail.durationSec || 0,
    });
  }

  function renderDetailChart(detail) {
    if (!detailChartSvg || !detailChartPanel || !detailChartTooltip) return;
    const rect = detailChartPanel.getBoundingClientRect();
    drawWorkoutChart({
      svg: detailChartSvg,
      panel: detailChartPanel,
      tooltipEl: detailChartTooltip,
      width: rect.width || 1000,
      height: rect.height || 320,
      mode: "workout",
      ftp: detail.ftp || DEFAULT_FTP,
      rawSegments: detail.rawSegments || [],
      elapsedSec: detail.durationSec || 0,
      liveSamples: detail.samples || [],
      manualErgTarget: 0,
    });
    detailChartData = {
      width: rect.width || 1000,
      height: rect.height || 320,
      detail,
    };
  }

  function exitDetailMode() {
    detailMode = false;
    detailState = null;
    detailChartData = null;
    if (modal) modal.classList.remove("planner-detail-mode");
    if (detailView) detailView.style.display = "none";
    if (titleEl) titleEl.textContent = "Workout planner";
    updateSelectedLabel();
    updateScheduleButton();
    if (backBtn) backBtn.style.display = "none";
  }

  async function openDetailView(dateKey, preview) {
    if (!dateKey || !preview || !isPastDate(dateKey)) return;
    await ensureHistoryIndex();
    const entries = historyIndex.get(dateKey) || [];
    const entry =
      entries.find((e) => e.name === preview.fileName) || entries[0] || null;
    if (!entry) return;
    try {
      const file = await entry.handle.getFile();
      const buf = await file.arrayBuffer();
      const parsed = parseFitFile(buf);
      const cw = parsed.canonicalWorkout || {};
      const meta = parsed.meta || {};
      const ftp = meta.ftp || DEFAULT_FTP;
      const lastSample = parsed.samples?.length
        ? parsed.samples[parsed.samples.length - 1]
        : null;
      const durationSecHint =
        meta.startedAt && meta.endedAt
          ? Math.max(
              1,
              Math.round(
                (meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000,
              ),
            )
          : Math.max(1, Math.round(lastSample?.t || 0));

      const metrics = computeMetricsFromSamples(
        parsed.samples || [],
        ftp,
        durationSecHint,
      );
      const hrStats = computeHrCadStats(parsed.samples || []);
      const perSec = metrics.perSecondPower || [];
      const curvePoints = buildPowerCurve(perSec, POWER_CURVE_DURS);
      const vi =
        metrics.avgPower && metrics.avgPower > 0 && metrics.normalizedPower
          ? metrics.normalizedPower / metrics.avgPower
          : null;
      const ef =
        metrics.avgHr && metrics.avgHr > 0 ? (metrics.normalizedPower || 0) / metrics.avgHr : null;

      const inferredZone = inferZoneFromSegments(cw.rawSegments || []);
      detailState = {
        dateKey,
        fileName: entry.name,
        workoutTitle: cw.workoutTitle || preview.workoutTitle,
        durationSec: metrics.durationSec || durationSecHint || 0,
        kj:
          meta.totalWorkJ != null
            ? meta.totalWorkJ / 1000
            : metrics.kj,
        ifValue: metrics.ifValue,
        tss: metrics.tss,
        avgPower: metrics.avgPower,
        normalizedPower: metrics.normalizedPower,
        vi,
        ef,
        ftp,
        rawSegments: cw.rawSegments || [],
        samples: parsed.samples || [],
        powerCurve: curvePoints,
        startedAt: meta.startedAt || preview.startedAt || keyToDate(dateKey),
        avgHr: hrStats.avgHr,
        maxHr: hrStats.maxHr,
        avgCadence: hrStats.avgCadence,
        maxCadence: hrStats.maxCadence,
        zone: preview.zone || inferredZone,
      };

      detailMode = true;
      if (modal) modal.classList.add("planner-detail-mode");
      if (detailView) detailView.style.display = "flex";
      if (titleEl) {
        const d = detailState.startedAt || keyToDate(dateKey);
        titleEl.textContent = formatSelectedLabel(d);
      }
      if (selectedLabel) {
        selectedLabel.textContent = detailState.workoutTitle || "";
      }
      if (backBtn) backBtn.style.display = "inline-flex";

      renderDetailStats(detailState);
      renderPowerCurve(detailState);
      renderDetailChart(detailState);
    } catch (err) {
      console.warn("[Planner] Failed to open detail view:", err);
    }
  }
  function rerenderCharts() {
    if (!overlay) return;
    const wraps = overlay.querySelectorAll(".planner-workout-chart");
    wraps.forEach((wrap) => {
      const svg = wrap.querySelector("svg");
      const payload = wrap._plannerChartData;
      if (!svg || !payload) return;
      const rect = wrap.getBoundingClientRect();
      drawMiniHistoryChart({
        svg,
        width: rect.width || payload.width || 240,
        height: rect.height || payload.height || 120,
        rawSegments: payload.rawSegments || [],
        actualLineSegments: payload.actualLineSegments || [],
        actualPowerMax:
          payload.actualPowerMax ||
          powerMaxFromIntervals(payload.actualLineSegments),
        durationSec: payload.durationSec || 0,
      });
    });
    if (detailMode && detailChartData && detailChartData.detail) {
      const rect = detailChartPanel?.getBoundingClientRect() || {};
      drawWorkoutChart({
        svg: detailChartSvg,
        panel: detailChartPanel,
        tooltipEl: detailChartTooltip,
        width: rect.width || detailChartData.width || 1000,
        height: rect.height || detailChartData.height || 320,
        mode: "workout",
        ftp: detailChartData.detail.ftp || DEFAULT_FTP,
        rawSegments: detailChartData.detail.rawSegments || [],
        elapsedSec: detailChartData.detail.durationSec || 0,
        liveSamples: detailChartData.detail.samples || [],
        manualErgTarget: 0,
      });
      renderPowerCurve(detailChartData.detail);
    }
  }

  async function loadHistoryPreview(dateKey) {
    const existing = historyCache.get(dateKey);
    if (existing) return existing;

    const promise = (async () => {
      await ensureStatsCache();
      await ensureHistoryIndex();
      const entries = historyIndex.get(dateKey) || [];
      if (!entries.length) return [];
      let cacheDirty = false;
      const results = [];
      for (const entry of entries) {
        try {
          let entryDirty = false;
          const cached = statsCache.entries[entry.name];
          const file = await entry.handle.getFile();
          const buf = await file.arrayBuffer();
          const parsed = parseFitFile(buf);
          const cw = parsed.canonicalWorkout || {};
          const meta = parsed.meta || {};
          const ftp = meta.ftp || DEFAULT_FTP;
          const lastSample = parsed.samples?.length
            ? parsed.samples[parsed.samples.length - 1]
            : null;
          const durationSecHint =
            meta.startedAt && meta.endedAt
              ? Math.max(
                  1,
                  Math.round(
                    (meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000,
                  ),
                )
              : Math.max(1, Math.round(lastSample?.t || 0));

          let metrics = null;
          if (
            cached &&
            cached.durationSec &&
            cached.kj != null &&
            cached.tss != null &&
            cached.ifValue != null
          ) {
            metrics = {
              durationSec: cached.durationSec,
              kj: cached.kj,
              tss: cached.tss,
              ifValue: cached.ifValue,
            };
          } else {
            metrics = computeMetricsFromSamples(
              parsed.samples || [],
              ftp,
              durationSecHint,
            );
            entryDirty = true;
          }

          const title = cw.workoutTitle || entry.name.replace(/\.fit$/i, "");
          const startedAt = meta.startedAt
            ? meta.startedAt
            : cached?.startedAt
            ? new Date(cached.startedAt)
            : null;

          let zone = cached?.zone;
          if (!zone) {
            zone = inferZoneFromSegments(cw.rawSegments || []);
            if (zone) entryDirty = true;
          }

          let powerSegments = cached?.powerSegments;
          if (!Array.isArray(powerSegments)) {
            const built = buildPowerSegments(parsed.samples || [], durationSecHint);
            powerSegments = built.intervals;
            entryDirty = true;
          }
          if (!Array.isArray(powerSegments)) powerSegments = [];

          if (!cached || entryDirty) {
            statsCache.entries[entry.name] = {
              workoutTitle: title,
              durationSec: metrics.durationSec || durationSecHint || 0,
              kj:
                meta.totalWorkJ != null
                  ? meta.totalWorkJ / 1000
                  : metrics.kj,
              ifValue: metrics.ifValue,
              tss: metrics.tss,
              startedAt: startedAt ? startedAt.toISOString() : null,
              powerSegments,
              zone,
            };
            cacheDirty = true;
          }

          const powerMax = powerMaxFromIntervals(powerSegments);
          results.push({
            workoutTitle: title,
            durationSec: metrics.durationSec || durationSecHint || 0,
            kj:
              meta.totalWorkJ != null
                ? meta.totalWorkJ / 1000
                : metrics.kj,
            ifValue: metrics.ifValue,
            tss: metrics.tss,
            startedAt,
            rawSegments: cw.rawSegments || [],
            powerSegments,
            powerMax,
            fileName: entry.name,
            zone,
          });
        } catch (err) {
          console.warn(
            "[Planner] Failed to load history for",
            dateKey,
            entry?.name,
            err,
          );
        }
      }
      if (cacheDirty) {
        saveWorkoutStatsCache(statsCache).catch(() => {});
      }
      return results;
    })();

    historyCache.set(dateKey, promise);
    return promise;
  }

  function measureRowHeight() {
    if (weekRows.length) {
      const rect = weekRows[0].getBoundingClientRect();
      if (rect.height) {
        rowHeightPx = rect.height;
        return rowHeightPx;
      }
    }
    updateRowHeightVar();
    return rowHeightPx;
  }

  function updateSelectedLabel() {
    if (!selectedLabel) return;
    const text = formatSelectedLabel(selectedDate);
    selectedLabel.textContent = text;
    selectedLabel.title = text;
  }

  function applySelectionStyles() {
    const key = selectedDate ? formatKey(selectedDate) : "";
    weekRows.forEach((row) => {
      const cells = row.querySelectorAll(".planner-day");
      cells.forEach((cell) => {
        const isSelected = key && cell.dataset.date === key;
        cell.classList.toggle("is-selected", isSelected);
      });
    });
  }

  function ensureSelectionRendered() {
    if (!selectedDate) return null;
    const key = formatKey(selectedDate);
    let cell = calendarBody.querySelector(`.planner-day[data-date="${key}"]`);
    if (!cell) {
      anchorStart = startOfWeek(selectedDate);
      renderInitialRows();
      applySelectionStyles();
      cell = calendarBody.querySelector(`.planner-day[data-date="${key}"]`);
      if (cell) {
        centerOnDate(selectedDate);
      }
    }
    return cell;
  }

  function scrollCellIntoView(cell) {
    if (!cell) return;
    const containerRect = calendarBody.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const padding = 8;
    if (cellRect.top < containerRect.top + padding) {
      calendarBody.scrollTop -= containerRect.top - cellRect.top + padding;
    } else if (cellRect.bottom > containerRect.bottom - padding) {
      calendarBody.scrollTop +=
        cellRect.bottom - containerRect.bottom + padding;
    }
  }

  function setSelectedDate(nextDate) {
    selectedDate = nextDate;
    updateSelectedLabel();
    applySelectionStyles();
    updateScheduleButton();
    recomputeAgg(selectedDate);
    const cell = ensureSelectionRendered();
    scrollCellIntoView(cell);
  }

  function moveSelection(daysDelta) {
    const base = selectedDate || new Date();
    const next = addDays(base, daysDelta);
    setSelectedDate(next);
  }

  function requestSchedule(dateKey) {
    scheduledCache.clear();
    if (typeof onScheduleRequested === "function") {
      onScheduleRequested(dateKey, null);
    }
  }

  async function openSelectedDayDetail() {
    if (!selectedDate) return;
    const dateKey = formatKey(selectedDate);
    if (!isPastDate(dateKey)) return;
    let previews = historyData.get(dateKey);
    if (!previews) {
      previews = await loadHistoryPreview(dateKey);
      if (Array.isArray(previews)) {
        historyData.set(dateKey, previews);
      }
    }
    if (Array.isArray(previews) && previews.length) {
      openDetailView(dateKey, previews[0]);
    }
  }

  function updateScheduleButton() {
    if (!scheduleBtn) return;
    if (detailMode) {
      scheduleBtn.style.display = "none";
      return;
    }
    if (!selectedDate) {
      scheduleBtn.style.display = "none";
      return;
    }
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    const isPast = selectedDate < todayMid;
    scheduleBtn.style.display = isPast ? "none" : "";
  }

  function isPastDate(dateKey) {
    const d = keyToDate(dateKey);
    d.setHours(0, 0, 0, 0);
    return d < TODAY;
  }

  function resetAgg() {
    aggTotals["3"] = {sec: 0, kj: 0, tss: 0};
    aggTotals["7"] = {sec: 0, kj: 0, tss: 0};
    aggTotals["30"] = {sec: 0, kj: 0, tss: 0};
    updateAggUi();
  }
  function recomputeAgg(baseDate) {
    resetAgg();
    const base = baseDate ? new Date(baseDate) : new Date();
    base.setHours(0, 0, 0, 0);
    const baseMs = base.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff7 = baseMs - 7 * dayMs;
    const cutoff3 = baseMs - 3 * dayMs;
    const cutoff30 = baseMs - 30 * dayMs;

    historyData.forEach((items) => {
      items.forEach((item) => {
        const start = item.startedAt ? item.startedAt.getTime() : null;
        if (start == null) return;
        if (start <= baseMs && start >= cutoff3) {
          aggTotals["3"].sec += item.durationSec || 0;
          aggTotals["3"].kj += item.kj || 0;
          aggTotals["3"].tss += item.tss || 0;
        }
        if (start <= baseMs && start >= cutoff7) {
          aggTotals["7"].sec += item.durationSec || 0;
          aggTotals["7"].kj += item.kj || 0;
          aggTotals["7"].tss += item.tss || 0;
        }
        if (start <= baseMs && start >= cutoff30) {
          aggTotals["30"].sec += item.durationSec || 0;
          aggTotals["30"].kj += item.kj || 0;
          aggTotals["30"].tss += item.tss || 0;
        }
      });
    });
    scheduledMap.forEach((entries, key) => {
      const date = keyToDate(key);
      date.setHours(0, 0, 0, 0);
      const start = date.getTime();
      entries.forEach((entry) => {
        const metrics = entry.metrics;
        if (!metrics) return;
        if (start <= baseMs && start >= cutoff3) {
          aggTotals["3"].sec += metrics.durationSec || 0;
          aggTotals["3"].kj += metrics.kj || 0;
          aggTotals["3"].tss += metrics.tss || 0;
        }
        if (start <= baseMs && start >= cutoff7) {
          aggTotals["7"].sec += metrics.durationSec || 0;
          aggTotals["7"].kj += metrics.kj || 0;
          aggTotals["7"].tss += metrics.tss || 0;
        }
        if (start <= baseMs && start >= cutoff30) {
          aggTotals["30"].sec += metrics.durationSec || 0;
          aggTotals["30"].kj += metrics.kj || 0;
          aggTotals["30"].tss += metrics.tss || 0;
        }
      });
    });
    updateAggUi();
  }

  function formatAggDuration(sec) {
    const m = Math.round(Math.max(0, sec || 0) / 60);
    return `${m} min`;
  }

  function updateAggUi() {
    if (footerEl) {
      const parts = [];
      parts.push(
        `<strong>3 day sum:</strong> ${formatAggDuration(aggTotals["3"].sec)}, ${Math.round(
          aggTotals["3"].kj,
        )} kJ, TSS ${Math.round(aggTotals["3"].tss)}`,
      );
      parts.push(
        `<strong>7 day sum:</strong> ${formatAggDuration(aggTotals["7"].sec)}, ${Math.round(
          aggTotals["7"].kj,
        )} kJ, TSS ${Math.round(aggTotals["7"].tss)}`,
      );
      parts.push(
        `<strong>30 day sum:</strong> ${formatAggDuration(aggTotals["30"].sec)}, ${Math.round(
          aggTotals["30"].kj,
        )} kJ, TSS ${Math.round(aggTotals["30"].tss)}`,
      );
      footerEl.innerHTML = parts.join(' <span style="padding:0 8px;">·</span> ');
    }
  }

  async function maybeAttachHistory(cell) {
    if (!cell || cell.dataset.historyAttached === "true") return;
    const dateKey = cell.dataset.date;
    if (!dateKey || !isPastDate(dateKey)) return;
    await ensureHistoryIndex();
    cell.dataset.historyAttached = "true";
    const previews = await loadHistoryPreview(dateKey);
    if (Array.isArray(previews) && previews.length) {
      previews.forEach((data) => renderHistoryCard(cell, data));
      historyData.set(dateKey, previews);
      recomputeAgg(selectedDate);
    }
  }

  async function maybeAttachScheduled(cell) {
    if (!cell) return;
    const dateKey = cell.dataset.date;
    await ensureScheduleLoaded();
    const entries = scheduledMap.get(dateKey);
    if (!entries || !entries.length) return;
    cell.querySelectorAll(".planner-scheduled-card").forEach((n) => n.remove());
    for (const entry of entries) {
      await ensureScheduledWorkout(entry);
      entry.metrics = entry.metrics || computeScheduledMetrics(entry);
      if (entry.metrics) {
        entry.durationSec = entry.metrics.durationSec;
        entry.kj = entry.metrics.kj;
        entry.ifValue = entry.metrics.ifValue;
        entry.tss = entry.metrics.tss;
      }
      renderScheduledCard(cell, entry);
    }
    recomputeAgg(selectedDate);
  }

  function buildWeekRow(weekOffset) {
    const row = document.createElement("div");
    row.className = "planner-week-row";
    row.dataset.weekOffset = String(weekOffset);
    const start = addDays(anchorStart, weekOffset * 7);

    for (let i = 0; i < 7; i += 1) {
      const dayDate = addDays(start, i);
      const key = formatKey(dayDate);
      const cell = document.createElement("div");
      cell.className = "planner-day";
      cell.dataset.date = key;
      cell.dataset.month = String(dayDate.getMonth());
      cell.dataset.year = String(dayDate.getFullYear());
      cell.dataset.dow = String(dayDate.getDay());

      const content = document.createElement("div");
      content.className = "planner-day-content";

      const isFirstOfMonth = dayDate.getDate() === 1;
      const isToday = isSameDay(dayDate, today);
      if (isFirstOfMonth || isToday) {
        const monthLabel = document.createElement("div");
        monthLabel.className = "planner-month-label";
        if (isToday) {
          monthLabel.textContent = "Today";
        } else {
          try {
            monthLabel.textContent = dayDate.toLocaleString(undefined, {
              month: "long",
            });
          } catch (_err) {
            monthLabel.textContent = String(dayDate.getMonth() + 1);
          }
        }
        content.appendChild(monthLabel);
        cell.classList.add("has-month-label");
      }

      const num = document.createElement("div");
      num.className = "planner-day-number";
      num.textContent = String(dayDate.getDate());
      content.appendChild(num);

      cell.appendChild(content);
      if (isSameDay(dayDate, today)) {
        cell.classList.add("is-today");
      }
      if (selectedDate && isSameDay(dayDate, selectedDate)) {
        cell.classList.add("is-selected");
      }

      row.appendChild(cell);
    }

    return row;
  }

  function updateMonthBoundaries() {
    if (!weekRows.length) return;
    const monthMeta = new Map();

    const ensureMonthMeta = (year, month) => {
      const k = `${year}-${month}`;
      if (monthMeta.has(k)) return monthMeta.get(k);
      const firstDow = new Date(year, month, 1).getDay();
      const lastDow = new Date(year, month + 1, 0).getDay();
      const meta = { firstDow, lastDow };
      monthMeta.set(k, meta);
      return meta;
    };

    weekRows.forEach((row, rowIdx) => {
      const cells = Array.from(row.querySelectorAll(".planner-day"));
      cells.forEach((cell, colIdx) => {
        cell.classList.remove(
          "month-top-boundary",
          "month-left-boundary",
          "month-bottom-boundary",
        );
        const month = Number(cell.dataset.month);
        const year = Number(cell.dataset.year);
        const dow = Number(cell.dataset.dow);
        const meta = ensureMonthMeta(year, month);

        if (colIdx > 0) {
          const prevCell = cells[colIdx - 1];
          if (prevCell && prevCell.dataset.month !== String(month)) {
            cell.classList.add("month-left-boundary");
          }
        }

        if (rowIdx > 0) {
          const prevRow = weekRows[rowIdx - 1];
          const prevCells = prevRow.querySelectorAll(".planner-day");
          const prevCell = prevCells[colIdx];
          if (
            prevCell &&
            Number(prevCell.dataset.month) !== month &&
            dow >= meta.firstDow
          ) {
            cell.classList.add("month-top-boundary");
          }
        }

        if (rowIdx < weekRows.length - 1) {
          const nextRow = weekRows[rowIdx + 1];
          const nextCells = nextRow.querySelectorAll(".planner-day");
          const nextCell = nextCells[colIdx];
          if (
            nextCell &&
            Number(nextCell.dataset.month) !== month &&
            meta.lastDow !== 6 &&
            dow <= meta.lastDow
          ) {
            cell.classList.add("month-bottom-boundary");
          }
        }
      });
    });
  }

  function renderInitialRows() {
    calendarBody.innerHTML = "";
    weekRows = [];
    const totalRows = VISIBLE_WEEKS;
    const rowsBefore = Math.floor(totalRows / 2);
    firstIndex = -rowsBefore;
    lastIndex = firstIndex + totalRows - 1;

    const frag = document.createDocumentFragment();
    for (let idx = firstIndex; idx <= lastIndex; idx += 1) {
      const row = buildWeekRow(idx);
      weekRows.push(row);
      frag.appendChild(row);
      row.querySelectorAll(".planner-day").forEach((cell) => {
        maybeAttachHistory(cell);
        maybeAttachScheduled(cell);
      });
    }
    calendarBody.appendChild(frag);
    updateMonthBoundaries();
    measureRowHeight();
  }

  function weekOffsetForDate(date) {
    const start = startOfWeek(date);
    const diffMs = start.getTime() - anchorStart.getTime();
    return Math.round(diffMs / (7 * DAY_MS));
  }

  function centerOnDate(date) {
    if (!date || !weekRows.length) return;
    const offset = weekOffsetForDate(date);
    const rowHeight = measureRowHeight();
    const relativeRow = offset - firstIndex;

    if (relativeRow < 0 || relativeRow >= weekRows.length) {
      // rebuild around target if it fell outside our window
      anchorStart = startOfWeek(date);
      renderInitialRows();
      const resetOffset = weekOffsetForDate(date);
      const row = resetOffset - firstIndex;
      const targetRow = Math.max(0, row - 1);
      calendarBody.scrollTop = Math.max(0, targetRow * rowHeight);
      return;
    }

    const targetRow = Math.max(0, relativeRow - 1);
    calendarBody.scrollTop = Math.max(0, targetRow * rowHeight);
  }

  function recycleRows(direction) {
    if (!weekRows.length) return;
    const prevScroll = calendarBody.scrollTop;

    if (direction > 0) {
      const removedHeight =
        weekRows[0]?.getBoundingClientRect().height || measureRowHeight();
      const nextOffset = lastIndex + 1;
      const newRow = buildWeekRow(nextOffset);
      calendarBody.appendChild(newRow);
      weekRows.push(newRow);
      newRow.querySelectorAll(".planner-day").forEach((cell) => {
        maybeAttachHistory(cell);
        maybeAttachScheduled(cell);
      });

      const removed = weekRows.shift();
      if (removed) removed.remove();

      firstIndex += 1;
      lastIndex += 1;
      calendarBody.scrollTop = Math.max(0, prevScroll - removedHeight);
    } else {
      const prevOffset = firstIndex - 1;
      const newRow = buildWeekRow(prevOffset);
      const firstRow = weekRows[0] || null;
      calendarBody.insertBefore(newRow, firstRow);
      const insertedHeight =
        newRow.getBoundingClientRect().height || measureRowHeight();
      weekRows.unshift(newRow);
      newRow.querySelectorAll(".planner-day").forEach((cell) => {
        maybeAttachHistory(cell);
        maybeAttachScheduled(cell);
      });

      const removed = weekRows.pop();
      if (removed) removed.remove();

      firstIndex -= 1;
      lastIndex -= 1;
      calendarBody.scrollTop = prevScroll + insertedHeight;
    }

    updateMonthBoundaries();
    applySelectionStyles();
  }

  function maybeRecycleRows() {
    const rowHeight = measureRowHeight();
    const bufferPx = rowHeight * SCROLL_BUFFER_ROWS;
    const { scrollTop, clientHeight, scrollHeight } = calendarBody;

    if (scrollTop + clientHeight > scrollHeight - bufferPx) {
      recycleRows(1);
    } else if (scrollTop < bufferPx) {
      recycleRows(-1);
    }
  }

  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      scrollTicking = false;
      maybeRecycleRows();
    });
  }

  function onCellClick(ev) {
    const cell = ev.target.closest(".planner-day");
    if (!cell || !cell.dataset.date) return;
    setSelectedDate(keyToDate(cell.dataset.date));
  }

  function onKeyDown(ev) {
    if (!isOpen) return;

    if (detailMode) {
      const key = (ev.key || "").toLowerCase();
      if (key === "backspace") {
        ev.preventDefault();
        exitDetailMode();
      }
      return;
    }
    const key = (ev.key || "").toLowerCase();
    if (key === "escape") {
      close();
      return;
    }

    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (key === "enter") {
      ev.preventDefault();
      const dateKey = selectedDate ? formatKey(selectedDate) : null;
      if (!dateKey) return;
      if (!isPastDate(dateKey)) {
        const scheduled = scheduledMap.get(dateKey);
        if (scheduled && scheduled.length && typeof onScheduledEditRequested === "function") {
          onScheduledEditRequested(dateKey, scheduled[0]);
        } else {
          requestSchedule(dateKey);
        }
        return;
      }
      openSelectedDayDetail();
      return;
    }

    if (key === "arrowdown" || key === "j") {
      ev.preventDefault();
      moveSelection(7);
      return;
    }
    if (key === "arrowup" || key === "k") {
      ev.preventDefault();
      moveSelection(-7);
      return;
    }
    if (key === "arrowleft" || key === "h") {
      ev.preventDefault();
      moveSelection(-1);
      return;
    }
    if (key === "arrowright" || key === "l") {
      ev.preventDefault();
      moveSelection(1);
      return;
    }
  }

  function open() {
    if (!overlay) return;
    exitDetailMode();
    resetHistoryIndex();
    selectedDate = new Date();
    anchorStart = startOfWeek(selectedDate);

    overlay.style.display = "flex";
    overlay.removeAttribute("aria-hidden");
    overlay.classList.add("planner-mode");
    overlay.classList.remove("picker-mode");
    if (modal) modal.style.display = "flex";
    isOpen = true;

    ensureHistoryIndex().catch((err) => {
      console.warn("[Planner] history index load failed:", err);
    });
    ensureScheduleLoaded().catch(() => {});

    updateRowHeightVar();
    renderInitialRows();
    updateSelectedLabel();
    updateScheduleButton();
    resetAgg();

    window.requestAnimationFrame(() => {
      centerOnDate(selectedDate);
      recomputeAgg(selectedDate);
    });
  }

  function close() {
    if (!overlay) return;
    exitDetailMode();
    overlay.classList.remove("planner-mode");
    if (!overlay.classList.contains("picker-mode")) {
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
    }
    isOpen = false;
  }

  calendarBody.addEventListener("scroll", onScroll);
  calendarBody.addEventListener("click", onCellClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", updateRowHeightVar);

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      exitDetailMode();
    });
  }

  overlay.addEventListener("click", (ev) => {
    if (
      ev.target === overlay &&
      overlay.classList.contains("planner-mode") &&
      modal &&
      modal.style.display !== "none"
    ) {
      close();
    }
  });

  if (scheduleBtn) {
    scheduleBtn.addEventListener("click", () => {
      if (!selectedDate) return;
      const dateKey = formatKey(selectedDate);
      if (!dateKey || isPastDate(dateKey)) return;
      requestSchedule(dateKey);
    });
  }

  return {
    open,
    close,
    isOpen: () => isOpen,
    getSelectedDate: () => selectedDate,
    rerenderCharts,
    openDetailByFile: async (fileName, startedAt) => {
      if (!fileName) return;
      const d =
        startedAt instanceof Date
          ? startedAt
          : startedAt
          ? new Date(startedAt)
          : null;
      const dateKey = d ? formatKey(d) : dateKeyFromHandleName(fileName);
      if (!dateKey) return;
      await ensureHistoryIndex();
      const previews = await loadHistoryPreview(dateKey);
      if (!Array.isArray(previews) || !previews.length) return;
      const match =
        previews.find((p) => p.fileName === fileName) ||
        previews[0];
      openDetailView(dateKey, match);
    },
    hideModal: () => {
      if (overlay) overlay.classList.remove("planner-mode");
      isOpen = false;
    },
    showModal: () => {
      if (overlay) {
        overlay.classList.add("planner-mode");
        overlay.classList.remove("picker-mode");
        overlay.style.display = "flex";
        overlay.removeAttribute("aria-hidden");
      }
      if (modal) modal.style.display = "flex";
      isOpen = true;
    },
    applyScheduledEntry: async ({dateKey, canonical, existingEntry}) => {
      if (!dateKey || !canonical) return;
      await ensureScheduleLoaded();
      scheduledCache.clear();
      const arr = scheduledMap.get(dateKey) || [];
      const target =
        existingEntry && arr.includes(existingEntry) ? existingEntry : {date: dateKey};
      target.date = dateKey;
      target.fileName =
        canonical.source || canonical.fileName || canonical.workoutTitle || "";
      target.workoutTitle = canonical.workoutTitle;
      target.rawSegments = canonical.rawSegments || [];
      target.metrics = computeScheduledMetrics(target);
      target.durationSec = target.metrics?.durationSec;
      target.kj = target.metrics?.kj;
      target.ifValue = target.metrics?.ifValue;
      target.tss = target.metrics?.tss;
      target.zone = target.metrics?.zone;
      if (!arr.includes(target)) {
        arr.push(target);
      }
      scheduledMap.set(dateKey, arr);
      await persistSchedule();
      const cell = calendarBody.querySelector(`.planner-day[data-date="${dateKey}"]`);
      if (cell) {
        cell.querySelectorAll(".planner-scheduled-card").forEach((n) => n.remove());
        arr.forEach((e) => {
          if (!e.metrics) {
            e.metrics = computeScheduledMetrics(e);
          }
          if (e.metrics) {
            e.durationSec = e.metrics.durationSec;
            e.kj = e.metrics.kj;
            e.ifValue = e.metrics.ifValue;
            e.tss = e.metrics.tss;
          }
          renderScheduledCard(cell, e);
        });
      }
      recomputeAgg(selectedDate);
    },
    removeScheduledEntry: async (entry) => {
      if (!entry || !entry.date) return;
      await ensureScheduleLoaded();
      const arr = scheduledMap.get(entry.date) || [];
      const next = arr.filter((e) => e !== entry);
      if (next.length) scheduledMap.set(entry.date, next);
      else scheduledMap.delete(entry.date);
      await persistSchedule();
      const cell = calendarBody.querySelector(`.planner-day[data-date="${entry.date}"]`);
      if (cell) {
        cell.querySelectorAll(".planner-scheduled-card").forEach((n) => n.remove());
        maybeAttachScheduled(cell);
      }
      recomputeAgg(selectedDate);
    },
    removeScheduledByTitle: async (dateKey, title) => {
      if (!dateKey || !title) return;
      await ensureScheduleLoaded();
      const arr = scheduledMap.get(dateKey) || [];
      const idx = arr.findIndex(
        (e) => (e.workoutTitle || "").toLowerCase() === title.toLowerCase(),
      );
      if (idx === -1) return;
      arr.splice(idx, 1);
      if (arr.length) scheduledMap.set(dateKey, arr);
      else scheduledMap.delete(dateKey);
      await persistSchedule();
      const cell = calendarBody.querySelector(`.planner-day[data-date="${dateKey}"]`);
      if (cell) {
        cell.querySelectorAll(".planner-scheduled-card").forEach((n) => n.remove());
        arr.forEach((e) => renderScheduledCard(cell, e));
      }
      recomputeAgg(selectedDate);
    },
  };
}
