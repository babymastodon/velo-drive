// workout-picker.js
// Singleton for the ZWO workout picker modal.
//
// Encapsulates:
//   - ZWO directory selection & permission
//   - scanning/parsing .zwo files
//   - metrics-based sorting/filtering
//   - rendering mini workout graphs
//   - keyboard navigation & state persistence
//
// NOTE: CanonicalWorkout is the primary data structure.
// ZWO files are parsed via parseZwoXmlToCanonicalWorkout, and ALL metrics
// are derived from CanonicalWorkout.rawSegments + current FTP.

import {
  computeMetricsFromSegments,
  getDurationBucket,
  formatDurationMinSec,
  inferZoneFromSegments,
} from "./workout-metrics.js";

import { createWorkoutBuilder } from "./workout-builder.js";
import { renderMiniWorkoutGraph } from "./workout-chart.js";
import { parseTrainerDayUrl } from "./scrapers.js";
import { parseFitFile } from "./fit-file.js";

import {
  ensureDirPermission,
  loadPickerState,
  savePickerState,
  saveSelectedWorkout,
  loadZwoDirHandle,
  loadTrashDirHandle,
} from "./storage.js";

import {
  parseZwoXmlToCanonicalWorkout,
  canonicalWorkoutToZwoXml,
} from "./zwo.js";

let instance = null;

/**
 * CanonicalWorkout shape (for reference):
 *
 * @typedef CanonicalWorkout
 * @property {string} source
 * @property {string} sourceURL
 * @property {string} workoutTitle
 * @property {Array<[number, number, number, (string?)]>} rawSegments
 * @property {string} description
 */

/**
 * @typedef PickerConfig
 * @property {HTMLElement} overlay
 * @property {HTMLElement} modal
 * @property {HTMLButtonElement} closeBtn
 * @property {HTMLInputElement} searchInput
 * @property {HTMLSelectElement} zoneFilter
 * @property {HTMLSelectElement} durationFilter
 * @property {HTMLElement} summaryEl
 * @property {HTMLElement} tbody
 * @property {() => number} getCurrentFtp
 * @property {(payload: any) => void} onWorkoutSelected
 */

/**
 * Returns the singleton picker instance (creates it on first call).
 * Safe to call multiple times with the same config.
 */
export function getWorkoutPicker(config) {
  if (!instance) {
    instance = createWorkoutPicker(config);
  }
  return instance;
}

// --------------------------- ZWO scanning & metrics ---------------------------

/**
 * Scan a directory and return an array of CanonicalWorkout.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<CanonicalWorkout[]>}
 */
async function scanWorkoutsFromDirectory(handle) {
  /** @type {CanonicalWorkout[]} */
  const workouts = [];
  try {
    for await (const entry of handle.values()) {
      if (entry.kind !== "file") continue;
      if (!entry.name.toLowerCase().endsWith(".zwo")) continue;

      const file = await entry.getFile();
      const text = await file.text();

      const canonicalWorkout = parseZwoXmlToCanonicalWorkout(text);
      if (!canonicalWorkout) continue;

      workouts.push(canonicalWorkout);
    }
  } catch (err) {
    console.error("[WorkoutPicker] Error scanning workouts:", err);
  }
  return workouts;
}

// Small helper to create inline SVG icons used in picker buttons.
function createIconSvg(kind) {
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.classList.add("wb-code-icon");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  if (kind === "edit") {
    const p1 = document.createElementNS(svgNS, "path");
    p1.setAttribute("d", "M12 20h9");
    const p2 = document.createElementNS(svgNS, "path");
    p2.setAttribute("d", "M16.5 3.5l4 4-11 11H5.5v-4.5l11-11z");
    svg.appendChild(p1);
    svg.appendChild(p2);
  } else if (kind === "delete") {
    // Classic, normal trash can icon (Feather-style)
    const p1 = document.createElementNS(svgNS, "path");
    p1.setAttribute("d", "M3 6h18"); // top bar

    const p2 = document.createElementNS(svgNS, "path");
    p2.setAttribute("d", "M8 6V4h8v2"); // handle

    const p3 = document.createElementNS(svgNS, "path");
    p3.setAttribute("d", "M6 6l1 14h10l1-14"); // can outline

    const p4 = document.createElementNS(svgNS, "path");
    p4.setAttribute("d", "M10 11v6"); // inner line L

    const p5 = document.createElementNS(svgNS, "path");
    p5.setAttribute("d", "M14 11v6"); // inner line R

    svg.appendChild(p1);
    svg.appendChild(p2);
    svg.appendChild(p3);
    svg.appendChild(p4);
    svg.appendChild(p5);
  } else if (kind === "link") {
    // External-link style icon
    const p1 = document.createElementNS(svgNS, "path");
    p1.setAttribute("d", "M18 3h3v3");
    const p2 = document.createElementNS(svgNS, "path");
    p2.setAttribute("d", "M21 3l-9 9");
    const p3 = document.createElementNS(svgNS, "path");
    p3.setAttribute(
      "d",
      "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
    );
    svg.appendChild(p1);
    svg.appendChild(p2);
    svg.appendChild(p3);
  } else if (kind === "clone") {
    const r1 = document.createElementNS(svgNS, "rect");
    r1.setAttribute("x", "8");
    r1.setAttribute("y", "7");
    r1.setAttribute("width", "10");
    r1.setAttribute("height", "10");
    r1.setAttribute("rx", "2");
    const r2 = document.createElementNS(svgNS, "rect");
    r2.setAttribute("x", "5");
    r2.setAttribute("y", "4");
    r2.setAttribute("width", "10");
    r2.setAttribute("height", "10");
    r2.setAttribute("rx", "2");
    svg.appendChild(r1);
    svg.appendChild(r2);
  }

  return svg;
}

// --------------------------- Singleton factory ---------------------------

