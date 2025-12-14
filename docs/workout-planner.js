const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WEEKS = 16;
const SCROLL_BUFFER_ROWS = 2;

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

  function updateRowHeightVar() {
    const next = Math.max(140, Math.round(window.innerHeight * 0.24));
    rowHeightPx = next;
    if (modal) {
      modal.style.setProperty("--planner-row-height", `${next}px`);
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
      calendarBody.scrollTop -= (containerRect.top - cellRect.top) + padding;
    } else if (cellRect.bottom > containerRect.bottom - padding) {
      calendarBody.scrollTop += (cellRect.bottom - containerRect.bottom) + padding;
    }
  }

  function setSelectedDate(nextDate) {
    selectedDate = nextDate;
    updateSelectedLabel();
    applySelectionStyles();
    const cell = ensureSelectionRendered();
    scrollCellIntoView(cell);
  }

  function moveSelection(daysDelta) {
    const base = selectedDate || new Date();
    const next = addDays(base, daysDelta);
    setSelectedDate(next);
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

      const isFirstOfMonth = dayDate.getDate() === 1;
      const isToday = isSameDay(dayDate, today);
      if (isFirstOfMonth || isToday) {
        const monthLabel = document.createElement("div");
        monthLabel.className = "planner-month-label";
        if (isToday) {
          monthLabel.textContent = "Today";
        } else {
          try {
            monthLabel.textContent = dayDate.toLocaleString(undefined, {month: "long"});
          } catch (_err) {
            monthLabel.textContent = String(dayDate.getMonth() + 1);
          }
        }
        cell.appendChild(monthLabel);
        cell.classList.add("has-month-label");
      }

      const num = document.createElement("div");
      num.className = "planner-day-number";
      num.textContent = String(dayDate.getDate());
      cell.appendChild(num);

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
      const meta = {firstDow, lastDow};
      monthMeta.set(k, meta);
      return meta;
    };

    weekRows.forEach((row, rowIdx) => {
      const cells = Array.from(row.querySelectorAll(".planner-day"));
      cells.forEach((cell, colIdx) => {
        cell.classList.remove(
          "month-top-boundary",
          "month-left-boundary",
          "month-bottom-boundary"
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
      calendarBody.scrollTop = Math.max(0, row * rowHeight);
      return;
    }

    calendarBody.scrollTop = Math.max(0, relativeRow * rowHeight);
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
    const {scrollTop, clientHeight, scrollHeight} = calendarBody;

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
    selectedDate = selectedDate || new Date();
    anchorStart = startOfWeek(selectedDate);

    overlay.style.display = "flex";
    overlay.removeAttribute("aria-hidden");
    isOpen = true;

    updateRowHeightVar();
    renderInitialRows();
    updateSelectedLabel();

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
