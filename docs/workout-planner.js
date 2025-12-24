import { parseFitFile } from "./fit-file.js";
import { drawMiniHistoryChart } from "./workout-chart.js";
import {
  DEFAULT_FTP,
  computeMetricsFromSamples,
  computeScheduledMetrics,
  inferZoneFromSegments,
} from "./workout-metrics.js";
import { loadScheduleEntries } from "./storage.js";
import {
  renderDetailStats,
  renderPowerCurveDetail,
  renderDetailChart,
  moveHistoryFileToTrash,
  computeHrCadStats,
  buildPowerCurve,
  powerMaxFromIntervals,
  formatDuration,
} from "./planner-analysis.js";
import { createPlannerBackend } from "./planner-backend.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WEEKS = 16;
const SCROLL_BUFFER_ROWS = 2;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const POWER_CURVE_DURS = [
  1, 2, 5, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200,
  1800, 2400, 3600, 5400, 7200, 14400, 28800,
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

// Filenames are ISO strings in UTC. Convert to a Date that represents that UTC
// midnight in the local timezone so day math aligns with the user's locale.
function utcDateKeyToLocalDate(key) {
  if (!key) return null;
  const [y, m, d] = key.split("-").map((n) => Number(n));
  if (!y || !m || !d) return null;
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms);
}