function createWorkoutPicker(config) {
  const {
    overlay,
    modal,
    closeBtn,
    searchInput,
    zoneFilter,
    durationFilter,
    summaryEl,
    tbody,
    getCurrentFtp,
    onWorkoutSelected,
    onScheduleSelected,
    onScheduleCanceled,
    onScheduleUnschedule,
  } = config;

  const addWorkoutBtn = modal.querySelector("#pickerAddWorkoutBtn");
  const builderBackBtn = modal.querySelector("#workoutBuilderBackBtn");
  const builderSaveBtn = modal.querySelector("#workoutBuilderSaveBtn");
  const builderTrainerDayBtn = modal.querySelector(
    "#workoutBuilderTrainerDayBtn",
  );
  const builderUploadBtn = modal.querySelector("#workoutBuilderUploadBtn");
  const builderRoot = modal.querySelector("#workoutBuilderRoot");
  const builderStatusEl = modal.querySelector("#workoutBuilderStatus");
  const builderFooter = modal.querySelector("#builderFooter");
  const builderShortcutsEl = modal.querySelector("#builderShortcuts");
  const emptyStateEl = modal.querySelector("#pickerEmptyState");
  const emptyAddBtn = modal.querySelector("#pickerEmptyAddBtn");
  const titleEl = modal.querySelector("#workoutPickerTitle");
  const pickerBackToPlannerBtn = modal.querySelector("#pickerBackToPlannerBtn");
  const controlsEl = modal.querySelector(".workout-picker-controls");
  const searchWrap = searchInput?.closest(".picker-search-wrap") || null;
  const scheduleUnscheduleBtn = document.createElement("button");
  scheduleUnscheduleBtn.className = "picker-add-btn delete-workout-btn";
  scheduleUnscheduleBtn.type = "button";
  scheduleUnscheduleBtn.style.display = "none";
  scheduleUnscheduleBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" /><path d="M8 16l8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg><span>Unschedule</span>`;
  if (controlsEl) controlsEl.appendChild(scheduleUnscheduleBtn);
  scheduleUnscheduleBtn.addEventListener("click", () => {
    if (typeof onScheduleUnschedule === "function" && scheduleMode?.entry) {
      onScheduleUnschedule(scheduleMode.entry);
    }
  });
  let scheduleMode = null; // {dateKey, existingEntry, editMode}

  /** @type {CanonicalWorkout[]} */
  let pickerWorkouts = [];
  let pickerExpandedTitle = null; // track by workoutTitle
  let pickerSortKey = "kjAdj"; // header label preserved, but this is kJ @ current FTP
  let pickerSortDir = "asc";
  let isPickerOpen = false;
  let isBuilderMode = false;
  let hasUnsavedBuilderChanges = false;
  let builderBaseline = null; // CanonicalWorkout snapshot to compare against
  let builderOriginalTitle = null;
  let suppressBuilderDirty = false;
  let builderHasSelection = false;
  function syncScheduleUi() {
    if (titleEl) {
      titleEl.style.display = scheduleMode ? "none" : "";
    }
    if (pickerBackToPlannerBtn) {
      pickerBackToPlannerBtn.style.display = scheduleMode
        ? "inline-flex"
        : "none";
    }
  }

  // workoutBuilder.getState() returns a CanonicalWorkout
  const workoutBuilder =
    builderRoot &&
    createWorkoutBuilder({
      rootEl: builderRoot,
      getCurrentFtp,
      statusMessageEl: builderStatusEl,
      onChange: handleBuilderChange,
      onStatusChange: updateBuilderStatus,
      onRequestBack: handleBackToLibrary,
      onUiStateChange: (state) => {
        updateBuilderShortcuts(state?.hasSelection);
      },
    });

  if (builderTrainerDayBtn) {
    builderTrainerDayBtn.addEventListener("click", async (evt) => {
      evt.preventDefault();
      if (!workoutBuilder) return;
      const url = window.prompt(
        "Paste TrainerDay workout URL.\nExample: https://app.trainerday.com/workouts/vo2-max-1-8x4min-120"
      );
      if (!url) return;
      const [canonical, error] = await parseTrainerDayUrl(url.trim());
      if (!canonical) {
        if (error) alert(error);
        return;
      }
      suppressBuilderDirty = true;
      try {
        workoutBuilder.loadCanonicalWorkout(canonical);
        workoutBuilder.refreshLayout();
        builderOriginalTitle = null;
        builderBaseline = cloneCanonicalWorkout(canonical);
        hasUnsavedBuilderChanges = true;
        if (titleEl) {
          titleEl.textContent =
            canonical.workoutTitle || "TrainerDay Workout";
        }
      } finally {
        suppressBuilderDirty = false;
      }
    });
  }

  if (builderUploadBtn) {
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".zwo,.fit";
    uploadInput.style.display = "none";
    modal.appendChild(uploadInput);

    builderUploadBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      if (!workoutBuilder) return;
      uploadInput.click();
    });

    uploadInput.addEventListener("change", async () => {
      if (!workoutBuilder) return;
      const file = uploadInput.files && uploadInput.files[0];
      uploadInput.value = "";
      if (!file) return;
      const name = file.name || "";
      const ext = name.toLowerCase().split(".").pop();
      let canonical = null;
      try {
        if (ext === "fit") {
          const buf = await file.arrayBuffer();
          const parsed = parseFitFile(buf);
          canonical = parsed?.canonicalWorkout || null;
        } else {
          const text = await file.text();
          canonical = parseZwoXmlToCanonicalWorkout(text);
        }
      } catch (err) {
        console.warn("[WorkoutBuilder] Upload parse failed:", err);
        canonical = null;
      }
      if (!canonical || !Array.isArray(canonical.rawSegments)) {
        alert("Unable to load workout file.");
        return;
      }
      const normalized = normalizeUploadedWorkout(canonical, name);
      suppressBuilderDirty = true;
      try {
        workoutBuilder.loadCanonicalWorkout(normalized);
        workoutBuilder.refreshLayout();
        builderOriginalTitle = null;
        builderBaseline = cloneCanonicalWorkout(normalized);
        hasUnsavedBuilderChanges = true;
        if (titleEl) {
          titleEl.textContent =
            normalized.workoutTitle || "Uploaded Workout";
        }
      } finally {
        suppressBuilderDirty = false;
      }
    });
  }


  // --------------------------- helpers for derived info ---------------------------

  function getCanonicalZone(cw) {
    return inferZoneFromSegments(cw.rawSegments) || "Uncategorized";
  }

  /**
   * Structure returned from computeVisiblePickerWorkouts:
   *   { canonical, zone, metrics }
   *
   * All display fields (title, description, source, etc.) are taken
   * directly from `canonical` elsewhere. Only `zone` + `metrics`
   * are derived here.
   */
  function computeVisiblePickerWorkouts() {
    const searchTerm = (searchInput?.value || "").toLowerCase();
    const zoneValue = zoneFilter?.value || "";
    const durValue = durationFilter?.value || "";
    const currentFtp = getCurrentFtp();
    /** @type {{ canonical: CanonicalWorkout, zone: string, metrics: any }[]} */
    let items = pickerWorkouts.map((canonical) => {
      const metrics = computeMetricsFromSegments(
        canonical.rawSegments,
        currentFtp,
      );
      const zone = getCanonicalZone(canonical);
      return { canonical, zone, metrics };
    });

    if (zoneValue) {
      items = items.filter((item) => item.zone === zoneValue);
    }

    if (durValue) {
      items = items.filter(
        (item) => getDurationBucket(item.metrics.durationMin) === durValue,
      );
    }

    if (searchTerm) {
      const rawTokens = searchTerm
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      let rangeMin = null;
      let rangeMax = null;
      const tokens = [];
      rawTokens.forEach((tok) => {
        const compactRange = tok.match(/^(\d+)\s*[-–]\s*(\d+)\s*(m|min)?$/i);
        if (compactRange) {
          rangeMin = Number(compactRange[1]);
          rangeMax = Number(compactRange[2]);
          return;
        }
        const lt = tok.match(/^<\s*(\d+)/);
        const gt = tok.match(/^>\s*(\d+)/);
        if (lt) {
          rangeMax = Number(lt[1]);
          return;
        }
        if (gt) {
          rangeMin = Number(gt[1]);
          return;
        }
        const approx = tok.match(/^(\d+)\s*(m|min)?$/i);
        if (approx) {
          const val = Number(approx[1]);
          if (Number.isFinite(val)) {
            rangeMin = rangeMin == null ? val - 5 : rangeMin;
            rangeMax = rangeMax == null ? val + 5 : rangeMax;
            return;
          }
        }
        tokens.push(tok);
      });
      if (rangeMin != null && rangeMax != null && rangeMin > rangeMax) {
        const tmp = rangeMin;
        rangeMin = rangeMax;
        rangeMax = tmp;
      }
      items = items.filter((item) => {
        const { canonical } = item;
        const title = canonical.workoutTitle;
        const source = canonical.source || "";
        const haystack = [
          title,
          item.zone,
          source,
        ]
          .join(" ")
          .toLowerCase();
        const tokensMatch = tokens.every((t) => haystack.includes(t));
        if (!tokensMatch) return false;
        if (rangeMin != null || rangeMax != null) {
          const dur = item.metrics.durationMin;
          if (rangeMin != null && !(dur >= rangeMin)) return false;
          if (rangeMax != null && !(dur <= rangeMax)) return false;
        }
        return true;
      });
    }

    const sortKey = pickerSortKey;
    const dir = pickerSortDir === "asc" ? 1 : -1;
    const num = (val) => (Number.isFinite(val) ? val : -Infinity);

    items = items.slice().sort((a, b) => {
      if (sortKey === "kjAdj") {
        return (num(a.metrics.kj) - num(b.metrics.kj)) * dir;
      }
      if (sortKey === "if") {
        return (num(a.metrics.ifValue) - num(b.metrics.ifValue)) * dir;
      }
      if (sortKey === "tss") {
        return (num(a.metrics.tss) - num(b.metrics.tss)) * dir;
      }
      if (sortKey === "duration") {
        return (num(a.metrics.durationMin) - num(b.metrics.durationMin)) * dir;
      }
      if (sortKey === "name") {
        return (
          a.canonical.workoutTitle.localeCompare(b.canonical.workoutTitle) * dir
        );
      }
      return 0;
    });

    return items;
  }

  function normalizeUploadedWorkout(canonical, fileName) {
    const next = {
      ...canonical,
      rawSegments: Array.isArray(canonical.rawSegments)
        ? canonical.rawSegments
        : [],
      textEvents: Array.isArray(canonical.textEvents)
        ? canonical.textEvents
        : [],
    };
    const baseName = String(fileName || "").replace(/\.[^/.]+$/, "");
    if (!next.workoutTitle || !String(next.workoutTitle).trim()) {
      next.workoutTitle = baseName || "Uploaded Workout";
    }
    if (!next.source || !String(next.source).trim()) {
      next.source = baseName ? `Uploaded ${baseName}` : "Uploaded file";
    }
    if (!next.description || !String(next.description).trim()) {
      next.description = buildSegmentDescription(next.rawSegments);
    }
    return next;
  }

  function buildSegmentDescription(rawSegments) {
    if (!Array.isArray(rawSegments) || !rawSegments.length) {
      return "Workout loaded from file.";
    }
    let totalSec = 0;
    let rampCount = 0;
    let steadyCount = 0;
    let freeRideCount = 0;
    rawSegments.forEach((seg) => {
      if (!Array.isArray(seg)) return;
      const minutes = Number(seg[0]) || 0;
      const durationSec = Math.max(1, Math.round(minutes * 60));
      totalSec += durationSec;
      if (seg[3] === "freeride") {
        freeRideCount += 1;
        return;
      }
      const start = Number(seg[1]) || 0;
      const end = seg[2] != null ? Number(seg[2]) : start;
      if (Math.abs(start - end) > 1e-6) {
        rampCount += 1;
      } else {
        steadyCount += 1;
      }
    });
    const parts = [];
    const durationLabel = formatDurationMinSec(totalSec);
    parts.push(`${durationLabel} workout`);
    const detail = [];
    if (steadyCount) {
      detail.push(`${steadyCount} steady`);
    }
    if (rampCount) {
      detail.push(`${rampCount} ramp${rampCount === 1 ? "" : "s"}`);
    }
    if (freeRideCount) {
      detail.push(`${freeRideCount} freeride`);
    }
    if (detail.length) {
      parts.push(`with ${detail.join(", ")}`);
    }
    return parts.join(" ") + ".";
  }

  function updateSortHeaderIndicator() {
    if (!modal) return;
    const headers = modal.querySelectorAll("th[data-sort-key]");
    headers.forEach((th) => {
      const key = th.getAttribute("data-sort-key");
      th.classList.remove("sorted-asc", "sorted-desc");
      if (key === pickerSortKey) {
        th.classList.add(
          pickerSortDir === "asc" ? "sorted-asc" : "sorted-desc",
        );
      }
    });
  }

  // --------------------------- rendering ---------------------------
  function createStatChip(label) {
    const el = document.createElement("div");
    el.className = "wb-stat-chip";
    const labelEl = document.createElement("div");
    labelEl.className = "wb-stat-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "wb-stat-value";
    valueEl.textContent = "--";
    el.appendChild(labelEl);
    el.appendChild(valueEl);
    return { el, value: valueEl };
  }

  function formatPickerDuration(metrics) {
    if (!metrics) return "";
    if (Number.isFinite(metrics.totalSec) && metrics.totalSec > 0) {
      return formatDurationMinSec(metrics.totalSec);
    }
    if (Number.isFinite(metrics.durationMin) && metrics.durationMin > 0) {
      return formatDurationMinSec(metrics.durationMin * 60);
    }
    return "";
  }

  function zoneClassFromLabel(zoneLabel) {
    const z = (zoneLabel || "").toLowerCase();
    if (z.startsWith("recovery")) return "picker-zone-dot-recovery";
    if (z.startsWith("endurance")) return "picker-zone-dot-endurance";
    if (z.startsWith("tempo")) return "picker-zone-dot-tempo";
    if (z.startsWith("threshold")) return "picker-zone-dot-threshold";
    if (z.startsWith("vo2")) return "picker-zone-dot-vo2";
    if (z.startsWith("anaerobic") || z.startsWith("hiit")) {
      return "picker-zone-dot-anaerobic";
    }
    return "";
  }

  function createZoneCell(zoneLabel) {
    const wrapper = document.createElement("div");
    wrapper.className = "picker-zone-cell";

    const dot = document.createElement("span");
    dot.className = "picker-zone-dot";
    const cls = zoneClassFromLabel(zoneLabel);
    if (cls) {
      dot.classList.add(cls);
    } else {
      dot.classList.add("picker-zone-dot-unknown");
    }

    const text = document.createElement("span");
    text.textContent = zoneLabel || "Uncategorized";

    wrapper.appendChild(dot);
    wrapper.appendChild(text);
    return wrapper;
  }

  function renderWorkoutPickerTable() {
    if (!tbody) return;

    if (emptyStateEl) emptyStateEl.style.display = "none";

    const total = pickerWorkouts.length;

    if (total === 0) {
      tbody.innerHTML = "";
      if (summaryEl) {
        summaryEl.textContent = "No .zwo files found in this folder yet.";
      }
      if (!isBuilderMode && emptyStateEl) {
        emptyStateEl.style.display = "flex";
      }
      updateSortHeaderIndicator();
      return;
    }

    const shownItems = computeVisiblePickerWorkouts();
    const shownCount = shownItems.length;

    tbody.innerHTML = "";

    if (summaryEl) {
      summaryEl.textContent = `${shownCount} of ${total} workouts shown`;
    }

    const colCount = 7;
    const currentFtp = getCurrentFtp();

    for (const item of shownItems) {
      const { canonical, zone, metrics } = item;
      const title = canonical.workoutTitle;
      const source = canonical.source || "";
      const description = canonical.description || "";

      const isExpanded = pickerExpandedTitle === title;

      if (!isExpanded) {
        // --------- Normal (collapsed) row ----------
        const tr = document.createElement("tr");
        tr.className = "picker-row";
        tr.dataset.title = title;

        const tdName = document.createElement("td");
        tdName.textContent = title;
        tdName.title = title;
        tr.appendChild(tdName);

        const tdCat = document.createElement("td");
        tdCat.appendChild(createZoneCell(zone));
        tr.appendChild(tdCat);

        const tdSource = document.createElement("td");
        tdSource.textContent = source;
        tr.appendChild(tdSource);

        const tdIf = document.createElement("td");
        tdIf.textContent =
          metrics.ifValue != null ? metrics.ifValue.toFixed(2) : "";
        tr.appendChild(tdIf);

        const tdTss = document.createElement("td");
        tdTss.textContent =
          metrics.tss != null ? String(Math.round(metrics.tss)) : "";
        tr.appendChild(tdTss);

        const tdDur = document.createElement("td");
        tdDur.textContent = formatPickerDuration(metrics);
        tr.appendChild(tdDur);

        const tdKj = document.createElement("td");
        tdKj.textContent =
          metrics.kj != null ? `${Math.round(metrics.kj)} kJ` : "";
        tr.appendChild(tdKj);

        tbody.appendChild(tr);

        tr.addEventListener("click", () => {
          pickerExpandedTitle = pickerExpandedTitle === title ? null : title;
          renderWorkoutPickerTable();
        });
      } else {
        // --------- Expanded row ONLY (header + tags/description + full-width chart) ----------
        const expTr = document.createElement("tr");
        expTr.className = "picker-expanded-row";
        expTr.dataset.title = title;

        const expTd = document.createElement("td");
        expTd.colSpan = colCount;

        // Use both the original layout class + our column override
        const container = document.createElement("div");
        container.className = "picker-expanded picker-expanded-layout";

        // Clickable top band (invisible overlay) to collapse without affecting layout.
        const collapseHit = document.createElement("div");
        collapseHit.className = "picker-expanded-collapse-hit";
        collapseHit.title = "Collapse details";
        collapseHit.addEventListener("click", (evt) => {
          evt.stopPropagation();
          pickerExpandedTitle = null;
          renderWorkoutPickerTable();
        });
        container.appendChild(collapseHit);

        /* =========================
           HEADER: title left, buttons right (2-row layout)
           ========================= */
        const headerBar = document.createElement("div");
        headerBar.className = "picker-expanded-header";

        // Title (grid column 1)
        const titleElDiv = document.createElement("div");
        titleElDiv.className = "picker-expanded-title";
        titleElDiv.textContent = title;

        // Button group (grid column 2)
        const actionsRow = document.createElement("div");
        actionsRow.className = "picker-expanded-actions";

        // VISIT WEBSITE button (if URL exists)
        if (canonical.sourceURL) {
          const visitBtn = document.createElement("button");
          visitBtn.type = "button";
          visitBtn.className = "wb-code-insert-btn visit-website-btn";
          visitBtn.title = "Open the workout's website in a new tab.";

          const linkIcon = createIconSvg("link"); // uses your existing icon function
          const linkText = document.createElement("span");
          linkText.textContent = "Visit website";

          visitBtn.appendChild(linkIcon);
          visitBtn.appendChild(linkText);

          visitBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            window.open(canonical.sourceURL, "_blank");
          });

          // Insert BEFORE delete
          actionsRow.appendChild(visitBtn);
        }

        // DELETE button
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "wb-code-insert-btn delete-workout-btn";
        deleteBtn.title = "Delete this workout file from your library.";

        const deleteIcon = createIconSvg("delete");
        const deleteText = document.createElement("span");
        deleteText.textContent = "Delete";
        deleteBtn.appendChild(deleteIcon);
        deleteBtn.appendChild(deleteText);

        deleteBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          deleteWorkoutFile(canonical);
        });

        // CLONE button
        const cloneBtn = document.createElement("button");
        cloneBtn.type = "button";
        cloneBtn.className = "wb-code-insert-btn clone-workout-btn";
        cloneBtn.title = "Clone this workout.";

        const cloneIcon = createIconSvg("clone");
        const cloneText = document.createElement("span");
        cloneText.textContent = "Clone";
        cloneBtn.appendChild(cloneIcon);
        cloneBtn.appendChild(cloneText);

        cloneBtn.addEventListener("click", async (evt) => {
          evt.stopPropagation();
          const copy = cloneCanonicalWorkout(canonical);
          if (!copy) return;
          copy.workoutTitle = buildCopyTitle(canonical.workoutTitle || "Workout");
          const result = await saveCanonicalWorkoutToZwoDir(copy);
          if (!result.ok) return;
          if (result.dirHandle) {
            await rescanWorkouts(result.dirHandle, { skipRestoreState: true });
          }
          pickerExpandedTitle = copy.workoutTitle || null;
          renderWorkoutPickerTable();
        });

        // EDIT button
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "wb-code-insert-btn edit-workout-btn";
        editBtn.title = "Open this workout in the builder.";

        const editIcon = createIconSvg("edit");
        const editText = document.createElement("span");
        editText.textContent = "Edit";
        editBtn.appendChild(editIcon);
        editBtn.appendChild(editText);

        editBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          openWorkoutInBuilder(canonical);
        });

        // SELECT button
        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "select-workout-btn";
        if (scheduleMode) {
          selectBtn.textContent = "Schedule Workout";
          selectBtn.title = "Schedule this workout on the selected day.";
          selectBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            if (typeof onScheduleSelected === "function") {
              onScheduleSelected({
                canonical,
                dateKey: scheduleMode.dateKey,
                existingEntry: scheduleMode.entry || null,
              });
            }
          });
        } else {
          selectBtn.textContent = "Select workout";
          selectBtn.title = "Use this workout on the workout page.";
          selectBtn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            doSelectWorkout(canonical);
          });
        }

        if (!scheduleMode) {
          actionsRow.appendChild(deleteBtn);
          actionsRow.appendChild(cloneBtn);
          actionsRow.appendChild(editBtn);
        }
        actionsRow.appendChild(selectBtn);

        // Put into header (grid auto-places them into the two columns)
        headerBar.appendChild(titleElDiv);
        headerBar.appendChild(actionsRow);
        container.appendChild(headerBar);

        /* =========================
           CONTENT 1: tags (left) + description (right)
           ========================= */
        const contentRow1 = document.createElement("div");
        contentRow1.className = "picker-expanded-main";

        // Left: tags / stats
        const tagsCol = document.createElement("div");
        tagsCol.className = "picker-expanded-main-left";

        const tagsRow = document.createElement("div");
        tagsRow.className = "wb-stats-row";

        // Chips (using original helper signature)
        const zoneChip = createStatChip("Zone");
        zoneChip.value.textContent = zone || "Uncategorized";
        tagsRow.appendChild(zoneChip.el);

        if (source) {
          const sourceChip = createStatChip("Source");
          sourceChip.value.textContent = source;
          tagsRow.appendChild(sourceChip.el);
        }

        if (metrics.ifValue != null) {
          const ifChip = createStatChip("IF");
          ifChip.value.textContent = metrics.ifValue.toFixed(2);
          tagsRow.appendChild(ifChip.el);
        }

        if (metrics.tss != null) {
          const tssChip = createStatChip("TSS");
          tssChip.value.textContent = String(Math.round(metrics.tss));
          tagsRow.appendChild(tssChip.el);
        }

        if (metrics.durationMin != null || metrics.totalSec != null) {
          const durChip = createStatChip("Duration");
          durChip.value.textContent = formatPickerDuration(metrics);
          tagsRow.appendChild(durChip.el);
        }

        if (metrics.kj != null) {
          const kjChip = createStatChip("kJ");
          kjChip.value.textContent = `${Math.round(metrics.kj)}`;
          tagsRow.appendChild(kjChip.el);
        }

        tagsCol.appendChild(tagsRow);

        // Right: description
        const descCol = document.createElement("div");
        descCol.className = "picker-expanded-main-right";
        descCol.style.fontSize = "var(--font-size-base)";
        descCol.style.lineHeight = "1.6";

        if (description && description.trim()) {
          descCol.innerHTML = description.replace(/\n/g, "<br>");
        } else {
          descCol.textContent = "(No description)";
          descCol.className = "picker-detail-empty";
        }

        contentRow1.appendChild(tagsCol);
        contentRow1.appendChild(descCol);
        container.appendChild(contentRow1);

        /* =========================
           CONTENT 2: full-width chart (same height)
           ========================= */
        const contentRow2 = document.createElement("div");
        contentRow2.className = "picker-expanded-chart";

        const graphDiv = document.createElement("div");
        graphDiv.className = "picker-graph";

        contentRow2.appendChild(graphDiv);
        container.appendChild(contentRow2);

        expTd.appendChild(container);
        expTr.appendChild(expTd);
        tbody.appendChild(expTr);

        requestAnimationFrame(() => {
          renderMiniWorkoutGraph(graphDiv, canonical, currentFtp);
        });

        // NOTE: no click handler on expTr — clicking does NOT collapse the row
      }
    }

    updateSortHeaderIndicator();

    // After rendering, scroll the expanded row into view (if any).
    requestAnimationFrame(() => {
      if (!pickerExpandedTitle || !tbody) return;
      const expandedRow = tbody.querySelector(".picker-expanded-row");
      if (!expandedRow) return;

      expandedRow.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }

  function cloneCanonicalWorkout(cw) {
    if (!cw) return null;
    return {
      workoutTitle: cw.workoutTitle || "",
      source: cw.source || "",
      sourceURL: cw.sourceURL || "",
      description: cw.description || "",
      textEvents: Array.isArray(cw.textEvents)
        ? cw.textEvents.map((evt) => ({
          offsetSec: Number(evt?.offsetSec) || 0,
          durationSec: Number(evt?.durationSec) || 0,
          text: evt?.text || "",
        }))
        : [],
      rawSegments: Array.isArray(cw.rawSegments)
        ? cw.rawSegments.map((seg) =>
            Array.isArray(seg)
              ? seg[4] != null
                ? [seg[0], seg[1], seg[2], seg[3] ?? null, seg[4]]
                : seg[3] != null
                  ? [seg[0], seg[1], seg[2], seg[3]]
                  : [seg[0], seg[1], seg[2]]
              : seg,
          )
        : [],
    };
  }

  function buildCopyTitle(originalTitle) {
    const base = `${originalTitle} Copy`;
    const existing = new Set(
      pickerWorkouts.map((workout) => workout.workoutTitle || ""),
    );
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base} (${i})`)) {
      i += 1;
    }
    return `${base} (${i})`;
  }

  function canonicalEquals(a, b) {
    if (!a || !b) return false;
    if (
      (a.workoutTitle || "") !== (b.workoutTitle || "") ||
      (a.source || "") !== (b.source || "") ||
      (a.sourceURL || "") !== (b.sourceURL || "") ||
      (a.description || "") !== (b.description || "")
    ) {
      return false;
    }

    const arrA = Array.isArray(a.rawSegments) ? a.rawSegments : [];
    const arrB = Array.isArray(b.rawSegments) ? b.rawSegments : [];
    if (arrA.length !== arrB.length) return false;

    for (let i = 0; i < arrA.length; i += 1) {
      const segA = arrA[i] || [];
      const segB = arrB[i] || [];
      if (segA.length !== segB.length) return false;
      for (let j = 0; j < segA.length; j += 1) {
        const aVal = segA[j];
        const bVal = segB[j];
        if (typeof aVal === "string" || typeof bVal === "string") {
          if (String(aVal) !== String(bVal)) return false;
        } else if (Number(aVal) !== Number(bVal)) {
          return false;
        }
      }
    }
    const eventsA = Array.isArray(a.textEvents) ? a.textEvents : [];
    const eventsB = Array.isArray(b.textEvents) ? b.textEvents : [];
    if (eventsA.length !== eventsB.length) return false;
    for (let i = 0; i < eventsA.length; i += 1) {
      const aEvt = eventsA[i] || {};
      const bEvt = eventsB[i] || {};
      if (Number(aEvt.offsetSec) !== Number(bEvt.offsetSec)) return false;
      if (Number(aEvt.durationSec) !== Number(bEvt.durationSec)) return false;
      if (String(aEvt.text || "") !== String(bEvt.text || "")) return false;
    }
    return true;
  }

  function setBuilderBaselineFromCurrent() {
    if (!workoutBuilder) return;
    builderBaseline = cloneCanonicalWorkout(workoutBuilder.getState());
    hasUnsavedBuilderChanges = false;
  }

  function handleBuilderChange() {
    if (!workoutBuilder || suppressBuilderDirty || !isBuilderMode) return;
    const current = workoutBuilder.getState();
    const isDirty =
      !builderBaseline || !canonicalEquals(current, builderBaseline);
    hasUnsavedBuilderChanges = isDirty;
  }

  async function clearPersistedBuilderState() {
    if (
      workoutBuilder &&
      typeof workoutBuilder.clearPersistedState === "function"
    ) {
      await workoutBuilder.clearPersistedState();
    }
  }

  function resetHeaderStatus() {
    updateBuilderStatus({ text: "", tone: "neutral" });
    if (builderStatusEl) {
      builderStatusEl.style.display = "none";
    }
  }

  function updateBuilderStatus(payload) {
    if (!builderStatusEl) return;
    const text = payload?.text || "";
    const tone = payload?.tone || "neutral";

    builderStatusEl.textContent = text;
    builderStatusEl.dataset.tone = tone;
    builderStatusEl.classList.remove(
      "builder-status--ok",
      "builder-status--error",
      "builder-status--neutral",
    );
    builderStatusEl.classList.add(`builder-status--${tone}`);
    builderStatusEl.style.display = isBuilderMode ? "inline-flex" : "none";
  }

  function updateBuilderShortcuts(hasSelection) {
    builderHasSelection = !!hasSelection;
    if (!builderShortcutsEl) return;

    if (!builderHasSelection) {
      builderShortcutsEl.innerHTML =
        "<strong>h l</strong> <strong>← →</strong> to move &bull; " +
        "<strong>Enter</strong> to select &bull; " +
        "<strong>Backspace</strong> delete &bull; " +
        "<strong>R E T S V A W C I X</strong> insert block";
      return;
    }

    builderShortcutsEl.innerHTML =
      "<strong>h l</strong> <strong>← →</strong> adjust duration &bull; " +
      "<strong>(Shift)</strong> <strong>j k</strong> <strong>↓ ↑</strong> adjust power &bull; " +
      "<strong>Shift+Click</strong> or <strong>Shift+H/L/←/→</strong> " +
      "multi-select &bull; " +
      "<strong>Enter</strong> deselect &bull; " +
      "<strong>Space</strong> switch side";
  }

  async function openWorkoutInBuilder(canonicalWorkout) {
    if (!workoutBuilder) {
      console.warn("[WorkoutPicker] Workout builder is not available.");
      return;
    }

    const title =
      (canonicalWorkout && canonicalWorkout.workoutTitle) || "Edit workout";
    enterBuilderMode({ title });
    builderOriginalTitle = canonicalWorkout?.workoutTitle || null;

    suppressBuilderDirty = true;
    try {
      workoutBuilder.loadCanonicalWorkout(canonicalWorkout);
      workoutBuilder.refreshLayout();
      setBuilderBaselineFromCurrent();
    } catch (err) {
      console.error(
        "[WorkoutPicker] Failed to load workout into builder:",
        err,
      );
    } finally {
      suppressBuilderDirty = false;
    }
  }

  function enterBuilderMode(options = {}) {
    const { title } = options;
    isBuilderMode = true;
    if (builderRoot) builderRoot.style.display = "block";
    if (titleEl) titleEl.textContent = title || "New Workout";

    if (searchWrap) searchWrap.style.display = "none";
    if (searchInput) searchInput.style.display = "none";
    if (zoneFilter) zoneFilter.style.display = "none";
    if (durationFilter) durationFilter.style.display = "none";

    if (addWorkoutBtn) addWorkoutBtn.style.display = "none";
    if (builderTrainerDayBtn) builderTrainerDayBtn.style.display = "inline-flex";
    if (builderUploadBtn) builderUploadBtn.style.display = "inline-flex";
    if (builderSaveBtn) builderSaveBtn.style.display = "inline-flex";
    if (builderBackBtn) builderBackBtn.style.display = "inline-flex";

    modal.classList.add("workout-picker-modal--builder");

    if (emptyStateEl) emptyStateEl.style.display = "none";
    updateBuilderStatus({
      text: builderStatusEl ? builderStatusEl.textContent : "",
      tone: builderStatusEl?.dataset?.tone || "neutral",
    });
    updateBuilderShortcuts(builderHasSelection);

    if (workoutBuilder) {
      requestAnimationFrame(() => {
        workoutBuilder.refreshLayout();
      });
    }
  }

  function exitBuilderMode() {
    isBuilderMode = false;
    hasUnsavedBuilderChanges = false;
    builderBaseline = null;
    builderOriginalTitle = null;
    if (builderRoot) builderRoot.style.display = "none";
    modal.classList.remove("workout-picker-modal--builder");

    if (titleEl) titleEl.textContent = "Workout library";
    if (searchWrap) searchWrap.style.display = "";
    if (searchInput) searchInput.style.display = "";
    if (zoneFilter) zoneFilter.style.display = "";
    if (durationFilter) durationFilter.style.display = "";
    if (addWorkoutBtn) addWorkoutBtn.style.display = "inline-flex";
    if (builderTrainerDayBtn) builderTrainerDayBtn.style.display = "none";
    if (builderUploadBtn) builderUploadBtn.style.display = "none";
    if (builderSaveBtn) builderSaveBtn.style.display = "none";
    if (builderBackBtn) builderBackBtn.style.display = "none";
    resetHeaderStatus();
  }

  async function startBuilderFromScratch() {
    if (!workoutBuilder) return;
    enterBuilderMode({ title: "New Workout" });
    builderOriginalTitle = null;
    suppressBuilderDirty = true;

    let restored = false;
    if (typeof workoutBuilder.restorePersistedStateOrDefault === "function") {
      restored = await workoutBuilder.restorePersistedStateOrDefault();
    } else {
      workoutBuilder.clearState();
      workoutBuilder.refreshLayout();
    }

    suppressBuilderDirty = false;

    if (restored) {
      builderBaseline = null;
      hasUnsavedBuilderChanges = true;
    } else {
      setBuilderBaselineFromCurrent();
    }
  }

  function movePickerExpansion(delta) {
    const shownItems = computeVisiblePickerWorkouts();
    if (!shownItems.length) return;

    let idx = shownItems.findIndex(
      (item) => item.canonical.workoutTitle === pickerExpandedTitle,
    );

    if (idx === -1) {
      idx = delta > 0 ? 0 : shownItems.length - 1;
    } else {
      idx = (idx + delta + shownItems.length) % shownItems.length;
    }

    pickerExpandedTitle = shownItems[idx].canonical.workoutTitle;
    renderWorkoutPickerTable();
  }

  async function handleBackToLibrary() {
    if (isBuilderMode) {
      const ok = await maybeHandleUnsavedBeforeLeave({
        reopenAfterSave: true,
      });
      if (!ok) return;
    }
    await clearPersistedBuilderState();
    exitBuilderMode();
  }

  // --------------------------- sorting / hotkeys wiring ---------------------------

  function setupSorting() {
    if (!modal) return;
    const headerCells = modal.querySelectorAll("th[data-sort-key]");
    headerCells.forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");
        if (!key) return;
        if (pickerSortKey === key) {
          pickerSortDir = pickerSortDir === "asc" ? "desc" : "asc";
        } else {
          pickerSortKey = key;
          pickerSortDir = key === "kjAdj" ? "asc" : "desc";
        }
        renderWorkoutPickerTable();
        persistPickerState();
      });
    });
    updateSortHeaderIndicator();
  }

  function setupHotkeys() {
    const handleSelectNav = (selectEl, key) => {
      if (!selectEl) return false;
      const k = (key || "").toLowerCase();
      const isDeltaKey =
        k === "arrowdown" || k === "arrowup" || k === "j" || k === "k";
      if (!isDeltaKey) return false;
      const delta = k === "arrowup" || k === "k" ? -1 : 1;
      const opts = Array.from(selectEl.options || []);
      const idx =
        typeof selectEl.selectedIndex === "number" &&
        selectEl.selectedIndex >= 0
          ? selectEl.selectedIndex
          : opts.findIndex((o) => o.selected);
      const nextIdx = Math.min(
        Math.max(0, idx + delta),
        Math.max(0, opts.length - 1),
      );
      if (opts[nextIdx]) {
        selectEl.selectedIndex = nextIdx;
        opts[nextIdx].selected = true;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    };

    if (zoneFilter) {
      zoneFilter.addEventListener("keydown", (e) => {
        const handled = handleSelectNav(e.target, e.key);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        } else if ((e.key || "").toLowerCase() === "enter") {
          e.preventDefault();
          e.stopPropagation();
          zoneFilter.blur();
        }
      });
    }

    if (durationFilter) {
      durationFilter.addEventListener("keydown", (e) => {
        const handled = handleSelectNav(e.target, e.key);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        } else if ((e.key || "").toLowerCase() === "enter") {
          e.preventDefault();
          e.stopPropagation();
          durationFilter.blur();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (!isPickerOpen) return;
      if (isBuilderMode) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const tag = e.target?.tagName;
      const key = (e.key || "").toLowerCase();

      if (key === "/" && searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }

      if (document.activeElement === searchInput) {
        if (key === "enter") {
          e.preventDefault();
          searchInput.blur();
          const results = computeVisiblePickerWorkouts();
          if (results.length) {
            pickerExpandedTitle = results[0].canonical.workoutTitle;
            renderWorkoutPickerTable();
            const firstRow = modal.querySelector(".picker-row");
            if (firstRow) {
              const btn = firstRow.querySelector(".select-workout-btn");
              if (btn) btn.focus();
            }
          }
        } else if (key === "escape") {
          e.preventDefault();
          searchInput.value = "";
          searchInput.blur();
          renderWorkoutPickerTable();
        }
        return;
      }

      if (key === "z" && zoneFilter) {
        e.preventDefault();
        zoneFilter.focus();
        if (zoneFilter.showPicker) zoneFilter.showPicker();
        return;
      }

      if (key === "d" && durationFilter) {
        e.preventDefault();
        durationFilter.focus();
        if (durationFilter.showPicker) durationFilter.showPicker();
        return;
      }

      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (tag === "SELECT") {
        const handled = handleSelectNav(e.target, key);
        if (handled) {
          e.preventDefault();
          return;
        }
        if (key === "enter") {
          e.preventDefault();
          e.target.blur();
          return;
        }
        // Let native select handle other keys.
        return;
      }

      if (key === "escape") {
        e.preventDefault();
        if (scheduleMode) {
          close({ returnToPlanner: true });
        }
        return;
      }
      if (key === "backspace" && scheduleMode) {
        e.preventDefault();
        close({ returnToPlanner: true });
        return;
      }

      if (key === "enter") {
        // Allow Enter to select the expanded workout unless the search box is focused.
        if (searchInput && document.activeElement === searchInput) return;

        const expanded = computeVisiblePickerWorkouts().find(
          (item) => item.canonical.workoutTitle === pickerExpandedTitle,
        );
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          if (scheduleMode && typeof onScheduleSelected === "function") {
            onScheduleSelected({
              canonical: expanded.canonical,
              dateKey: scheduleMode.dateKey,
              existingEntry: scheduleMode.entry || null,
            });
          } else {
            doSelectWorkout(expanded.canonical);
          }
        }
        return;
      }

      if (key === "e" && !scheduleMode) {
        const expanded = computeVisiblePickerWorkouts().find(
          (item) => item.canonical.workoutTitle === pickerExpandedTitle,
        );
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          openWorkoutInBuilder(expanded.canonical);
        }
        return;
      }

      if (key === "arrowdown" || key === "j") {
        e.preventDefault();
        movePickerExpansion(+1);
        return;
      }

      if (key === "arrowup" || key === "k") {
        e.preventDefault();
        movePickerExpansion(-1);
        return;
      }
    });
  }

  // --------------------------- picker state persistence ---------------------------

  async function restorePickerStateIntoControls() {
    const saved = await loadPickerState();
    if (!saved) return;

    if (searchInput) searchInput.value = saved.searchTerm || "";
    if (zoneFilter) zoneFilter.value = saved.zone || "";
    if (durationFilter) {
      const allowedValues = Array.from(durationFilter.options).map(
        (opt) => opt.value,
      );
      const nextVal = saved.duration || "";
      durationFilter.value = allowedValues.includes(nextVal) ? nextVal : "";
    }
    if (saved.sortKey) pickerSortKey = saved.sortKey;
    if (saved.sortDir === "asc" || saved.sortDir === "desc") {
      pickerSortDir = saved.sortDir;
    }
  }

  function persistPickerState() {
    const state = {
      searchTerm: searchInput ? searchInput.value : "",
      zone: zoneFilter ? zoneFilter.value : "",
      duration: durationFilter ? durationFilter.value : "",
      sortKey: pickerSortKey,
      sortDir: pickerSortDir,
    };
    savePickerState(state);
  }

  // --------------------------- rescan & selection ---------------------------

  async function rescanWorkouts(handle, options = {}) {
    const { skipRestoreState = false } = options;

    if (!handle) {
      pickerWorkouts = [];
      renderWorkoutPickerTable();
      return;
    }

    const ok = await ensureDirPermission(handle);
    if (!ok) {
      pickerWorkouts = [];
      renderWorkoutPickerTable();
      return;
    }

    pickerExpandedTitle = null;
    pickerWorkouts = await scanWorkoutsFromDirectory(handle);

    if (!skipRestoreState) {
      await restorePickerStateIntoControls();
    }

    renderWorkoutPickerTable();
  }

  function doSelectWorkout(canonicalWorkout) {
    saveSelectedWorkout(canonicalWorkout);
    onWorkoutSelected(canonicalWorkout);
    close();
  }

  // --------------------------- save to library ---------------------------

  function resetPickerFilters() {
    if (searchInput) searchInput.value = "";
    if (zoneFilter) zoneFilter.value = "";
    if (durationFilter) durationFilter.value = "";
    persistPickerState();
  }

  async function moveWorkoutFileToTrash(fileName) {
    const srcDirHandle = await loadZwoDirHandle();
    const trashDirHandle = await loadTrashDirHandle();

    if (!srcDirHandle) {
      alert(
        "No workout library folder configured.\n\n" +
          "Open Settings and choose a VeloDrive folder first.",
      );
      return false;
    }

    if (!trashDirHandle) {
      alert(
        "No trash folder is configured.\n\n" +
          "Open Settings and pick a VeloDrive folder so the trash folder can be created.",
      );
      return false;
    }

    const [hasSrcPerm, hasTrashPerm] = await Promise.all([
      ensureDirPermission(srcDirHandle),
      ensureDirPermission(trashDirHandle),
    ]);

    if (!hasSrcPerm) {
      alert(
        "VeloDrive does not have permission to modify your workout library folder.\n\n" +
          "Please re-authorize the folder in Settings.",
      );
      return false;
    }

    if (!hasTrashPerm) {
      alert(
        "VeloDrive does not have permission to write to your trash folder.\n\n" +
          "Please re-authorize the VeloDrive folder in Settings.",
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

      if (destFileName.length > 120) {
        const shortenedBase = base.slice(0, 80);
        destFileName = `${shortenedBase} (${stamp})${ext}`;
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
      console.error("[WorkoutPicker] Failed to move workout to trash:", err);
      alert(
        "Moving this workout to the trash folder failed. See logs for details.",
      );
      return false;
    }
  }

  async function deleteWorkoutFile(canonicalWorkout) {
    const title = canonicalWorkout.workoutTitle;
    const fileName = sanitizeZwoFileName(title) + ".zwo";

    const dirHandle = await loadZwoDirHandle();
    if (!dirHandle) {
      alert(
        "No workout library folder configured.\n\n" +
          "Open Settings and choose a VeloDrive folder first.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Move workout file "${fileName}" to the trash folder?`,
    );
    if (!confirmed) return;

    const moved = await moveWorkoutFileToTrash(fileName);
    if (!moved) return;

    await rescanWorkouts(dirHandle);
  }

  async function saveCurrentBuilderWorkoutToZwoDir(options = {}) {
    const { reopenAfterSave = true } = options;

    if (!workoutBuilder) {
      alert("Workout builder is not available. See logs for details.");
      return { ok: false };
    }

    try {
      const validation = workoutBuilder.validateForSave();
      if (!validation.ok) {
        // validateForSave is assumed to show its own messages
        return { ok: false };
      }

      /** @type {CanonicalWorkout} */
      const canonical = workoutBuilder.getState();

      if (
        !canonical ||
        !Array.isArray(canonical.rawSegments) ||
        !canonical.rawSegments.length
      ) {
        alert("This workout has no intervals to save.");
        return { ok: false };
      }

      const originalTitle =
        builderOriginalTitle && builderOriginalTitle.trim()
          ? builderOriginalTitle.trim()
          : null;
      const nextTitle = (canonical.workoutTitle || "").trim();
      if (originalTitle && nextTitle && originalTitle !== nextTitle) {
        const originalFileName =
          sanitizeZwoFileName(originalTitle) + ".zwo";
        const moved = await moveWorkoutFileToTrash(originalFileName);
        if (!moved) {
          return { ok: false };
        }
      }

      const result = await saveCanonicalWorkoutToZwoDir(canonical);
      if (!result.ok) {
        // Helper already alerted the user.
        return { ok: false };
      }

      hasUnsavedBuilderChanges = false;
      builderBaseline = cloneCanonicalWorkout(canonical);
      builderOriginalTitle = canonical.workoutTitle || null;

      await clearPersistedBuilderState();

      if (reopenAfterSave) {
        workoutBuilder.clearState({ persist: false });
        open(canonical.workoutTitle);
      }

      return { ok: true, canonical };
    } catch (err) {
      console.error("[WorkoutPicker] Save to ZWO dir failed:", err);
      alert(
        "Unexpected failure while saving workout.\n\n" +
          "See logs for details.",
      );
      return { ok: false };
    }
  }

  /**
   * Injective mapping from title → file-safe base name.
   * encodeURIComponent is injective on strings and yields only
   * filesystem-safe characters.
   */
  function sanitizeZwoFileName(title) {
    return encodeURIComponent(title);
  }

  /**
   * Save a CanonicalWorkout as a .zwo file in the configured ZWO directory.
   * Handles:
   *   - no ZWO folder selected
   *   - permission issues
   *   - overwriting by moving old file to trash first
   *   - actual write failures
   *
   * This function is responsible for user-facing alerts.
   *
   * @param {CanonicalWorkout} canonical
   * @returns {Promise<{ ok: boolean, fileName?: string, dirHandle?: FileSystemDirectoryHandle }>}
   */
  async function saveCanonicalWorkoutToZwoDir(canonical) {
    let dirHandle = await loadZwoDirHandle();
    if (!dirHandle) {
      alert(
        "No workout library folder configured.\n\n" +
          "Open Settings and choose a VeloDrive folder first.",
      );
      return { ok: false };
    }

    const hasPerm = await ensureDirPermission(dirHandle);
    if (!hasPerm) {
      alert(
        "VeloDrive does not have permission to write to your workout library folder.\n\n" +
          "Please re-authorize the folder in Settings.",
      );
      return { ok: false };
    }

    const baseName = sanitizeZwoFileName(canonical.workoutTitle);
    const fileName = baseName + ".zwo";

    // Detect overwrite case
    let overwriting = false;
    try {
      await dirHandle.getFileHandle(fileName, { create: false });
      overwriting = true;
    } catch {
      // File does not exist → first save → no overwrite
    }

    if (overwriting) {
      const moved = await moveWorkoutFileToTrash(fileName);
      if (!moved) {
        alert(
          `Failed to move existing workout "${fileName}" to trash.\n\n` +
            "The workout was NOT saved.",
        );
        return { ok: false };
      }
    }

    const zwoXml = canonicalWorkoutToZwoXml(canonical);

    // Write the new file
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(zwoXml);
      await writable.close();
    } catch (err) {
      console.error("[WorkoutPicker] Writing new file failed:", err);
      alert(
        `Saving workout "${fileName}" failed while writing the file.\n\n` +
          "See logs for details.",
      );
      return { ok: false };
    }

    return { ok: true, fileName, dirHandle };
  }

  async function maybeHandleUnsavedBeforeLeave(opts = {}) {
    const { reopenAfterSave = true } = opts; // kept for signature compatibility
    if (!isBuilderMode || !hasUnsavedBuilderChanges) return true;

    const confirmExit = window.confirm(
      "You have unsaved changes. Exit and discard them?\n\n" +
        "OK = Discard changes and leave\nCancel = Stay and keep editing",
    );

    if (!confirmExit) {
      return false;
    }

    if (workoutBuilder) {
      suppressBuilderDirty = true;
      await clearPersistedBuilderState();
      workoutBuilder.clearState({ persist: false });
      suppressBuilderDirty = false;
      setBuilderBaselineFromCurrent();
      hasUnsavedBuilderChanges = false;
    }
    return true;
  }

  // --------------------------- public API ---------------------------

  /**
   * Open the workout picker.
   *
   * @param {string} [workoutTitle]  Optional workout title to focus/expand.
   *                                 When provided, picker filters are only
   *                                 cleared if the workout would not be visible
   *                                 with the current picker controls.
   */
  async function open(workoutTitle) {
    exitBuilderMode();

    const handle = await loadZwoDirHandle();
    const hasTargetTitle =
      typeof workoutTitle === "string" && workoutTitle.trim().length > 0;

    if (!handle) {
      if (summaryEl) {
        summaryEl.textContent = "No ZWO folder selected.";
      }
    } else {
      // Always rescan and restore previous picker state first
      await rescanWorkouts(handle);

      if (hasTargetTitle) {
        // Check if the requested workout is visible with current filters.
        const isTargetVisible = computeVisiblePickerWorkouts().some(
          (item) => item.canonical.workoutTitle === workoutTitle,
        );

        // Only clear filters if the workout is hidden by them.
        if (!isTargetVisible) {
          resetPickerFilters();
        }

        pickerExpandedTitle = workoutTitle;
        renderWorkoutPickerTable();
      }
    }

    isPickerOpen = true;
    if (overlay) {
      overlay.classList.add("picker-mode");
      overlay.classList.remove("planner-mode");
      overlay.style.display = "flex";
      overlay.removeAttribute("aria-hidden");
    }
    if (scheduleMode && addWorkoutBtn) addWorkoutBtn.style.display = "none";
    syncScheduleUi();
  }

  async function openScheduleMode({ dateKey, entry, editMode = false } = {}) {
    scheduleMode = { dateKey, entry, editMode };
    if (titleEl)
      titleEl.textContent = editMode ? "Edit Schedule" : "Schedule Workout";
    if (addWorkoutBtn) addWorkoutBtn.style.display = "none";
    if (builderBackBtn) builderBackBtn.style.display = "none";
    if (builderSaveBtn) builderSaveBtn.style.display = "none";
    if (controlsEl) controlsEl.classList.add("picker-schedule-mode");
    scheduleUnscheduleBtn.style.display = editMode ? "" : "none";
    await open(entry?.workoutTitle);
    syncScheduleUi();
  }

  async function close({
    returnToPlanner = false,
    cancelSchedule = true,
  } = {}) {
    if (isBuilderMode) {
      const ok = await maybeHandleUnsavedBeforeLeave({
        reopenAfterSave: false,
      });
      if (!ok) return;
    }

    await clearPersistedBuilderState();
    exitBuilderMode();

    const wasSchedule = !!scheduleMode;
    if (
      wasSchedule &&
      cancelSchedule &&
      typeof onScheduleCanceled === "function"
    ) {
      onScheduleCanceled({ returnToPlanner });
    }
    isPickerOpen = false;
    if (overlay) {
      overlay.classList.remove("picker-mode");
      if (!overlay.classList.contains("planner-mode")) {
        overlay.style.display = "none";
        overlay.setAttribute("aria-hidden", "true");
      }
    }
    scheduleMode = null;
    if (titleEl) {
      titleEl.textContent = "Workout library";
      titleEl.style.display = "";
    }
    if (pickerBackToPlannerBtn) pickerBackToPlannerBtn.style.display = "none";
    if (addWorkoutBtn) addWorkoutBtn.style.display = "";
    if (builderBackBtn) builderBackBtn.style.display = "";
    if (builderSaveBtn) builderSaveBtn.style.display = "";
    if (controlsEl) controlsEl.classList.remove("picker-schedule-mode");
    scheduleUnscheduleBtn.style.display = "none";
  }

  function syncFtpChanged() {
    if (isPickerOpen) {
      renderWorkoutPickerTable();
    }
  }

  // Re-render theme-sensitive SVGs when OS theme toggles
  function rerenderThemeSensitive() {
    if (isPickerOpen) {
      renderWorkoutPickerTable();
    }
    if (isBuilderMode && workoutBuilder) {
      workoutBuilder.refreshLayout({ skipPersist: true });
    }
  }

  // --------------------------- initial DOM wiring ---------------------------

  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      await close();
    });
  }
  if (pickerBackToPlannerBtn) {
    pickerBackToPlannerBtn.addEventListener("click", async () => {
      await close({ returnToPlanner: true });
    });
  }

  if (addWorkoutBtn) {
    addWorkoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      startBuilderFromScratch();
    });
  }

  if (builderBackBtn) {
    builderBackBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await handleBackToLibrary();
    });
  }

  if (builderSaveBtn) {
    builderSaveBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await saveCurrentBuilderWorkoutToZwoDir();
    });
  }

  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", (e) => {
      e.preventDefault();
      startBuilderFromScratch();
    });
  }

  if (overlay) {
    let overlayPointerDown = false;
    overlay.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      overlayPointerDown = e.target === overlay;
    });
    overlay.addEventListener("pointerup", (e) => {
      if (
        overlayPointerDown &&
        e.target === overlay &&
        overlay.classList.contains("picker-mode")
      ) {
        close();
      }
      overlayPointerDown = false;
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderWorkoutPickerTable();
      persistPickerState();
    });
  }

  if (zoneFilter) {
    zoneFilter.addEventListener("change", () => {
      renderWorkoutPickerTable();
      persistPickerState();
    });
  }

  if (durationFilter) {
    durationFilter.addEventListener("change", () => {
      renderWorkoutPickerTable();
      persistPickerState();
    });
  }

  const themePref = document.documentElement?.dataset?.theme || "auto";
  if (window.matchMedia && themePref === "auto") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = () => rerenderThemeSensitive();
    if (mql.addEventListener) {
      mql.addEventListener("change", onThemeChange);
    } else if (mql.addListener) {
      mql.addListener(onThemeChange);
    }
  }

  setupSorting();
  setupHotkeys();

  return {
    open,
    openScheduleMode,
    close,
    syncFtpChanged,
    saveCanonicalWorkoutToZwoDir,
    isOpen: () => isPickerOpen,
    isBuilderMode: () => isBuilderMode,
  };
}
