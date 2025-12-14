import { parseFitFile } from "./fit-file.js";
import { drawMiniHistoryChart } from "./workout-chart.js";
import { DEFAULT_FTP } from "./workout-metrics.js";
import { loadWorkoutDirHandle } from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WEEKS = 16;
const SCROLL_BUFFER_ROWS = 2;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

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
  let historyIndexPromise = null;

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
    historyIndexPromise = null;
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

    return {
      durationSec,
      kj: sumJ / 1000,
      ifValue: IF,
      tss,
      ftp: ftpVal,
      minutePower: perMin,
    };
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss.padStart(2, "0")}`;
  }

  function renderHistoryCard(cell, data) {
    if (!cell || !data) return;
    const content = cell.querySelector(".planner-day-content");
    if (!content) return;
    content.classList.add("has-history");
    const card = document.createElement("div");
    card.className = "planner-workout-card";

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
    content.appendChild(card);

    requestAnimationFrame(() => {
      const rect = chartWrap.getBoundingClientRect();
      drawMiniHistoryChart({
        svg,
        width: rect.width || 240,
        height: rect.height || 120,
        rawSegments: data.rawSegments || [],
        actualPower: data.minutePower || [],
      });
    });
  }

  async function loadHistoryPreview(dateKey) {
    const existing = historyCache.get(dateKey);
    if (existing) return existing;

    const promise = (async () => {
      await ensureHistoryIndex();
      const entries = historyIndex.get(dateKey) || [];
      if (!entries.length) return [];
      const results = [];
      for (const entry of entries) {
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

          results.push({
            workoutTitle: cw.workoutTitle || entry.name.replace(/\.fit$/i, ""),
            rawSegments: cw.rawSegments || [],
            minutePower: metrics.minutePower || [],
            durationSec: metrics.durationSec || durationSecHint || 0,
            kj: meta.totalWorkJ ? meta.totalWorkJ / 1000 : metrics.kj,
            ifValue: metrics.ifValue,
            tss: metrics.tss,
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
    const cell = ensureSelectionRendered();
    scrollCellIntoView(cell);
  }

  function moveSelection(daysDelta) {
    const base = selectedDate || new Date();
    const next = addDays(base, daysDelta);
    setSelectedDate(next);
  }

  function updateScheduleButton() {
    if (!scheduleBtn) return;
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

  async function maybeAttachHistory(cell) {
    if (!cell || cell.dataset.historyAttached === "true") return;
    const dateKey = cell.dataset.date;
    if (!dateKey || !isPastDate(dateKey)) return;
    await ensureHistoryIndex();
    cell.dataset.historyAttached = "true";
    const previews = await loadHistoryPreview(dateKey);
    if (Array.isArray(previews) && previews.length) {
      previews.forEach((data) => renderHistoryCard(cell, data));
    }
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
    const key = (ev.key || "").toLowerCase();
    if (key === "escape") {
      close();
      return;
    }

    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

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
    resetHistoryIndex();
    selectedDate = selectedDate || new Date();
    anchorStart = startOfWeek(selectedDate);

    overlay.style.display = "flex";
    overlay.removeAttribute("aria-hidden");
    isOpen = true;

    ensureHistoryIndex().catch((err) => {
      console.warn("[Planner] history index load failed:", err);
    });

    updateRowHeightVar();
    renderInitialRows();
    updateSelectedLabel();
    updateScheduleButton();

    window.requestAnimationFrame(() => {
      centerOnDate(selectedDate);
    });
  }

  function close() {
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    isOpen = false;
  }

  calendarBody.addEventListener("scroll", onScroll);
  calendarBody.addEventListener("click", onCellClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", updateRowHeightVar);

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });

  if (scheduleBtn) {
    scheduleBtn.addEventListener("click", () => {
      // Placeholder; scheduling will be wired up later.
    });
  }

  return {
    open,
    close,
    isOpen: () => isOpen,
    getSelectedDate: () => selectedDate,
  };
}
