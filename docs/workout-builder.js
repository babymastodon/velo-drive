// workout-builder.js

import {
  renderBuilderWorkoutGraph,
  renderMiniWorkoutGraph,
} from "./workout-chart.js";
import {
  computeMetricsFromSegments,
  inferZoneFromSegments,
} from "./workout-metrics.js";
import {
  clearWorkoutBuilderState,
  loadWorkoutBuilderState,
  saveWorkoutBuilderState,
} from "./storage.js";
import {
  parseZwoSnippet,
  segmentsToZwoSnippet,
} from "./zwo.js";

/**
 * @typedef WorkoutBuilderOptions
 * @property {HTMLElement} rootEl
 * @property {() => number} getCurrentFtp
 */

export function createWorkoutBuilder(options) {
  const {
    rootEl,
    getCurrentFtp,
    onChange,
    onStatusChange,
    statusMessageEl,
  } = options;
  if (!rootEl) throw new Error("[WorkoutBuilder] rootEl is required");

  // ---------- State ----------
  /** @type {Array<[number, number, number]>} */ // [minutes, startPct, endPct]
  let currentRawSegments = [];
  let currentErrors = [];
  let currentBlocks = [];
  let currentMetrics = null;
  let currentZone = null;
  let persistedState = null;
  let selectedBlockIndex = null;
  const statusTarget = statusMessageEl || null;

  function setStatusMessage(text, tone = "neutral") {
    if (statusTarget) {
      statusTarget.textContent = text;
      statusTarget.dataset.tone = tone;
    }
    if (typeof onStatusChange === "function") {
      onStatusChange({text, tone});
    }
  }

  // ---------- Layout ----------
  rootEl.innerHTML = "";
  rootEl.classList.add("workout-builder-root");

  const wrapper = document.createElement("div");
  wrapper.className = "workout-builder";

  const body = document.createElement("div");
  body.className = "workout-builder-body";

  // ---------- Layout ----------
  const topRow = document.createElement("div");
  topRow.className = "wb-top-row";

  const metaCard = document.createElement("div");
  metaCard.className = "wb-card wb-top-card";

  const metaFields = document.createElement("div");
  metaFields.className = "wb-meta-fields";

  const nameField = createLabeledInput("Name");
  const sourceField = createLabeledInput("Author / Source");
  const descField = createLabeledTextarea("Description");
  descField.textarea.placeholder = "Short description, goals, or cues (optional)";

  const urlInput = document.createElement("input");
  urlInput.type = "hidden";

  descField.textarea.addEventListener("input", () => {
    autoGrowTextarea(descField.textarea);
  });

  metaFields.appendChild(nameField.wrapper);
  metaFields.appendChild(sourceField.wrapper);
  metaCard.appendChild(metaFields);

  const descCard = document.createElement("div");
  descCard.className = "wb-card wb-description-card";
  descCard.appendChild(descField.wrapper);

  topRow.appendChild(metaCard);
  topRow.appendChild(descCard);

  // Stats (full width)
  const statsCard = document.createElement("div");
  statsCard.className = "wb-card wb-stats-card";

  const statsRow = document.createElement("div");
  statsRow.className = "wb-stats-row";

  const statTss = createStatChip("TSS");
  const statIf = createStatChip("IF");
  const statKj = createStatChip("kJ");
  const statDuration = createStatChip("Duration");
  const statFtp = createStatChip("FTP");
  const statZone = createStatChip("Zone");

  [
    statTss.el,
    statIf.el,
    statKj.el,
    statDuration.el,
    statFtp.el,
    statZone.el,
  ].forEach((el) => statsRow.appendChild(el));

  statsCard.appendChild(statsRow);

  const toolbarCard = document.createElement("div");
  toolbarCard.className = "wb-card wb-toolbar-card";

  const toolbar = document.createElement("div");
  toolbar.className = "wb-code-toolbar";

  const toolbarButtons = document.createElement("div");
  toolbarButtons.className = "wb-code-toolbar-buttons";

  const blockEditor = document.createElement("div");
  blockEditor.className = "wb-block-editor";
  blockEditor.style.display = "none";

  const blockEditorFields = document.createElement("div");
  blockEditorFields.className = "wb-block-editor-fields";
  blockEditor.appendChild(blockEditorFields);

  const blockEditorActions = document.createElement("div");
  blockEditorActions.className = "wb-block-editor-actions";
  const moveLeftBtn = document.createElement("button");
  moveLeftBtn.type = "button";
  moveLeftBtn.className = "wb-block-move-btn";
  moveLeftBtn.title = "Move block up";
  moveLeftBtn.appendChild(createCaretIcon("left"));
  moveLeftBtn.addEventListener("click", (e) => {
    e.preventDefault();
    moveSelectedBlock(-1);
  });
  const moveRightBtn = document.createElement("button");
  moveRightBtn.type = "button";
  moveRightBtn.className = "wb-block-move-btn";
  moveRightBtn.title = "Move block down";
  moveRightBtn.appendChild(createCaretIcon("right"));
  moveRightBtn.addEventListener("click", (e) => {
    e.preventDefault();
    moveSelectedBlock(1);
  });
  const deleteBlockBtn = document.createElement("button");
  deleteBlockBtn.type = "button";
  deleteBlockBtn.className = "wb-block-delete-btn";
  deleteBlockBtn.title = "Delete selected block";
  deleteBlockBtn.appendChild(createTrashIcon());
  deleteBlockBtn.addEventListener("click", (e) => {
    e.preventDefault();
    deleteSelectedBlock();
  });
  blockEditorActions.appendChild(moveLeftBtn);
  blockEditorActions.appendChild(moveRightBtn);
  blockEditorActions.appendChild(deleteBlockBtn);
  blockEditor.appendChild(blockEditorActions);

  const buttonSpecs = [
    {
      key: "steady",
      label: "SteadyState",
      snippet: '<SteadyState Duration="300" Power="0.75" />',
      icon: "steady",
    },
    {
      key: "warmup",
      label: "Warmup",
      snippet:
        '<Warmup Duration="600" PowerLow="0.50" PowerHigh="0.75" />',
      icon: "rampUp",
    },
    {
      key: "cooldown",
      label: "Cooldown",
      snippet:
        '<Cooldown Duration="600" PowerLow="0.75" PowerHigh="0.50" />',
      icon: "rampDown",
    },
    {
      key: "intervals",
      label: "IntervalsT",
      snippet:
        '<IntervalsT Repeat="3" OnDuration="300" OffDuration="180" OnPower="0.90" OffPower="0.50" />',
      icon: "intervals",
    },
  ];

  buttonSpecs.forEach((spec) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wb-code-insert-btn";
    btn.dataset.key = spec.key;

    if (spec.icon) {
      const iconEl = createWorkoutElementIcon(spec.icon);
      btn.appendChild(iconEl);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = spec.label;
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
      insertSnippetAtCursor(codeTextarea, spec.snippet);
      handleAnyChange();
    });

    toolbarButtons.appendChild(btn);
  });

  toolbar.appendChild(toolbarButtons);
  toolbar.appendChild(blockEditor);
  toolbarCard.appendChild(toolbar);

  // Chart
  const chartCard = document.createElement("div");
  chartCard.className = "wb-card wb-chart-card";

  const chartContainer = document.createElement("div");
  chartContainer.className = "wb-chart-container";

  const chartMiniHost = document.createElement("div");
  chartMiniHost.className = "wb-chart-mini-host";

  chartContainer.appendChild(chartMiniHost);
  chartCard.appendChild(chartContainer);

  const codeCard = document.createElement("div");
  codeCard.className = "wb-card wb-code-card";

  const textareaWrapper = document.createElement("div");
  textareaWrapper.className = "wb-code-textarea-wrapper";

  const codeWrapper = document.createElement("div");
  codeWrapper.className = "wb-code-wrapper";

  const codeHighlights = document.createElement("div");
  codeHighlights.className = "wb-code-highlights";

  const codeTextarea = document.createElement("textarea");
  codeTextarea.className = "wb-code-textarea";
  codeTextarea.spellcheck = false;
  codeTextarea.rows = 18;
  codeTextarea.placeholder =
    "Click the above buttons to add workout blocks.";
  codeTextarea.addEventListener("input", () =>
    autoGrowTextarea(codeTextarea),
  );
  codeTextarea.addEventListener("scroll", () => {
    codeHighlights.scrollTop = codeTextarea.scrollTop;
    codeHighlights.scrollLeft = codeTextarea.scrollLeft;
  });

  codeWrapper.appendChild(codeHighlights);
  codeWrapper.appendChild(codeTextarea);
  textareaWrapper.appendChild(codeWrapper);

  codeCard.appendChild(textareaWrapper);

  body.appendChild(topRow);
  body.appendChild(statsCard);
  body.appendChild(chartCard);
  body.appendChild(toolbarCard);
  body.appendChild(codeCard);
  wrapper.appendChild(body);
  rootEl.appendChild(wrapper);

  setStatusMessage("Not checked yet.", "neutral");

  // ---------- Events ----------

  codeTextarea.addEventListener("input", () => {
    handleAnyChange();
  });
  codeTextarea.addEventListener("click", () => {
    updateErrorMessageForCaret();
    // Typing directly into the ZWO textarea should drop any active selection
    deselectBlock();
  });
  codeTextarea.addEventListener("keyup", () => {
    updateErrorMessageForCaret();
  });
  codeTextarea.addEventListener("focus", () => {
    deselectBlock();
  });

  [nameField.input, sourceField.input, descField.textarea].forEach((el) => {
    el.addEventListener("input", () => {
      handleAnyChange({skipParse: true});
    });
  });

  // ---------- Init: restore from storage or default ----------

  (async () => {
    try {
      if (typeof loadWorkoutBuilderState === "function") {
        const saved = await loadWorkoutBuilderState();
        if (
          saved &&
          typeof saved === "object" &&
          saved._shouldRestore !== false &&
          Array.isArray(saved.rawSegments)
        ) {
          persistedState = saved;
          hydrateFromState(saved, {skipPersist: true});
        }
      }
    } catch (e) {
      console.warn("[WorkoutBuilder] Failed to load saved state:", e);
    }
    if (!codeTextarea.value.trim()) {
      clearState({persist: true});
    } else {
      refreshLayout({skipPersist: true});
    }
  })();

  // ---------- Public API ----------

  function refreshLayout(opts = {}) {
    handleAnyChange(opts);
    autoGrowTextarea(descField.textarea);
    autoGrowTextarea(codeTextarea);
  }

  // Re-render chart when OS theme changes so SVG colors follow CSS vars
  const themePref = document.documentElement?.dataset?.theme || "auto";
  if (window.matchMedia && themePref === "auto") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = () => {
      refreshLayout({skipParse: true, skipPersist: true});
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", onThemeChange);
    }
  }

  function getState() {
    const title =
      (nameField.input.value || "Custom workout").trim() || "Custom workout";
    const source =
      (sourceField.input.value || "VeloDrive Builder").trim() ||
      "VeloDrive Builder";
    const description = descField.textarea.value || "";
    const sourceURL = (urlInput.value || "").trim();

    /** @type {import("./zwo.js").CanonicalWorkout} */
    const canonical = {
      source,
      sourceURL,
      workoutTitle: title,
      rawSegments: currentRawSegments.slice(),
      description,
    };

    return canonical;
  }

  function clearState(options = {}) {
    const {persist = true} = options;

    nameField.input.value = "";
    sourceField.input.value = "";
    descField.textarea.value = "";
    codeTextarea.value = "";
    urlInput.value = "";

    setDefaultSnippet();
    if (!persist) {
      persistedState = null;
      refreshLayout({skipPersist: true});
    } else {
      refreshLayout();
    }
  }

  /**
   * Load a canonical workout into the builder.
   * @param {import("./zwo.js").CanonicalWorkout} canonical
   */
  function loadCanonicalWorkout(canonical) {
    if (
      !canonical ||
      typeof canonical !== "object" ||
      !Array.isArray(canonical.rawSegments) ||
      !canonical.rawSegments.length
    ) {
      return;
    }

    hydrateFromState(canonical);
  }

  function validateForSave() {
    handleAnyChange();

    const name = (nameField.input.value || "").trim();
    const source = (sourceField.input.value || "").trim();
    const desc = (descField.textarea.value || "").trim();
    const snippet = (codeTextarea.value || "").trim();

    nameField.input.classList.remove("wb-input-error");
    sourceField.input.classList.remove("wb-input-error");
    descField.textarea.classList.remove("wb-input-error");
    codeTextarea.classList.remove("wb-input-error");

    /** @type {{field: string, message: string}[]} */
    const errors = [];

    if (!name) errors.push({field: "name", message: "Name is required."});
    if (!source) {
      errors.push({
        field: "source",
        message: "Author / Source is required.",
      });
    }
    if (!desc) {
      errors.push({
        field: "description",
        message: "Description is required.",
      });
    }
    if (!snippet) {
      errors.push({
        field: "code",
        message: "Workout code is empty.",
      });
    }

    if (currentErrors && currentErrors.length) {
      const firstSyntax = currentErrors[0];
      errors.push({
        field: "code",
        message:
          firstSyntax.message || "Fix syntax errors before saving.",
      });
    }

    const hasErrors = errors.length > 0;

    for (const err of errors) {
      switch (err.field) {
        case "name":
          nameField.input.classList.add("wb-input-error");
          break;
        case "source":
          sourceField.input.classList.add("wb-input-error");
          break;
        case "description":
          descField.textarea.classList.add("wb-input-error");
          break;
        case "code":
          codeTextarea.classList.add("wb-input-error");
          break;
      }
    }

    if (hasErrors) {
      const first = errors[0];
      setStatusMessage(first.message, "error");
    } else {
      setStatusMessage("Ready to save.", "ok");
    }

    return {
      ok: !hasErrors,
      errors: errors.map((e) => e.message),
    };
  }

  function setDefaultSnippet() {
    codeTextarea.value =
      '<Warmup Duration="600" PowerLow="0.50" PowerHigh="0.75" />\n' +
      '<SteadyState Duration="1200" Power="0.85" />\n' +
      '<Cooldown Duration="600" PowerLow="0.75" PowerHigh="0.50" />';
  }

  function handleAnyChange(opts = {}) {
    const {skipParse = false, skipPersist = false} = opts;

    if (!skipParse) {
      const text = codeTextarea.value || "";
      const parsed = parseZwoSnippet(text);
      currentRawSegments = parsed.rawSegments || [];
      currentErrors = parsed.errors || [];
      currentBlocks = parsed.blocks || [];
      if (
        selectedBlockIndex != null &&
        !currentBlocks[selectedBlockIndex]
      ) {
        selectedBlockIndex = null;
      }
    }

    const ftp = getCurrentFtp() || 0;

    if (currentRawSegments.length && ftp > 0) {
      currentMetrics = computeMetricsFromSegments(currentRawSegments, ftp);
      currentZone = inferZoneFromSegments(currentRawSegments);
    } else {
      currentMetrics = {
        totalSec: 0,
        durationMin: 0,
        ifValue: null,
        tss: null,
        kj: null,
        ftp: ftp || null,
      };
      currentZone = null;
    }

    updateStats();
    renderChart();
    updateErrorStyling();
    updateErrorHighlights();
    updateBlockEditor();

    const state = getState();

    if (typeof onChange === "function") {
      onChange(state);
    }

    if (!skipPersist) {
      try {
        const toSave = {...state, _shouldRestore: true};
        persistedState = toSave;
        if (typeof saveWorkoutBuilderState === "function") {
          saveWorkoutBuilderState(toSave);
        }
      } catch (e) {
        console.warn("[WorkoutBuilder] Failed to save builder state:", e);
      }
    }
  }

  function updateStats() {
    const ftp = getCurrentFtp() || 0;

    if (!currentMetrics || currentMetrics.totalSec === 0) {
      statTss.value.textContent = "--";
      statIf.value.textContent = "--";
      statKj.value.textContent = "--";
      statDuration.value.textContent = "--";
      statFtp.value.textContent =
        ftp > 0 ? `${Math.round(ftp)} W` : "--";
      statZone.value.textContent = currentZone || "--";
      return;
    }

    statTss.value.textContent =
      currentMetrics.tss != null
        ? String(Math.round(currentMetrics.tss))
        : "--";
    statIf.value.textContent =
      currentMetrics.ifValue != null
        ? currentMetrics.ifValue.toFixed(2)
        : "--";
    statKj.value.textContent =
      currentMetrics.kj != null
        ? String(Math.round(currentMetrics.kj))
        : "--";
    statDuration.value.textContent =
      currentMetrics.durationMin != null
        ? `${Math.round(currentMetrics.durationMin)} min`
        : "--";
    statFtp.value.textContent =
      currentMetrics.ftp != null
        ? `${Math.round(currentMetrics.ftp)} W`
        : "--";
    statZone.value.textContent = currentZone || "--";
  }

  function renderChart() {
    const ftp = getCurrentFtp() || 0;

    chartMiniHost.innerHTML = "";
    try {
      if (currentBlocks && currentBlocks.length) {
        renderBuilderWorkoutGraph(chartMiniHost, currentBlocks, ftp, {
          selectedBlockIndex,
          onSelectBlock: handleBlockSelectionFromChart,
        });
      } else {
        // Fallback to raw segments if we couldn't parse blocks (should be rare)
        const canonical = getState();
        renderMiniWorkoutGraph(chartMiniHost, canonical, ftp);
      }
    } catch (e) {
      console.error("[WorkoutBuilder] Failed to render mini chart:", e);
    }
  }

  function getSelectedBlock() {
    if (
      selectedBlockIndex == null ||
      !currentBlocks ||
      !currentBlocks[selectedBlockIndex]
    ) {
      return null;
    }
    return currentBlocks[selectedBlockIndex];
  }

  function setSelectedBlock(idx) {
    const next =
      idx == null ||
        !Number.isFinite(idx) ||
        idx < 0 ||
        !currentBlocks ||
        idx >= currentBlocks.length
        ? null
        : idx;

    if (next === selectedBlockIndex) return;
    selectedBlockIndex = next;
    updateBlockEditor();
    updateErrorHighlights();
    renderChart();
  }

  function deselectBlock() {
    if (selectedBlockIndex == null) return;
    selectedBlockIndex = null;
    updateBlockEditor();
    updateErrorHighlights();
    renderChart();
  }

  function toggleBlockSelection(idx) {
    if (selectedBlockIndex === idx) {
      deselectBlock();
    } else {
      setSelectedBlock(idx);
    }
  }

  function handleBlockSelectionFromChart(idx) {
    if (idx == null) {
      deselectBlock();
      return;
    }
    toggleBlockSelection(idx);
  }

  function updateErrorStyling() {
    const text = codeTextarea.value || "";

    if (!text.trim()) {
      codeTextarea.classList.remove("wb-has-error");
      setStatusMessage("Empty workout. Add elements to begin.", "neutral");
      return;
    }

    if (!currentErrors.length) {
      codeTextarea.classList.remove("wb-has-error");
      setStatusMessage("No errors detected.", "ok");
      return;
    }

    codeTextarea.classList.add("wb-has-error");
    const first = currentErrors[0];
    setStatusMessage(first.message, "error");
    updateErrorMessageForCaret();
  }

  function updateErrorMessageForCaret() {
    if (!currentErrors.length) return;
    const pos = codeTextarea.selectionStart || 0;
    const overlapping = currentErrors.find(
      (err) => pos >= err.start && pos <= err.end,
    );
    if (overlapping) {
      setStatusMessage(overlapping.message, "error");
    }
  }

  async function clearPersistedState() {
    persistedState = null;
    try {
      if (typeof clearWorkoutBuilderState === "function") {
        await clearWorkoutBuilderState();
      }
    } catch (err) {
      console.warn("[WorkoutBuilder] Failed to clear saved builder state:", err);
    }
  }

  function hydrateFromState(state, opts = {}) {
    const {skipPersist = false} = opts;

    if (!state || !Array.isArray(state.rawSegments)) return;

    nameField.input.value = state.workoutTitle || "";
    sourceField.input.value = state.source || "";
    descField.textarea.value = state.description || "";
    codeTextarea.value = segmentsToZwoSnippet(state.rawSegments);
    urlInput.value = state.sourceURL || "";

    if (skipPersist) {
      refreshLayout({skipPersist: true});
    } else {
      refreshLayout();
    }
  }

  async function restorePersistedStateOrDefault() {
    if (
      persistedState &&
      Array.isArray(persistedState.rawSegments) &&
      persistedState.rawSegments.length
    ) {
      hydrateFromState(persistedState, {skipPersist: true});
      return true;
    }

    clearState({persist: true});
    return false;
  }

  // ---------- Small DOM helpers ----------

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"]/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        default:
          return c;
      }
    });
  }

  function updateErrorHighlights() {
    if (!codeHighlights) return;

    const text = codeTextarea.value || "";
    const lines = text.split("\n");
    const lineCount = lines.length;

    const errorLines = new Set();
    if (currentErrors.length) {
      const lineOffsets = [];
      let offset = 0;
      for (let i = 0; i < lineCount; i += 1) {
        lineOffsets.push(offset);
        offset += lines[i].length + 1;
      }

      function indexToLine(idx) {
        if (!Number.isFinite(idx)) return 0;
        if (idx <= 0) return 0;
        if (idx >= text.length) return lineCount - 1;

        for (let i = 0; i < lineOffsets.length; i += 1) {
          const start = lineOffsets[i];
          const nextStart =
            i + 1 < lineOffsets.length
              ? lineOffsets[i + 1]
              : Infinity;
          if (idx >= start && idx < nextStart) {
            return i;
          }
        }
        return lineCount - 1;
      }

      for (const err of currentErrors) {
        let start = Number.isFinite(err.start) ? err.start : 0;
        let end = Number.isFinite(err.end) ? err.end : start;

        start = Math.max(0, Math.min(start, text.length));
        end = Math.max(start, Math.min(end, text.length));

        const startLine = indexToLine(start);
        const endLine = indexToLine(end);

        const s = Math.max(0, Math.min(startLine, lineCount - 1));
        const e = Math.max(s, Math.min(endLine, lineCount - 1));

        for (let i = s; i <= e; i += 1) {
          errorLines.add(i);
        }
      }
    }

    const selectedLines = new Set();
    const selected = getSelectedBlock();
    if (selected) {
      const startLine = Number.isFinite(selected.lineStart)
        ? selected.lineStart
        : 0;
      const endLine = Number.isFinite(selected.lineEnd)
        ? selected.lineEnd
        : startLine;
      const s = Math.max(0, Math.min(startLine, lineCount - 1));
      const e = Math.max(s, Math.min(endLine, lineCount - 1));
      for (let i = s; i <= e; i += 1) {
        selectedLines.add(i);
      }
    }

    const html = lines
      .map((line, idx) => {
        const safe = escapeHtml(line) || " ";
        const classes = [];
        if (errorLines.has(idx)) classes.push("wb-highlight-line");
        if (selectedLines.has(idx)) classes.push("wb-selected-line");
        const classAttr = classes.length
          ? ` class="${classes.join(" ")}"`
          : "";
        return `<div${classAttr}>${safe}</div>`;
      })
      .join("");

    codeHighlights.innerHTML = html;
  }

  function updateBlockEditor() {
    if (!blockEditor || !toolbarButtons) return;

    const block = getSelectedBlock();
    if (!block) {
      toolbarButtons.style.display = "";
      blockEditor.style.display = "none";
      blockEditorFields.innerHTML = "";
      blockEditorActions.style.display = "none";
      return;
    }

    toolbarButtons.style.display = "none";
    blockEditor.style.display = "flex";
    blockEditorFields.innerHTML = "";
    blockEditorActions.style.display = "flex";

    const configs = buildBlockFieldConfigs(block);
    configs.forEach((cfg) => {
      const field = createStepperField(cfg, (val) => {
        if (typeof cfg.onCommit === "function") {
          cfg.onCommit(val);
        }
      });
      blockEditorFields.appendChild(field.wrapper);
    });
  }

  function buildBlockFieldConfigs(block) {
    const idx = selectedBlockIndex;
    const list = [];
    const durationSec = Math.round(getBlockDurationSec(block));

    const commitDuration = (val) =>
      applyBlockAttrUpdate(idx, {durationSec: clampDuration(val)});

    if (block.kind === "steady") {
      const powerPct = Math.round(getBlockSteadyPower(block) * 100);
      list.push({
        key: "durationSec",
        label: "Duration",
        tooltip: "Length of this steady block (seconds).",
        value: durationSec,
        unit: "s",
        step: 60,
        onCommit: commitDuration,
      });
      list.push({
        key: "powerRel",
        label: "Power",
        tooltip: "Target power as % of FTP.",
        value: powerPct,
        unit: "%",
        kind: "power",
        step: 5,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            powerRel: clampPowerPercent(val) / 100,
          }),
      });
    } else if (block.kind === "warmup" || block.kind === "cooldown") {
      const lowPct = Math.round(getRampLow(block) * 100);
      const highPct = Math.round(getRampHigh(block) * 100);
      list.push({
        key: "durationSec",
        label: "Duration",
        tooltip: "Length of this ramp block (seconds).",
        value: durationSec,
        unit: "s",
        step: 60,
        onCommit: commitDuration,
      });
      list.push({
        key: "powerLowRel",
        label: "Power Low",
        tooltip: "Starting power as % of FTP.",
        value: lowPct,
        unit: "%",
        kind: "power",
        step: 5,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            powerLowRel: clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "powerHighRel",
        label: "Power High",
        tooltip: "Ending power as % of FTP.",
        value: highPct,
        unit: "%",
        kind: "power",
        step: 5,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            powerHighRel: clampPowerPercent(val) / 100,
          }),
      });
    } else if (block.kind === "intervals") {
      const intervals = getIntervalParts(block);
      list.push({
        key: "repeat",
        label: "Reps",
        tooltip: "Number of on/off pairs.",
        value: Math.max(1, Math.round(intervals.repeat)),
        unit: "",
        kind: "repeat",
        step: 1,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {repeat: clampRepeat(val)}),
      });
      list.push({
        key: "onDurationSec",
        label: "On",
        tooltip: "Work interval length (seconds).",
        value: Math.round(intervals.onDurationSec),
        unit: "s",
        step: 60,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            onDurationSec: clampDuration(val),
          }),
      });
      list.push({
        key: "onPowerRel",
        label: "Power",
        tooltip: "Work interval power (% FTP).",
        value: Math.round(intervals.onPowerRel * 100),
        unit: "%",
        kind: "power",
        step: 5,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            onPowerRel: clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "offDurationSec",
        label: "Off",
        tooltip: "Recovery interval length (seconds).",
        value: Math.round(intervals.offDurationSec),
        unit: "s",
        step: 60,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            offDurationSec: clampDuration(val),
          }),
      });
      list.push({
        key: "offPowerRel",
        label: "Power",
        tooltip: "Recovery interval power (% FTP).",
        value: Math.round(intervals.offPowerRel * 100),
        unit: "%",
        kind: "power",
        step: 5,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            offPowerRel: clampPowerPercent(val) / 100,
          }),
      });
    }

    return list;
  }

  function createStepperField(config, onCommit) {
    const wrapper = document.createElement("div");
    wrapper.className = "wb-block-field";

    const label = document.createElement("label");
    label.className = "wb-block-field-label";
    label.textContent = config.label || "";
    if (config.tooltip) label.title = config.tooltip;
    wrapper.appendChild(label);

    const group = document.createElement("div");
    group.className = "control-group wb-block-stepper";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "control-btn";
    minus.textContent = "-";

    const valueWrapper = document.createElement("div");
    valueWrapper.className = "control-value";

    const input = document.createElement("input");
    input.type = "number";
    input.className = "settings-ftp-input wb-block-stepper-input";
    input.value = Number.isFinite(config.value) ? String(config.value) : "0";
    input.inputMode = "numeric";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "control-btn";
    plus.textContent = "+";

    const commitValue = (raw) => {
      const n = Number(raw);
      const base = Number.isFinite(n) ? n : Number(config.value) || 0;
      if (typeof onCommit === "function") {
        onCommit(base);
      }
    };

    minus.addEventListener("click", (e) => {
      e.preventDefault();
      const current = Number(input.value);
      const step = Number(config.step) || 1;
      const next = Number.isFinite(current) ? current - step : step * -1;
      input.value = String(next);
      commitValue(next);
    });

    plus.addEventListener("click", (e) => {
      e.preventDefault();
      const current = Number(input.value);
      const step = Number(config.step) || 1;
      const next = Number.isFinite(current) ? current + step : step;
      input.value = String(next);
      commitValue(next);
    });

    input.addEventListener("change", () => commitValue(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitValue(input.value);
      }
    });

    group.appendChild(minus);
    valueWrapper.appendChild(input);
    if (config.unit) {
      const unit = document.createElement("span");
      unit.className = "settings-ftp-unit wb-block-unit";
      unit.textContent = config.unit || "";
      valueWrapper.appendChild(unit);
    }
    group.appendChild(valueWrapper);
    group.appendChild(plus);

    if (config.kind) {
      wrapper.dataset.kind = config.kind;
    }
    wrapper.appendChild(group);
    return {wrapper, input};
  }

  function applyBlockAttrUpdate(blockIndex, attrs) {
    if (
      blockIndex == null ||
      !currentBlocks ||
      !currentBlocks[blockIndex]
    ) {
      return;
    }

    const updatedBlocks = currentBlocks.map((block, idx) => {
      if (idx !== blockIndex) return block;
      return {
        ...block,
        attrs: {...(block.attrs || {}), ...attrs},
      };
    });

    const newSnippet = blocksToSnippet(updatedBlocks);
    setCodeValueAndRefresh(newSnippet, null);
    setSelectedBlock(blockIndex < currentBlocks.length ? blockIndex : null);
  }

  function deleteSelectedBlock() {
    if (
      selectedBlockIndex == null ||
      !currentBlocks ||
      !currentBlocks[selectedBlockIndex]
    ) {
      return;
    }

    const updatedBlocks = currentBlocks.filter(
      (_block, idx) => idx !== selectedBlockIndex,
    );

    const newSnippet = blocksToSnippet(updatedBlocks);
    selectedBlockIndex = null;
    setCodeValueAndRefresh(newSnippet, null);
  }

  function moveSelectedBlock(direction) {
    if (
      selectedBlockIndex == null ||
      !currentBlocks ||
      !currentBlocks[selectedBlockIndex]
    ) {
      return;
    }

    const idx = selectedBlockIndex;
    const target = idx + direction;
    if (target < 0 || target >= currentBlocks.length) return;

    const updated = currentBlocks.slice();
    const [moving] = updated.splice(idx, 1);
    updated.splice(target, 0, moving);

    const newSnippet = blocksToSnippet(updated);
    selectedBlockIndex = target;
    setCodeValueAndRefresh(newSnippet, null);
  }

  function blocksToSnippet(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return "";
    const lines = [];

    const formatRel = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : "0.00";
    };

    for (const block of blocks) {
      if (!block || !block.kind) continue;
      const attrs = block.attrs || {};

      if (block.kind === "steady") {
        const duration = clampDuration(attrs.durationSec);
        lines.push(
          `<SteadyState Duration="${duration}" Power="${formatRel(
            attrs.powerRel,
          )}" />`,
        );
      } else if (block.kind === "warmup" || block.kind === "cooldown") {
        const duration = clampDuration(attrs.durationSec);
        const tag = block.kind === "cooldown" ? "Cooldown" : "Warmup";
        lines.push(
          `<${tag} Duration="${duration}" PowerLow="${formatRel(
            attrs.powerLowRel,
          )}" PowerHigh="${formatRel(attrs.powerHighRel)}" />`,
        );
      } else if (block.kind === "intervals") {
        const repeat = clampRepeat(attrs.repeat);
        const onDur = clampDuration(attrs.onDurationSec);
        const offDur = clampDuration(attrs.offDurationSec);
        lines.push(
          `<IntervalsT Repeat="${repeat}" OnDuration="${onDur}" OffDuration="${offDur}" OnPower="${formatRel(
            attrs.onPowerRel,
          )}" OffPower="${formatRel(attrs.offPowerRel)}" />`,
        );
      }
    }

    return lines.join("\n");
  }

  function getBlockDurationSec(block) {
    if (!block) return 0;
    const attrVal = block.attrs?.durationSec;
    if (Number.isFinite(attrVal) && attrVal > 0) return attrVal;
    const segs = Array.isArray(block.segments) ? block.segments : [];
    return segs.reduce(
      (sum, seg) => sum + Math.max(0, Number(seg?.durationSec) || 0),
      0,
    );
  }

  function getBlockSteadyPower(block) {
    if (!block) return 0;
    const attrVal = block.attrs?.powerRel;
    if (Number.isFinite(attrVal)) return attrVal;
    const first = block.segments?.[0];
    if (first && Number.isFinite(first.pStartRel)) return first.pStartRel;
    return 0;
  }

  function getRampLow(block) {
    if (!block) return 0;
    const attrVal = block.attrs?.powerLowRel;
    if (Number.isFinite(attrVal)) return attrVal;
    const first = block.segments?.[0];
    if (first && Number.isFinite(first.pStartRel)) return first.pStartRel;
    return 0;
  }

  function getRampHigh(block) {
    if (!block) return 0;
    const attrVal = block.attrs?.powerHighRel;
    if (Number.isFinite(attrVal)) return attrVal;
    const last = block.segments?.[block.segments.length - 1];
    if (last && Number.isFinite(last.pEndRel)) return last.pEndRel;
    return getRampLow(block);
  }

  function getIntervalParts(block) {
    const attrs = block?.attrs || {};
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    const onSeg = segs[0];
    const offSeg = segs[1];
    return {
      repeat: Number.isFinite(attrs.repeat)
        ? attrs.repeat
        : Math.max(1, Math.round(segs.length / 2)),
      onDurationSec: Number.isFinite(attrs.onDurationSec)
        ? attrs.onDurationSec
        : onSeg?.durationSec || 0,
      offDurationSec: Number.isFinite(attrs.offDurationSec)
        ? attrs.offDurationSec
        : offSeg?.durationSec || 0,
      onPowerRel: Number.isFinite(attrs.onPowerRel)
        ? attrs.onPowerRel
        : onSeg?.pStartRel || 0,
      offPowerRel: Number.isFinite(attrs.offPowerRel)
        ? attrs.offPowerRel
        : offSeg?.pStartRel || 0,
    };
  }

  function clampDuration(val) {
    const n = Number(val);
    return Math.max(1, Math.round(Number.isFinite(n) ? n : 0));
  }

  function clampRepeat(val) {
    const n = Number(val);
    return Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  }

  function clampPowerPercent(val) {
    const n = Number(val);
    return Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  }

  function createWorkoutElementIcon(kind) {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.classList.add("wb-code-icon");

    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path.setAttribute("fill", "currentColor");

    switch (kind) {
      case "steady":
        path.setAttribute("d", "M4 14h16v6H4z");
        break;
      case "rampUp":
        path.setAttribute("d", "M4 20 L20 20 20 8 4 16 Z");
        break;
      case "rampDown":
        path.setAttribute("d", "M4 8 L20 16 20 20 4 20 Z");
        break;
      case "intervals":
      default:
        path.setAttribute(
          "d",
          "M4 20h4v-8H4zm6 0h4v-14h-4zm6 0h4v-10h-4z",
        );
        break;
    }

    svg.appendChild(path);
    return svg;
  }

  function createTrashIcon() {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("wb-code-icon");

    const p1 = document.createElementNS(svgNS, "path");
    p1.setAttribute("d", "M3 6h18");
    const p2 = document.createElementNS(svgNS, "path");
    p2.setAttribute("d", "M8 6V4h8v2");
    const p3 = document.createElementNS(svgNS, "path");
    p3.setAttribute("d", "M6 6l1 14h10l1-14");
    const p4 = document.createElementNS(svgNS, "path");
    p4.setAttribute("d", "M10 11v6");
    const p5 = document.createElementNS(svgNS, "path");
    p5.setAttribute("d", "M14 11v6");

    [p1, p2, p3, p4, p5].forEach((p) => svg.appendChild(p));
    return svg;
  }

  function createCaretIcon(direction) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("wb-code-icon");

    const path = document.createElementNS(svgNS, "path");
    if (direction === "left") {
      path.setAttribute("d", "M14 6l-6 6 6 6");
    } else {
      path.setAttribute("d", "M10 6l6 6-6 6");
    }
    svg.appendChild(path);
    return svg;
  }

  function autoGrowTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function createLabeledInput(labelText) {
    const wrapper = document.createElement("div");
    wrapper.className = "wb-field";

    const label = document.createElement("label");
    label.className = "wb-field-label";
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "wb-field-input";

    wrapper.appendChild(label);
    wrapper.appendChild(input);

    return {wrapper, input};
  }

  function createLabeledTextarea(labelText) {
    const wrapper = document.createElement("div");
    wrapper.className = "wb-field";

    const label = document.createElement("label");
    label.className = "wb-field-label";
    label.textContent = labelText;

    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.className = "wb-field-textarea";

    wrapper.appendChild(label);
    wrapper.appendChild(textarea);

    return {wrapper, textarea};
  }

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
    return {el, value: valueEl};
  }

  function insertSnippetAtCursor(textarea, snippet) {
    const value = textarea.value || "";
    const startSel = textarea.selectionStart || 0;
    const endSel = textarea.selectionEnd || startSel;

    let insertPos = endSel;
    const after = value.slice(endSel);
    const newlineIdx = after.indexOf("\n");
    const scanSegment =
      newlineIdx === -1 ? after : after.slice(0, newlineIdx);
    const nextGt = scanSegment.indexOf(">");
    if (nextGt !== -1) {
      insertPos = endSel + nextGt + 1;
    }

    const beforeText = value.slice(0, insertPos);
    const afterText = value.slice(insertPos);

    const prefix = beforeText && !beforeText.endsWith("\n") ? "\n" : "";
    const suffix = afterText && !afterText.startsWith("\n") ? "\n" : "";

    const newValue = beforeText + prefix + snippet + suffix + afterText;
    const caretPos = (beforeText + prefix + snippet).length;
    setCodeValueAndRefresh(newValue, caretPos);
  }

  function setCodeValueAndRefresh(newValue, caretPos) {
    if (!codeTextarea) return;
    const el = codeTextarea;
    const next = newValue || "";
    const caret = Number.isFinite(caretPos)
      ? Math.max(0, Math.min(caretPos, next.length))
      : null;
    el.value = next;
    if (caret != null) {
      el.setSelectionRange(caret, caret);
    }
    autoGrowTextarea(el);
    handleAnyChange({skipPersist: false});
  }

  return {
    getState,
    clearState,
    refreshLayout,
    validateForSave,
    loadCanonicalWorkout,
    restorePersistedStateOrDefault,
    clearPersistedState,
  };
}
