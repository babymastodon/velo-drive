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
  let caretBlockIndex = null;
  let dragInsertAfterIndex = null;
  let insertAfterOverrideIndex = null;
  let dragState = null;
  const DRAG_THRESHOLD_PX = 4;
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
      key: "recovery",
      label: "Recovery",
      snippet: '<SteadyState Duration="300" Power="0.55" />',
      icon: "steady",
      zoneClass: "wb-zone-recovery",
    },
    {
      key: "endurance",
      label: "Endurance",
      snippet: '<SteadyState Duration="300" Power="0.70" />',
      icon: "steady",
      zoneClass: "wb-zone-endurance",
    },
    {
      key: "tempo",
      label: "Tempo",
      snippet: '<SteadyState Duration="300" Power="0.85" />',
      icon: "steady",
      zoneClass: "wb-zone-tempo",
    },
    {
      key: "threshold",
      label: "Threshold",
      snippet: '<SteadyState Duration="300" Power="0.95" />',
      icon: "steady",
      zoneClass: "wb-zone-threshold",
    },
    {
      key: "vo2max",
      label: "VO2Max",
      snippet: '<SteadyState Duration="300" Power="1.10" />',
      icon: "steady",
      zoneClass: "wb-zone-vo2",
    },
    {
      key: "anaerobic",
      label: "Anaerobic",
      snippet: '<SteadyState Duration="300" Power="1.25" />',
      icon: "steady",
      zoneClass: "wb-zone-anaerobic",
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
  const buttonSpecByKey = new Map(
    buttonSpecs.map((spec) => [spec.key, spec]),
  );

  buttonSpecs.forEach((spec) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wb-code-insert-btn";
    btn.dataset.key = spec.key;
    if (spec.zoneClass) btn.classList.add(spec.zoneClass);

    if (spec.icon) {
      const iconEl = createWorkoutElementIcon(spec.icon);
      btn.appendChild(iconEl);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = spec.label;
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
      insertSnippetAtInsertionPoint(codeTextarea, spec);
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
    updateCaretBlockIndex();
  });
  codeTextarea.addEventListener("keyup", () => {
    updateErrorMessageForCaret();
    updateCaretBlockIndex();
  });
  codeTextarea.addEventListener("focus", () => {
    deselectBlock();
    // caret update handled on mouseup/keyup
  });
  codeTextarea.addEventListener("mouseup", () => {
    updateCaretBlockIndex();
  });

  [nameField.input, sourceField.input, descField.textarea].forEach((el) => {
    el.addEventListener("input", () => {
      handleAnyChange({skipParse: true});
    });
  });

  const handleBuilderShortcuts = (e) => {
    if (e.defaultPrevented) return;
    if (!rootEl || rootEl.getClientRects().length === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (
      target &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }

    const key = e.key;
    const lower = key.toLowerCase();
    const hasSelection =
      selectedBlockIndex != null &&
      currentBlocks &&
      currentBlocks[selectedBlockIndex];
    const block = hasSelection ? currentBlocks[selectedBlockIndex] : null;

    const insertByKey = (specKey) => {
      const spec = buttonSpecByKey.get(specKey);
      if (!spec) return false;
      const insertAfter =
        insertAfterOverrideIndex != null
          ? insertAfterOverrideIndex
          : getInsertAfterIndex();
      const targetIndex =
        insertAfter != null
          ? insertAfter + 1
          : currentBlocks
            ? currentBlocks.length
            : 0;
      insertSnippetAtInsertionPoint(codeTextarea, spec);
      handleAnyChange();
      if (currentBlocks && currentBlocks.length) {
        const nextIdx = Math.min(
          Math.max(0, targetIndex),
          currentBlocks.length - 1,
        );
        setSelectedBlock(nextIdx);
      }
      return true;
    };

    if (lower === "r") {
      if (insertByKey("recovery")) e.preventDefault();
      return;
    }
    if (lower === "e") {
      if (insertByKey("endurance")) e.preventDefault();
      return;
    }
    if (lower === "t") {
      if (insertByKey("tempo")) e.preventDefault();
      return;
    }
    if (lower === "s") {
      if (insertByKey("threshold")) e.preventDefault();
      return;
    }
    if (lower === "v") {
      if (insertByKey("vo2max")) e.preventDefault();
      return;
    }
    if (lower === "a") {
      if (insertByKey("anaerobic")) e.preventDefault();
      return;
    }
    if (lower === "w") {
      if (insertByKey("warmup")) e.preventDefault();
      return;
    }
    if (lower === "c") {
      if (insertByKey("cooldown")) e.preventDefault();
      return;
    }
    if (lower === "i") {
      if (insertByKey("intervals")) e.preventDefault();
      return;
    }

    if (lower === "d" || key === "Delete" || key === "Backspace") {
      if (hasSelection) {
        e.preventDefault();
        deleteSelectedBlock();
        return;
      }
      if (currentBlocks && currentBlocks.length) {
        const current =
          insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
        if (key === "Backspace") {
          const prev = current != null ? current : -1;
          if (prev >= 0) {
            e.preventDefault();
            setSelectedBlock(prev);
            deleteSelectedBlock();
          }
        } else if (key === "Delete") {
          const next = current != null ? current + 1 : 0;
          if (next >= 0 && next < currentBlocks.length) {
            e.preventDefault();
            setSelectedBlock(next);
            deleteSelectedBlock();
          }
        }
      }
      return;
    }

    if (key === "Escape" || key === "Enter") {
      if (hasSelection) {
        e.preventDefault();
        e.stopPropagation();
        deselectBlock();
        return;
      }
      if (key === "Enter" && currentBlocks && currentBlocks.length) {
        e.preventDefault();
        e.stopPropagation();
        const current =
          insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
        const prev =
          current != null
            ? Math.min(current, currentBlocks.length - 1)
            : null;
        if (prev != null && prev >= 0) {
          setSelectedBlock(prev);
        } else {
          setSelectedBlock(0);
        }
      }
      return;
    }

    const isInsertionAtEndOfSelection = () => {
      const insertAfter =
        insertAfterOverrideIndex != null
          ? insertAfterOverrideIndex
          : getInsertAfterIndex();
      return insertAfter === selectedBlockIndex;
    };

    if (key === " " || e.code === "Space") {
      if (hasSelection && block) {
        e.preventDefault();
        e.stopPropagation();
        const atEnd = isInsertionAtEndOfSelection();
        insertAfterOverrideIndex = atEnd
          ? selectedBlockIndex - 1
          : selectedBlockIndex;
        renderChart();
      }
      return;
    }

    const powerStepRel = 0.05;
    const stepScale = e.shiftKey ? 5 : 1;
    const scaledPowerStep = powerStepRel * stepScale;

    if (!hasSelection) {
      if (!currentBlocks || !currentBlocks.length) return;
      if (lower === "h" || key === "ArrowLeft") {
        e.preventDefault();
        const current =
          insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
        const next = Math.max(
          -1,
          Math.min((current ?? -1) - 1, currentBlocks.length - 1),
        );
        insertAfterOverrideIndex = next;
        caretBlockIndex = null;
        renderChart();
      } else if (lower === "l" || key === "ArrowRight") {
        e.preventDefault();
        const current =
          insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
        const next = Math.max(
          -1,
          Math.min((current ?? -1) + 1, currentBlocks.length - 1),
        );
        insertAfterOverrideIndex = next;
        caretBlockIndex = null;
        renderChart();
      } else if (
        lower === "j" ||
        lower === "k" ||
        key === "ArrowDown" ||
        key === "ArrowUp"
      ) {
        e.preventDefault();
        const delta =
          lower === "j" || key === "ArrowDown"
            ? -scaledPowerStep
            : scaledPowerStep;
        const insertAfter =
          insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
        const prevIndex = insertAfter != null ? insertAfter : -1;
        const nextIndex = prevIndex + 1;

        const adjustBlockPower = (idx, position) => {
          const b = currentBlocks[idx];
          if (!b) return;
          if (b.kind === "steady") {
            applyBlockAttrUpdate(idx, {
              powerRel: clampRel(getBlockSteadyPower(b) + delta),
            });
          } else if (b.kind === "warmup" || b.kind === "cooldown") {
            const isStart = position === "start";
            const current = isStart ? getRampLow(b) : getRampHigh(b);
            applyBlockAttrUpdate(idx, {
              [isStart ? "powerLowRel" : "powerHighRel"]: clampRel(
                current + delta,
              ),
            });
          } else if (b.kind === "intervals") {
            const parts = getIntervalParts(b);
            const isStart = position === "start";
            applyBlockAttrUpdate(idx, {
              [isStart ? "onPowerRel" : "offPowerRel"]: clampRel(
                (isStart ? parts.onPowerRel : parts.offPowerRel) + delta,
              ),
            });
          }
        };

        if (prevIndex >= 0) adjustBlockPower(prevIndex, "end");
        if (nextIndex >= 0 && nextIndex < currentBlocks.length) {
          adjustBlockPower(nextIndex, "start");
        }
      }
      return;
    }

    const adjustDuration = (current, delta) =>
      clampDuration(current + delta);
    const durationStep = (current) => getDurationStep(current);

    const handleDurationChange = (delta) => {
      if (!block) return;
      if (block.kind === "intervals") {
        const parts = getIntervalParts(block);
        const atEnd = isInsertionAtEndOfSelection();
        const next = adjustDuration(
          atEnd ? parts.offDurationSec : parts.onDurationSec,
          delta,
        );
        applyBlockAttrUpdate(selectedBlockIndex, {
          [atEnd ? "offDurationSec" : "onDurationSec"]: next,
        });
        return;
      }
      const current = getBlockDurationSec(block);
      const next = adjustDuration(current, delta);
      applyBlockAttrUpdate(selectedBlockIndex, {durationSec: next});
    };

    const handlePowerChange = (delta) => {
      if (!block) return;
      if (block.kind === "steady") {
        const current = getBlockSteadyPower(block);
        applyBlockAttrUpdate(selectedBlockIndex, {
          powerRel: clampRel(current + delta),
        });
        return;
      }
      if (block.kind === "warmup" || block.kind === "cooldown") {
        const atEnd = isInsertionAtEndOfSelection();
        const current = atEnd ? getRampHigh(block) : getRampLow(block);
        applyBlockAttrUpdate(selectedBlockIndex, {
          [atEnd ? "powerHighRel" : "powerLowRel"]: clampRel(current + delta),
        });
        return;
      }
      if (block.kind === "intervals") {
        const parts = getIntervalParts(block);
        const atEnd = isInsertionAtEndOfSelection();
        applyBlockAttrUpdate(selectedBlockIndex, {
          [atEnd ? "offPowerRel" : "onPowerRel"]: clampRel(
            (atEnd ? parts.offPowerRel : parts.onPowerRel) + delta,
          ),
        });
      }
    };

    if (lower === "h" || key === "ArrowLeft") {
      e.preventDefault();
      const step =
        block.kind === "intervals"
          ? durationStep(getIntervalParts(block).onDurationSec)
          : durationStep(getBlockDurationSec(block));
      handleDurationChange(-step * stepScale);
      return;
    }
    if (lower === "l" || key === "ArrowRight") {
      e.preventDefault();
      const step =
        block.kind === "intervals"
          ? durationStep(getIntervalParts(block).onDurationSec)
          : durationStep(getBlockDurationSec(block));
      handleDurationChange(step * stepScale);
      return;
    }
    if (lower === "j" || key === "ArrowDown") {
      e.preventDefault();
      handlePowerChange(-scaledPowerStep);
      return;
    }
    if (lower === "k" || key === "ArrowUp") {
      e.preventDefault();
      handlePowerChange(scaledPowerStep);
      return;
    }

  };

  window.addEventListener("keydown", handleBuilderShortcuts);

  chartMiniHost.addEventListener("pointerdown", handleChartPointerDown);

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
      updateCaretBlockIndex();
      if (
        insertAfterOverrideIndex == null &&
        selectedBlockIndex == null &&
        caretBlockIndex == null &&
        currentBlocks.length
      ) {
        insertAfterOverrideIndex = currentBlocks.length - 1;
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

    const prevScrollLeft = chartContainer ? chartContainer.scrollLeft : 0;
    chartMiniHost.innerHTML = "";
    try {
      if (currentBlocks && currentBlocks.length) {
        renderBuilderWorkoutGraph(chartMiniHost, currentBlocks, ftp, {
          selectedBlockIndex,
          insertAfterBlockIndex:
            dragInsertAfterIndex != null
              ? dragInsertAfterIndex
              : insertAfterOverrideIndex != null
                ? insertAfterOverrideIndex
              : getInsertAfterIndex(),
          onSelectBlock: handleBlockSelectionFromChart,
          onSetInsertAfter: handleInsertAfterFromChart,
          onSetInsertAfterFromSegment: handleInsertAfterFromSegment,
        });
      } else {
        // Fallback to raw segments if we couldn't parse blocks (should be rare)
        const canonical = getState();
        renderMiniWorkoutGraph(chartMiniHost, canonical, ftp);
      }
    } catch (e) {
      console.error("[WorkoutBuilder] Failed to render mini chart:", e);
    }
    if (chartContainer) {
      chartContainer.scrollLeft = prevScrollLeft;
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
    caretBlockIndex = null;
    insertAfterOverrideIndex = null;
    updateBlockEditor();
    updateErrorHighlights();
    renderChart();
  }

  function deselectBlock() {
    if (selectedBlockIndex == null) return;
    caretBlockIndex = selectedBlockIndex;
    selectedBlockIndex = null;
    insertAfterOverrideIndex = null;
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

  function setInsertAfterIndex(idx) {
    const next =
      idx == null ||
      !Number.isFinite(idx) ||
      idx < 0 ||
      !currentBlocks ||
      idx >= currentBlocks.length
        ? null
        : idx;

    selectedBlockIndex = null;
    if (caretBlockIndex === next) {
      insertAfterOverrideIndex = null;
      renderChart();
      return;
    }
    caretBlockIndex = next;
    insertAfterOverrideIndex = null;
    updateBlockEditor();
    updateErrorHighlights();
    renderChart();
  }

  function handleBlockSelectionFromChart(idx) {
    if (idx == null) {
      deselectBlock();
      return;
    }
    toggleBlockSelection(idx);
  }

  function handleInsertAfterFromChart(idx) {
    setInsertAfterIndex(idx);
  }

  function handleInsertAfterFromSegment(idx) {
    insertAfterOverrideIndex = idx;
    renderChart();
  }

  function buildBlockTimings(blocks) {
    const timings = [];
    let totalSec = 0;
    (blocks || []).forEach((block, idx) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      const start = totalSec;
      segs.forEach((seg) => {
        const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
        totalSec += durSec;
      });
      timings.push({index: idx, tStart: start, tEnd: totalSec});
    });
    return {timings, totalSec};
  }

  function buildSegmentTimings(blocks) {
    const timings = [];
    let totalSec = 0;
    (blocks || []).forEach((block, blockIndex) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      segs.forEach((seg, segIndex) => {
        const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
        const start = totalSec;
        const end = totalSec + durSec;
        timings.push({blockIndex, segIndex, tStart: start, tEnd: end});
        totalSec = end;
      });
    });
    return {timings, totalSec};
  }

  function computeInsertIndexFromPoint(blockIndex, segIndex, clientX) {
    if (!currentBlocks || !currentBlocks.length) return null;
    const svg = chartMiniHost ? chartMiniHost.querySelector("svg") : null;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 1;
    const clampedX = Math.max(0, Math.min(width, clientX - rect.left));
    const {totalSec} = buildBlockTimings(currentBlocks);
    const timelineSec = Math.max(3600, totalSec || 0);
    const timeSec = (clampedX / width) * timelineSec;

    const {timings: blockTimings} = buildBlockTimings(currentBlocks);
    const blockTiming = blockTimings.find((t) => t.index === blockIndex);
    const block = currentBlocks[blockIndex];

    if (block && block.kind === "intervals" && blockTiming) {
      const mid = (blockTiming.tStart + blockTiming.tEnd) / 2;
      return timeSec < mid ? blockIndex - 1 : blockIndex;
    }

    const {timings: segmentTimings} = buildSegmentTimings(currentBlocks);
    const seg = segmentTimings.find(
      (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
    );
    if (seg) {
      const mid = (seg.tStart + seg.tEnd) / 2;
      return timeSec < mid ? blockIndex - 1 : blockIndex;
    }

    return blockIndex;
  }

  function snapPowerRel(rel) {
    const snapped = Math.round(rel * 20) / 20;
    return Math.max(0.05, snapped);
  }

  function clampRel(val) {
    return Math.max(0.05, Number.isFinite(val) ? val : 0);
  }

  function snapDurationSec(sec) {
    const step = getDurationStep(sec);
    const snapped = Math.round(sec / step) * step;
    return Math.max(step, snapped);
  }

  function getDurationStep(sec) {
    if (sec < 60) return 10;
    if (sec < 180) return 30;
    return 60;
  }

  function reorderBlocks(fromIndex, insertAfterIndex) {
    if (
      fromIndex == null ||
      insertAfterIndex == null ||
      !currentBlocks ||
      !currentBlocks[fromIndex]
    ) {
      return;
    }

    let target = insertAfterIndex;
    if (target >= fromIndex) target -= 1;
    if (target < -1) target = -1;
    if (target + 1 === fromIndex) {
      dragInsertAfterIndex = null;
      renderChart();
      return;
    }

    const updated = currentBlocks.slice();
    const [moving] = updated.splice(fromIndex, 1);
    updated.splice(target + 1, 0, moving);

    const newSnippet = blocksToSnippet(updated);
    selectedBlockIndex = null;
    dragInsertAfterIndex = null;
    setCodeValueAndRefresh(newSnippet, null);
    setSelectedBlock(target + 1);
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
        kind: "duration",
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
        kind: "duration",
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
        kind: "duration",
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
        kind: "duration",
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
      const step =
        config.kind === "duration"
          ? getDurationStep(Number.isFinite(current) ? current : 0)
          : Number(config.step) || 1;
      const next = Number.isFinite(current) ? current - step : step * -1;
      input.value = String(next);
      commitValue(next);
    });

    plus.addEventListener("click", (e) => {
      e.preventDefault();
      const current = Number(input.value);
      const step =
        config.kind === "duration"
          ? getDurationStep(Number.isFinite(current) ? current : 0)
          : Number(config.step) || 1;
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

    const deleteIndex = selectedBlockIndex;
    const updatedBlocks = currentBlocks.filter(
      (_block, idx) => idx !== deleteIndex,
    );

    const newSnippet = blocksToSnippet(updatedBlocks);
    selectedBlockIndex = null;
    setCodeValueAndRefresh(newSnippet, null);

    if (!updatedBlocks.length) {
      return;
    }

    const nextIndex =
      deleteIndex > 0
        ? Math.min(deleteIndex - 1, updatedBlocks.length - 1)
        : 0;
    setSelectedBlock(nextIndex);
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

  function updateCaretBlockIndex() {
    if (!codeTextarea || !currentBlocks || !currentBlocks.length) {
      caretBlockIndex = null;
      renderChart();
      return;
    }
    const pos = codeTextarea.selectionStart || 0;
    const text = codeTextarea.value || "";
    let line = 0;
    for (let i = 0; i < Math.min(pos, text.length); i += 1) {
      if (text[i] === "\n") line += 1;
    }

    let match = null;
    for (let i = 0; i < currentBlocks.length; i += 1) {
      const b = currentBlocks[i];
      const start = Number.isFinite(b.lineStart) ? b.lineStart : 0;
      const end = Number.isFinite(b.lineEnd) ? b.lineEnd : start;
      if (line >= start && line <= end) {
        match = i;
        break;
      }
    }
    caretBlockIndex = match;
    renderChart();
  }

  function getInsertAfterIndex() {
    if (selectedBlockIndex != null) return selectedBlockIndex;
    if (caretBlockIndex != null) return caretBlockIndex;
    return null;
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
        path.setAttribute("d", "M6 6h12v12H6z");
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

  function insertSnippetAtInsertionPoint(textarea, snippetOrSpec) {
    if (!textarea) return;
    const spec =
      typeof snippetOrSpec === "string" ? null : snippetOrSpec || null;
    let snippet =
      typeof snippetOrSpec === "string"
        ? snippetOrSpec
        : snippetOrSpec?.snippet || "";

    if (spec && (spec.key === "warmup" || spec.key === "cooldown")) {
      snippet = buildContextualRampSnippet(spec.key, snippet);
    }

    const insertAfterIndex = getInsertAfterIndex();
    if (
      insertAfterIndex == null ||
      !currentBlocks ||
      !currentBlocks[insertAfterIndex]
    ) {
      insertSnippetAtCursor(textarea, snippet);
      return;
    }

    const block = currentBlocks[insertAfterIndex];
    const endLine = Number.isFinite(block.lineEnd)
      ? block.lineEnd
      : Number.isFinite(block.lineStart)
        ? block.lineStart
        : 0;

    const value = textarea.value || "";
    const lines = value.split("\n");
    const lineIdx = Math.max(0, Math.min(endLine, lines.length - 1));
    const beforeLines = lines.slice(0, lineIdx + 1).join("\n");
    let insertPos = beforeLines.length;
    if (lineIdx < lines.length - 1) {
      insertPos += 1;
    }

    const beforeText = value.slice(0, insertPos);
    const afterText = value.slice(insertPos);

    const prefix = beforeText && !beforeText.endsWith("\n") ? "\n" : "";
    const suffix = afterText && !afterText.startsWith("\n") ? "\n" : "";

    const newValue = beforeText + prefix + snippet + suffix + afterText;
    const caretPos = (beforeText + prefix + snippet).length;
    setCodeValueAndRefresh(newValue, caretPos);
  }

  function buildContextualRampSnippet(kind, fallbackSnippet) {
    if (!fallbackSnippet) return fallbackSnippet;
    const insertAfterIndex = getInsertAfterIndex();
    if (insertAfterIndex == null) return fallbackSnippet;

    const prevBlock = currentBlocks?.[insertAfterIndex] || null;
    const nextBlock = currentBlocks?.[insertAfterIndex + 1] || null;
    const prev = getBlockStartEnd(prevBlock);
    const next = getBlockStartEnd(nextBlock);

    if (!prev && !next) return fallbackSnippet;

    const duration = parseDurationFromSnippet(fallbackSnippet) || 600;
    const delta = 0.25;
    let low = null;
    let high = null;

    if (prev && next) {
      if (kind === "warmup" && next.start > prev.end) {
        low = prev.end;
        high = next.start;
      } else if (kind === "cooldown" && next.start < prev.end) {
        low = prev.end;
        high = next.start;
      } else {
        low = prev.end;
        high = kind === "warmup" ? low + delta : low - delta;
      }
    } else if (!prev && next) {
      high = next.start;
      low = high - delta;
    } else if (prev && !next) {
      low = prev.end;
      high = kind === "warmup" ? low + delta : low - delta;
    }

    if (low == null || high == null) return fallbackSnippet;

    low = clampRel(low);
    high = clampRel(high);

    const tag = kind === "cooldown" ? "Cooldown" : "Warmup";
    return `<${tag} Duration="${duration}" PowerLow="${formatRel(
      low,
    )}" PowerHigh="${formatRel(high)}" />`;
  }

  function parseDurationFromSnippet(snippet) {
    const match = /Duration="(\d+)"/.exec(snippet || "");
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  }

  function formatRel(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }

  function getBlockStartEnd(block) {
    if (!block) return null;
    const segs = Array.isArray(block.segments) ? block.segments : [];
    if (segs.length) {
      const first = segs[0];
      const last = segs[segs.length - 1];
      const start = Number.isFinite(first?.pStartRel)
        ? first.pStartRel
        : null;
      const end = Number.isFinite(last?.pEndRel)
        ? last.pEndRel
        : start;
      if (start != null && end != null) {
        return {start, end};
      }
    }

    const attrs = block.attrs || {};
    if (block.kind === "steady") {
      const power = attrs.powerRel;
      if (Number.isFinite(power)) return {start: power, end: power};
    } else if (block.kind === "warmup" || block.kind === "cooldown") {
      const low = attrs.powerLowRel;
      const high = attrs.powerHighRel;
      if (Number.isFinite(low) && Number.isFinite(high)) {
        return {start: low, end: high};
      }
    } else if (block.kind === "intervals") {
      const on = attrs.onPowerRel;
      const off = attrs.offPowerRel;
      if (Number.isFinite(on) && Number.isFinite(off)) {
        return {start: on, end: off};
      }
    }

    return null;
  }

  function handleChartPointerDown(e) {
    const handleEl = e.target.closest
      ? e.target.closest("[data-drag-handle]")
      : null;
    if (!handleEl || !chartMiniHost) return;

    const handle = handleEl.dataset.dragHandle;
    const blockIndex = Number(handleEl.dataset.blockIndex);
    const segIndex = Number(handleEl.dataset.segIndex);
    if (!Number.isFinite(blockIndex) || !Number.isFinite(segIndex)) return;

    const svg = chartMiniHost.querySelector("svg");
    if (!svg) return;

    e.preventDefault();
    if (handleEl.setPointerCapture) {
      handleEl.setPointerCapture(e.pointerId);
    }

    const rect = svg.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const {timings: segmentTimings, totalSec} = buildSegmentTimings(
      currentBlocks,
    );
    const {timings: blockTimings} = buildBlockTimings(currentBlocks);
    const segmentTiming = segmentTimings.find(
      (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
    );

    const ftp = getCurrentFtp() || 0;
    const safeFtp = ftp > 0 ? ftp : 200;
    const maxY = Math.max(200, safeFtp * 2);
    const timelineSec = Math.max(3600, totalSec || 0);

    let rampRegion = null;
    if (handle === "top") {
      const x1 = Number(handleEl.dataset.x1);
      const x2 = Number(handleEl.dataset.x2);
      if (Number.isFinite(x1) && Number.isFinite(x2)) {
        const third = (x2 - x1) / 3;
        if (localX <= x1 + third) rampRegion = "left";
        else if (localX >= x2 - third) rampRegion = "right";
        else rampRegion = "middle";
      } else {
        rampRegion = "middle";
      }
    }

    const block = currentBlocks[blockIndex];
    if (!block || !segmentTiming) return;

    const wasSelected = selectedBlockIndex === blockIndex;
    if (!wasSelected) {
      setSelectedBlock(blockIndex);
    }
    const insertIdx = computeInsertIndexFromPoint(
      blockIndex,
      segIndex,
      e.clientX,
    );
    if (insertIdx != null) {
      insertAfterOverrideIndex = insertIdx;
      renderChart();
    }

    dragState = {
      pointerId: e.pointerId,
      handle,
      blockIndex,
      segIndex,
      rect,
      width: rect.width,
      height: rect.height,
      timelineSec,
      maxY,
      ftp: safeFtp,
      tStart: segmentTiming.tStart,
      tEnd: segmentTiming.tEnd,
      blockKind: block.kind,
      rampRegion,
      blockTimings,
      startLow: getRampLow(block),
      startHigh: getRampHigh(block),
      startPower: getBlockSteadyPower(block),
      startOnPower: getIntervalParts(block).onPowerRel,
      startOffPower: getIntervalParts(block).offPowerRel,
      startClientX: e.clientX,
      startClientY: e.clientY,
      didDrag: false,
      wasSelected,
    };

    dragInsertAfterIndex = null;

    document.body.classList.add("wb-dragging");
    window.addEventListener("pointermove", handleChartPointerMove);
    window.addEventListener("pointerup", handleChartPointerUp);
    window.addEventListener("pointercancel", handleChartPointerUp);
  }

  function handleChartPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const {
      handle,
      blockIndex,
      segIndex,
      maxY,
      ftp,
      tStart,
      blockKind,
      rampRegion,
      startLow,
      startHigh,
      startOnPower,
      startOffPower,
    } = dragState;

    const svg = chartMiniHost ? chartMiniHost.querySelector("svg") : null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const {timings: blockTimings, totalSec} = buildBlockTimings(currentBlocks);
    const timelineSec = Math.max(3600, totalSec || 0);

    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (
      Math.abs(e.clientX - dragState.startClientX) > DRAG_THRESHOLD_PX ||
      Math.abs(e.clientY - dragState.startClientY) > DRAG_THRESHOLD_PX
    ) {
      dragState.didDrag = true;
    }
    const clampedX = Math.max(0, Math.min(width, localX));
    const clampedY = Math.max(0, Math.min(height, localY));

    if (handle === "move") {
      const timeSec = (clampedX / Math.max(1, width)) * timelineSec;
      const {timings: segmentTimings} = buildSegmentTimings(currentBlocks);
      let insertAfterIndex = -1;
      if (blockTimings.length) {
        let blockTiming = blockTimings.find((t) => timeSec <= t.tEnd);
        if (!blockTiming) {
          blockTiming = blockTimings[blockTimings.length - 1];
        }
        const block =
          currentBlocks && currentBlocks[blockTiming.index]
            ? currentBlocks[blockTiming.index]
            : null;
        if (block && block.kind === "intervals") {
          const mid = (blockTiming.tStart + blockTiming.tEnd) / 2;
          insertAfterIndex =
            timeSec < mid ? blockTiming.index - 1 : blockTiming.index;
        } else if (segmentTimings.length) {
          let seg = segmentTimings.find((t) => timeSec <= t.tEnd);
          if (!seg) seg = segmentTimings[segmentTimings.length - 1];
          const mid = (seg.tStart + seg.tEnd) / 2;
          insertAfterIndex =
            timeSec < mid ? seg.blockIndex - 1 : seg.blockIndex;
        }
      }
      if (insertAfterIndex < -1) insertAfterIndex = -1;
      if (insertAfterIndex >= currentBlocks.length) {
        insertAfterIndex = currentBlocks.length - 1;
      }
      if (insertAfterIndex !== dragInsertAfterIndex) {
        dragInsertAfterIndex = insertAfterIndex;
        renderChart();
      }
      return;
    }

    const powerW = (1 - clampedY / Math.max(1, height)) * maxY;
    const powerRel = snapPowerRel(powerW / Math.max(1, ftp));

    if (handle === "top") {
      if (blockKind === "steady") {
        applyBlockAttrUpdate(blockIndex, {powerRel});
        return;
      }

      if (blockKind === "warmup" || blockKind === "cooldown") {
        if (rampRegion === "left") {
          applyBlockAttrUpdate(blockIndex, {powerLowRel: powerRel});
        } else if (rampRegion === "right") {
          applyBlockAttrUpdate(blockIndex, {powerHighRel: powerRel});
        } else {
          const startMid = (startLow + startHigh) / 2;
          const delta = powerRel - startMid;
          applyBlockAttrUpdate(blockIndex, {
            powerLowRel: clampRel(startLow + delta),
            powerHighRel: clampRel(startHigh + delta),
          });
        }
        return;
      }

      if (blockKind === "intervals") {
        const role = segIndex % 2 === 0 ? "on" : "off";
        if (role === "on") {
          if (powerRel !== startOnPower) {
            applyBlockAttrUpdate(blockIndex, {onPowerRel: powerRel});
          }
        } else if (powerRel !== startOffPower) {
          applyBlockAttrUpdate(blockIndex, {offPowerRel: powerRel});
        }
      }
      return;
    }

    if (handle === "right") {
      const timeSec = (clampedX / Math.max(1, width)) * timelineSec;
      const duration = snapDurationSec(timeSec - tStart);

      if (blockKind === "steady" || blockKind === "warmup" || blockKind === "cooldown") {
        applyBlockAttrUpdate(blockIndex, {durationSec: duration});
        return;
      }

      if (blockKind === "intervals") {
        const role = segIndex % 2 === 0 ? "on" : "off";
        if (role === "on") {
          applyBlockAttrUpdate(blockIndex, {onDurationSec: duration});
        } else {
          applyBlockAttrUpdate(blockIndex, {offDurationSec: duration});
        }
      }
    }
  }

  function handleChartPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const {handle, blockIndex} = dragState;

    if (handle === "move" && dragInsertAfterIndex != null) {
      reorderBlocks(blockIndex, dragInsertAfterIndex);
    } else if (!dragState.didDrag) {
      if (dragState.wasSelected) {
        deselectBlock();
      } else {
        setSelectedBlock(blockIndex);
      }
      const insertIdx = computeInsertIndexFromPoint(
        blockIndex,
        dragState.segIndex,
        e.clientX,
      );
      if (insertIdx != null) {
        insertAfterOverrideIndex = insertIdx;
      }
      dragInsertAfterIndex = null;
      renderChart();
    } else {
      dragInsertAfterIndex = null;
      renderChart();
    }

    dragState = null;
    document.body.classList.remove("wb-dragging");
    window.removeEventListener("pointermove", handleChartPointerMove);
    window.removeEventListener("pointerup", handleChartPointerUp);
    window.removeEventListener("pointercancel", handleChartPointerUp);
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
    updateCaretBlockIndex();
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