function toDateSafe(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
      const utcDate = new Date(ms);
      return Number.isNaN(utcDate.getTime()) ? null : utcDate;
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
  footerEl,
  detailView,
  detailStatsEl,
  powerCurveSvg,
  detailChartSvg,
  detailChartPanel,
  detailChartTooltip,
  backBtn,
  deleteBtn,
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
  const backend = createPlannerBackend({
    formatKey,
    utcDateKeyToLocalDate,
    toDateSafe,
    keyToDate,
    getCurrentFtp,
  });
  const {
    historyIndex,
    historyData,
    scheduledMap,
    dateKeyFromHandleName,
    aggTotals,
    recomputeAggTotals,
  } = backend;
  const hotkeyPromptEl = document.getElementById("plannerHotkeyPrompt");
  const hotkeyListEl = document.getElementById("plannerHotkeyList");
  const agg3El = document.getElementById("plannerAgg3");
  const agg7El = document.getElementById("plannerAgg7");
  const agg30El = document.getElementById("plannerAgg30");
  let detailChartData = null;
  let detailMode = false;
  let detailState = null;
  let showHotkeys = false;
  let questionHeld = false;

  function updateRowHeightVar() {
    const next = Math.max(140, Math.round(window.innerHeight * 0.24));
    rowHeightPx = next;
    if (modal) {
      modal.style.setProperty("--planner-row-height", `${next}px`);
    }
  }

  const {
    resetHistoryIndex,
    ensureHistoryIndex,
    loadHistoryPreview,
    loadScheduleIntoMap,
    ensureScheduleLoaded,
    persistSchedule,
  } = backend;

  async function removeScheduledEntryInternal(entry) {
    if (!entry || !entry.date || !entry.workoutTitle) return;
    const current = await loadScheduleEntries();
    const idx = current.findIndex(
      (e) => e.date === entry.date && e.workoutTitle === entry.workoutTitle,
    );
    if (idx === -1) return;
    const next = current.slice(0, idx).concat(current.slice(idx + 1));
    await persistSchedule(next);
    await loadScheduleIntoMap();
    const cell = calendarBody.querySelector(
      `.planner-day[data-date="${entry.date}"]`,
    );
    if (cell) {
      cell
        .querySelectorAll(".planner-scheduled-card")
        .forEach((n) => n.remove());
      maybeAttachScheduled(cell);
    }
    recomputeAgg(selectedDate);
  }

  async function removeScheduledEntryByRef(entry) {
    const dateKey = entry?.date;
    const title = entry?.workoutTitle;
    if (!dateKey || !title) return;
    await removeScheduledEntryInternal({ date: dateKey, workoutTitle: title });
  }

  async function moveScheduledEntry({ fromDate, toDate, workoutTitle }) {
    if (!fromDate || !toDate || !workoutTitle) return false;
    if (fromDate === toDate) return true;
    if (isPastDate(toDate)) return false;
    const entries = await loadScheduleEntries();
    const idx = entries.findIndex(
      (e) => e.date === fromDate && e.workoutTitle === workoutTitle,
    );
    if (idx === -1) return false;
    const nextEntries = entries
      .slice(0, idx)
      .concat(entries.slice(idx + 1))
      .concat([{ ...entries[idx], date: toDate }]);
    await persistSchedule(nextEntries);
    await loadScheduleIntoMap();
    const fromCell = calendarBody.querySelector(
      `.planner-day[data-date="${fromDate}"]`,
    );
    if (fromCell) {
      fromCell
        .querySelectorAll(".planner-scheduled-card")
        .forEach((n) => n.remove());
      maybeAttachScheduled(fromCell);
    }
    const toCell = calendarBody.querySelector(
      `.planner-day[data-date="${toDate}"]`,
    );
    if (toCell) {
      toCell
        .querySelectorAll(".planner-scheduled-card")
        .forEach((n) => n.remove());
      maybeAttachScheduled(toCell);
    }
    recomputeAgg(selectedDate);
    return true;
  }

  function renderHistoryCard(cell, data) {
    if (!cell || !data) return;
    const content = cell.querySelector(".planner-day-content");
    if (!content) return;
    content.classList.add("has-history");
    const card = document.createElement("div");
    card.className = "planner-workout-card";
    card.title = "View workout analysis";
    if (data.fileName) card.dataset.fileName = data.fileName;

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
    const attachHover = () => {
      const day = card.closest(".planner-day");
      if (!day) return;
      card.addEventListener("mouseenter", () =>
        day.classList.add("suppress-hover"),
      );
      card.addEventListener("mouseleave", () =>
        day.classList.remove("suppress-hover"),
      );
    };
    attachHover();

    requestAnimationFrame(() => {
      const rect = chartWrap.getBoundingClientRect();
      drawMiniHistoryChart({
        svg,
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: data.rawSegments || [],
        actualLineSegments: data.powerSegments || [],
        actualPowerMax:
          data.powerMax || powerMaxFromIntervals(data.powerSegments),
        durationSec: data.durationSec || 0,
      });
      chartWrap._plannerChartData = {
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: data.rawSegments || [],
        actualLineSegments: data.powerSegments || [],
        actualPowerMax:
          data.powerMax || powerMaxFromIntervals(data.powerSegments),
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
    if (entry.fileName) card.dataset.fileName = entry.fileName;
    if (entry.missing) {
      card.classList.add("planner-scheduled-missing");
      card.title = "Workout file not found";
    }

    const topRow = document.createElement("div");
    topRow.className = "planner-scheduled-top";
    const tag = document.createElement("div");
    tag.className = "planner-scheduled-tag";
    tag.textContent = "Scheduled";
    const isPast = isPastDate(entry.date || cell.dataset.date);
    if (isPast) tag.classList.add("planner-scheduled-tag-past");
    topRow.appendChild(tag);
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "nav-icon-button planner-scheduled-edit-btn";
    if (isPast) {
      editBtn.title = "Delete scheduled workout";
      editBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 6H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" /><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>';
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeScheduledEntryInternal(entry);
      });
    } else {
      editBtn.title = "Edit scheduled workout";
      editBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (typeof onScheduledEditRequested === "function") {
          onScheduledEditRequested(cell.dataset.date, entry);
        }
      });
    }
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
    if (entry.missing) parts.push("File missing");
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
    const historyCards = content.querySelectorAll(
      ".planner-workout-card:not(.planner-scheduled-card)",
    );
    if (historyCards.length) {
      historyCards[historyCards.length - 1].after(card);
    } else {
      content.appendChild(card);
    }

    if (!entry.missing) {
      card.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (typeof onScheduledLoadRequested === "function") {
          onScheduledLoadRequested(entry);
        }
      });
    }
    card.draggable = true;
    card.addEventListener("dragstart", (ev) => {
      const dt = ev.dataTransfer;
      if (!dt) return;
      dt.effectAllowed = "move";
      dt.setData(
        "application/json",
        JSON.stringify({
          kind: "scheduled",
          date: cell.dataset.date,
          workoutTitle: entry.workoutTitle,
        }),
      );
      card.classList.add("planner-dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("planner-dragging");
    });
    const attachHover = () => {
      const day = card.closest(".planner-day");
      if (!day) return;
      card.addEventListener("mouseenter", () =>
        day.classList.add("suppress-hover"),
      );
      card.addEventListener("mouseleave", () =>
        day.classList.remove("suppress-hover"),
      );
    };
    attachHover();

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

  async function deleteCurrentDetail() {
    if (!detailState || !detailState.fileName) return;
    const { fileName, workoutTitle, dateKey } = detailState;
    const confirmed = window.confirm(
      `Move workout "${workoutTitle || fileName}" to the trash folder?`,
    );
    if (!confirmed) return;
    const moved = await moveHistoryFileToTrash(fileName);
    if (!moved) return;

    if (dateKey) {
      const idxArr = historyIndex.get(dateKey) || [];
      historyIndex.set(
        dateKey,
        idxArr.filter((e) => e.name !== fileName),
      );
      if (historyIndex.get(dateKey)?.length === 0) {
        historyIndex.delete(dateKey);
      }
      const dataArr = historyData.get(dateKey) || [];
      historyData.set(
        dateKey,
        dataArr.filter((d) => d.fileName !== fileName),
      );
      if (historyData.get(dateKey)?.length === 0) {
        historyData.delete(dateKey);
      }
      const cell = calendarBody.querySelector(
        `.planner-day[data-date="${dateKey}"]`,
      );
      if (cell) {
        cell
          .querySelectorAll(
            `.planner-workout-card[data-file-name="${fileName}"]`,
          )
          .forEach((n) => n.remove());
      }
    }
    exitDetailMode();
    recomputeAgg(selectedDate);
  }

  function exitDetailMode() {
    detailMode = false;
    detailState = null;
    detailChartData = null;
    if (modal) modal.classList.remove("planner-detail-mode");
    if (detailView) detailView.style.display = "none";
    if (titleEl) titleEl.textContent = "Calendar";
    updateSelectedLabel();
    updateScheduleButton();
    if (backBtn) backBtn.style.display = "none";
    if (deleteBtn) {
      deleteBtn.style.display = "none";
      deleteBtn.dataset.fileName = "";
    }
    const pickerBackBtn = document.getElementById("pickerBackToPlannerBtn");
    if (pickerBackBtn) pickerBackBtn.style.display = "none";
  }

  async function deleteFirstItemInCell(dateKey) {
    if (!dateKey) return false;
    const scheduled = scheduledMap.get(dateKey);
    if (scheduled && scheduled.length) {
      const entry = scheduled[0];
      const confirmed = window.confirm(
        `Delete scheduled workout "${entry.workoutTitle}" on ${dateKey}?`,
      );
      if (!confirmed) return false;
      await removeScheduledEntryInternal(entry);
      return true;
    }

    let previews = historyData.get(dateKey);
    if (!previews) {
      previews = await loadHistoryPreview(dateKey);
      if (Array.isArray(previews)) {
        historyData.set(dateKey, previews);
      }
    }
    const first = Array.isArray(previews) ? previews[0] : null;
    if (!first || !first.fileName) return false;
    const confirmed = window.confirm(
      `Move workout "${first.workoutTitle || first.fileName}" to the trash folder?`,
    );
    if (!confirmed) return false;
    const moved = await moveHistoryFileToTrash(first.fileName);
    if (!moved) return false;

    const idxArr = historyIndex.get(dateKey) || [];
    historyIndex.set(
      dateKey,
      idxArr.filter((e) => e.name !== first.fileName),
    );
    if (historyIndex.get(dateKey)?.length === 0) {
      historyIndex.delete(dateKey);
    }
    const dataArr = historyData.get(dateKey) || [];
    historyData.set(
      dateKey,
      dataArr.filter((d) => d.fileName !== first.fileName),
    );
    if (historyData.get(dateKey)?.length === 0) {
      historyData.delete(dateKey);
    }
    const cell = calendarBody.querySelector(
      `.planner-day[data-date="${dateKey}"]`,
    );
    if (cell) {
      cell
        .querySelectorAll(
          `.planner-workout-card[data-file-name="${first.fileName}"]`,
        )
        .forEach((n) => n.remove());
    }
    recomputeAgg(selectedDate);
    return true;
  }

  async function openDetailView(dateKey, preview) {
    if (!dateKey || !preview || !isPastOrTodayDate(dateKey)) return false;
    await ensureHistoryIndex();
    const entries = historyIndex.get(dateKey) || [];
    const entry =
      entries.find((e) => e.name === preview.fileName) || entries[0] || null;
    if (!entry) return false;
    try {
      const file = await entry.handle.getFile();
      const buf = await file.arrayBuffer();
      const parsed = parseFitFile(buf);
      const cw = parsed.canonicalWorkout || {};
      const meta = parsed.meta || {};
      const metaStartedAt = toDateSafe(meta.startedAt);
      const metaEndedAt = toDateSafe(meta.endedAt);
      const ftp = meta.ftp || DEFAULT_FTP;
      const lastSample = parsed.samples?.length
        ? parsed.samples[parsed.samples.length - 1]
        : null;
      const durationSecHint =
        metaStartedAt && metaEndedAt
          ? Math.max(
              1,
              Math.round(
                (metaEndedAt.getTime() - metaStartedAt.getTime()) / 1000,
              ),
            )
          : Math.max(1, Math.round(lastSample?.t || 0));

      const metrics = computeMetricsFromSamples(
        parsed.samples || [],
        ftp,
        durationSecHint,
      );
      const totalTimerSec =
        meta.totalTimerSec || metrics.durationSec || durationSecHint || 0;
      const totalElapsedSec =
        meta.totalElapsedSec ||
        (metaStartedAt && metaEndedAt
          ? Math.max(
              0,
              Math.round(
                (metaEndedAt.getTime() - metaStartedAt.getTime()) / 1000,
              ),
            )
          : totalTimerSec);
      const pausedSec = Math.max(0, totalElapsedSec - totalTimerSec);
      const hrStats = computeHrCadStats(parsed.samples || []);
      const perSec = metrics.perSecondPower || [];
      const curvePoints = buildPowerCurve(perSec, POWER_CURVE_DURS);
      const vi =
        metrics.avgPower && metrics.avgPower > 0 && metrics.normalizedPower
          ? metrics.normalizedPower / metrics.avgPower
          : null;
      const ef =
        metrics.avgHr && metrics.avgHr > 0
          ? (metrics.normalizedPower || 0) / metrics.avgHr
          : null;

      const inferredZone = inferZoneFromSegments(cw.rawSegments || []);
      detailState = {
        dateKey,
        fileName: entry.name,
        workoutTitle: cw.workoutTitle || preview.workoutTitle,
        durationSec: metrics.durationSec || durationSecHint || 0,
        kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
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
        startedAt:
          metaStartedAt ||
          toDateSafe(preview.startedAt) ||
          utcDateKeyToLocalDate(dateKey),
        pausedSec,
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
        titleEl.textContent = "";
      }
      if (selectedLabel) {
        selectedLabel.textContent = detailState.workoutTitle || "";
      }
      if (backBtn) backBtn.style.display = "inline-flex";
      if (deleteBtn) {
        deleteBtn.style.display = "inline-flex";
        deleteBtn.dataset.fileName = detailState.fileName || "";
        deleteBtn.title = "Delete this workout";
      }
      const pickerBackBtn = document.getElementById("pickerBackToPlannerBtn");
      if (pickerBackBtn) pickerBackBtn.style.display = "inline-flex";

      renderDetailStats(
        detailStatsEl,
        detailState,
        formatSelectedLabel,
        formatDuration,
      );
      renderPowerCurveDetail(powerCurveSvg, detailState);
      renderDetailChart(
        detailChartSvg,
        detailChartPanel,
        detailChartTooltip,
        detailState,
      );
      detailChartData = { detail: detailState };
      return true;
    } catch (err) {
      console.warn("[Planner] Failed to open detail view:", err);
      return false;
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
      renderDetailChart(
        detailChartSvg,
        detailChartPanel,
        detailChartTooltip,
        detailChartData.detail,
      );
      renderPowerCurveDetail(powerCurveSvg, detailChartData.detail);
    }
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
    if (typeof onScheduleRequested === "function") {
      onScheduleRequested(dateKey, null);
    }
  }

  async function openSelectedDayDetail() {
    if (!selectedDate) return false;
    const dateKey = formatKey(selectedDate);
    if (!isPastOrTodayDate(dateKey)) return false;
    let previews = historyData.get(dateKey);
    if (!previews) {
      previews = await loadHistoryPreview(dateKey);
      if (Array.isArray(previews)) {
        historyData.set(dateKey, previews);
      }
    }
    if (Array.isArray(previews) && previews.length) {
      return openDetailView(dateKey, previews[0]);
    }
    return false;
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

  function isPastOrTodayDate(dateKey) {
    const d = keyToDate(dateKey);
    d.setHours(0, 0, 0, 0);
    return d <= TODAY;
  }

  function recomputeAgg(baseDate) {
    recomputeAggTotals(baseDate);
    updateAggUi();
  }

  function formatAggDuration(sec) {
    const m = Math.round(Math.max(0, sec || 0) / 60);
    return `${m} min`;
  }

  function updateAggUi() {
    if (hotkeyPromptEl) {
      hotkeyPromptEl.style.display = showHotkeys ? "none" : "";
    }
    if (hotkeyListEl) {
      hotkeyListEl.style.display = showHotkeys ? "" : "none";
    }
    const footerRight = document.querySelector(".planner-footer-right");
    if (footerRight) {
      footerRight.style.display = showHotkeys ? "none" : "";
    }
    if (showHotkeys) return;
    if (agg3El) {
      agg3El.innerHTML = `<strong>3 day sum:</strong> ${formatAggDuration(
        aggTotals["3"].sec,
      )}, ${Math.round(aggTotals["3"].kj)} kJ, TSS ${Math.round(aggTotals["3"].tss)}`;
    }
    if (agg7El) {
      agg7El.innerHTML = `<strong>7 day sum:</strong> ${formatAggDuration(
        aggTotals["7"].sec,
      )}, ${Math.round(aggTotals["7"].kj)} kJ, TSS ${Math.round(aggTotals["7"].tss)}`;
    }
    if (agg30El) {
      agg30El.innerHTML = `<strong>30 day sum:</strong> ${formatAggDuration(
        aggTotals["30"].sec,
      )}, ${Math.round(aggTotals["30"].kj)} kJ, TSS ${Math.round(aggTotals["30"].tss)}`;
    }
  }

  async function maybeAttachHistory(cell) {
    if (!cell || cell.dataset.historyAttached === "true") return;
    const dateKey = cell.dataset.date;
    if (!dateKey || !isPastOrTodayDate(dateKey)) return;
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
      renderScheduledCard(cell, entry);
    }
    recomputeAgg(selectedDate);
  }

  function onDayDragOver(ev) {
    const cell = ev.currentTarget;
    const dateKey = cell?.dataset?.date;
    if (!dateKey || isPastDate(dateKey)) return;
    const dt = ev.dataTransfer;
    if (!dt) return;
    if (!dt.types || !Array.from(dt.types).includes("application/json")) return;
    ev.preventDefault();
    dt.dropEffect = "move";
    cell.classList.add("planner-drop-hover");
  }

  function onDayDragLeave(ev) {
    const cell = ev.currentTarget;
    cell?.classList.remove("planner-drop-hover");
  }

  async function onDayDrop(ev) {
    const cell = ev.currentTarget;
    const dateKey = cell?.dataset?.date;
    cell?.classList.remove("planner-drop-hover");
    const dt = ev.dataTransfer;
    if (!dt || !dateKey || isPastDate(dateKey)) return;
    ev.preventDefault();
    let payload = null;
    try {
      const raw = dt.getData("application/json");
      payload = raw ? JSON.parse(raw) : null;
    } catch (_err) {
      payload = null;
    }
    if (!payload || payload.kind !== "scheduled") return;
    if (!payload.workoutTitle || !payload.date) return;
    await moveScheduledEntry({
      fromDate: payload.date,
      toDate: dateKey,
      workoutTitle: payload.workoutTitle,
    });
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

      cell.addEventListener("dragover", onDayDragOver);
      cell.addEventListener("dragleave", onDayDragLeave);
      cell.addEventListener("drop", onDayDrop);

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

  const isQuestionShowHotkey = (ev) => {
    const key = ev.key || "";
    return key === "?" || (key === "/" && ev.shiftKey) || (ev.code === "Slash" && ev.shiftKey);
  };

  const isQuestionReleaseKey = (ev) => {
    const key = ev.key || "";
    return key === "?" || key === "/" || ev.code === "Slash";
  };

  async function onKeyDown(ev) {
    if (!isOpen) return;

    if (detailMode) {
      const key = (ev.key || "").toLowerCase();
      const tag = ev.target && ev.target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        ev.target?.isContentEditable
      ) {
        return;
      }
      if (key === "delete") {
        ev.preventDefault();
        deleteCurrentDetail();
        return;
      }
      if (key === "d") {
        ev.preventDefault();
        deleteCurrentDetail();
        return;
      }
      if (key === "backspace" || key === "escape") {
        ev.preventDefault();
        exitDetailMode();
      }
      return;
    }
    const key = (ev.key || "").toLowerCase();
    if (key === "escape") {
      // Exit detail mode handled above; otherwise ignore to avoid closing planner
      return;
    }

    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (key === "enter") {
      ev.preventDefault();
      const dateKey = selectedDate ? formatKey(selectedDate) : null;
      if (!dateKey) return;
      const opened = await openSelectedDayDetail();
      if (opened) return;
      const scheduled = scheduledMap.get(dateKey);
      if (
        scheduled &&
        scheduled.length &&
        typeof onScheduledLoadRequested === "function"
      ) {
        onScheduledLoadRequested(scheduled[0]);
        return;
      }
      if (!isPastDate(dateKey)) {
        requestSchedule(dateKey);
        return;
      }
      openSelectedDayDetail();
      return;
    }

    if (key === "e") {
      ev.preventDefault();
      const dateKey = selectedDate ? formatKey(selectedDate) : null;
      if (!dateKey) return;
      const scheduled = scheduledMap.get(dateKey);
      if (
        scheduled &&
        scheduled.length &&
        typeof onScheduledEditRequested === "function"
      ) {
        onScheduledEditRequested(dateKey, scheduled[0]);
        return;
      }
      if (!isPastDate(dateKey)) {
        requestSchedule(dateKey);
      }
      return;
    }

    if (key === "d" || key === "delete") {
      ev.preventDefault();
      const dateKey = selectedDate ? formatKey(selectedDate) : null;
      if (!dateKey) return;
      deleteFirstItemInCell(dateKey);
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
    recomputeAggTotals(selectedDate);

    window.requestAnimationFrame(() => {
      centerOnDate(selectedDate);
      ensureScheduleLoaded()
        .then(() => recomputeAgg(selectedDate))
        .catch(() => {});
    });
    const pickerBackBtn = document.getElementById("pickerBackToPlannerBtn");
    if (pickerBackBtn) pickerBackBtn.style.display = "none";
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
  window.addEventListener("keydown", (ev) => {
    if (isQuestionShowHotkey(ev)) {
      if (!isOpen) return;
      ev.preventDefault();
      if (questionHeld) return;
      questionHeld = true;
      showHotkeys = true;
      updateAggUi();
      return;
    }
    onKeyDown(ev);
  });
  window.addEventListener("keyup", (ev) => {
    if (isQuestionReleaseKey(ev)) {
      if (!questionHeld) return;
      questionHeld = false;
      if (!showHotkeys) return;
      showHotkeys = false;
      updateAggUi();
      return;
    }
  });
  window.addEventListener("resize", updateRowHeightVar);

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      exitDetailMode();
    });
  }

  let overlayPointerDown = false;
  overlay.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    overlayPointerDown = ev.target === overlay;
  });
  overlay.addEventListener("pointerup", (ev) => {
    if (
      overlayPointerDown &&
      ev.target === overlay &&
      overlay.classList.contains("planner-mode") &&
      modal &&
      modal.style.display !== "none"
    ) {
      close();
    }
    overlayPointerDown = false;
  });

  if (scheduleBtn) {
    scheduleBtn.addEventListener("click", () => {
      if (!selectedDate) return;
      const dateKey = formatKey(selectedDate);
      if (!dateKey || isPastDate(dateKey)) return;
      requestSchedule(dateKey);
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteCurrentDetail();
    });
  }

  return {
    open,
    close,
    isOpen: () => isOpen,
    isDetailOpen: () => detailMode,
    exitDetail: () => exitDetailMode(),
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
        previews.find((p) => p.fileName === fileName) || previews[0];
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
    applyScheduledEntry: async ({ dateKey, canonical, existingEntry }) => {
      if (!dateKey || !canonical) return;
      const current = await loadScheduleEntries();
      const ftpForSchedule =
        typeof getCurrentFtp === "function"
          ? Number(getCurrentFtp()) || DEFAULT_FTP
          : DEFAULT_FTP;
      const nextEntry = {
        date: dateKey,
        workoutTitle: canonical.workoutTitle,
      };
      const nextEntries = existingEntry
        ? current.map((e) =>
            e === existingEntry ||
            (e.date === existingEntry?.date &&
              e.workoutTitle === existingEntry?.workoutTitle)
              ? nextEntry
              : e,
          )
        : current.concat(nextEntry);
      await persistSchedule(nextEntries);
      await loadScheduleIntoMap();
      const cell = calendarBody.querySelector(
        `.planner-day[data-date="${dateKey}"]`,
      );
      if (cell) {
        cell
          .querySelectorAll(".planner-scheduled-card")
          .forEach((n) => n.remove());
        const nextArr = scheduledMap.get(dateKey) || [];
        nextArr.forEach((e) => {
          if (!e.metrics) {
            e.metrics = computeScheduledMetrics(e, ftpForSchedule);
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
    removeScheduledEntry: removeScheduledEntryInternal,
    removeScheduledEntryByRef,
    removeScheduledByTitle: async (dateKey, title) => {
      await removeScheduledEntryByRef({
        date: dateKey,
        workoutTitle: title,
      });
    },
  };
}
