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

/**
 * @typedef WorkoutBuilderOptions
 * @property {HTMLElement} rootEl
 * @property {() => number} getCurrentFtp
 * @property {() => void} [onRequestBack]
 * @property {(payload: {hasSelection: boolean}) => void} [onUiStateChange]
 */

export function createWorkoutBuilder(options) {
  const {
    rootEl,
    getCurrentFtp,
    onChange,
    onStatusChange,
    onRequestBack,
    onUiStateChange,
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
  let dragInsertAfterIndex = null;
  let insertAfterOverrideIndex = null;
  let dragState = null;
  const undoStack = [];
  const redoStack = [];
  let historyGroupHasUndo = false;
  let historyPendingSnapshot = null;
  let isHistoryRestoring = false;
  let timelineLockSec = 0;
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
  moveLeftBtn.title = "Move block left";
  moveLeftBtn.appendChild(createCaretIcon("left"));
  moveLeftBtn.addEventListener("click", (e) => {
    e.preventDefault();
    moveSelectedBlock(-1);
  });
  const moveRightBtn = document.createElement("button");
  moveRightBtn.type = "button";
  moveRightBtn.className = "wb-block-move-btn";
  moveRightBtn.title = "Move block right";
  moveRightBtn.appendChild(createCaretIcon("right"));
  moveRightBtn.addEventListener("click", (e) => {
    e.preventDefault();
    moveSelectedBlock(1);
  });
  const deleteBlockBtn = document.createElement("button");
  deleteBlockBtn.type = "button";
  deleteBlockBtn.className = "wb-block-delete-btn";
  deleteBlockBtn.title = "Delete selected block (D / Backspace)";
  deleteBlockBtn.appendChild(createTrashIcon());
  deleteBlockBtn.addEventListener("click", (e) => {
    e.preventDefault();
    deleteSelectedBlock();
  });
  blockEditorActions.appendChild(moveLeftBtn);
  blockEditorActions.appendChild(moveRightBtn);
  blockEditorActions.appendChild(deleteBlockBtn);
  blockEditor.appendChild(blockEditorActions);

  const toolbarActions = document.createElement("div");
  toolbarActions.className = "wb-toolbar-actions";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "wb-toolbar-action-btn";
  undoBtn.title = "Undo (Ctrl/Cmd+Z or U)";
  undoBtn.appendChild(createUndoIcon());
  undoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    undoLastChange();
  });

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "wb-toolbar-action-btn";
  redoBtn.title = "Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)";
  redoBtn.appendChild(createRedoIcon());
  redoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    redoLastChange();
  });

  toolbarActions.appendChild(undoBtn);
  toolbarActions.appendChild(redoBtn);

  const buttonSpecs = [
    {
      key: "recovery",
      label: "Recovery",
      icon: "steady",
      zoneClass: "wb-zone-recovery",
      shortcut: "R",
      kind: "steady",
      durationSec: 300,
      powerRel: 0.55,
    },
    {
      key: "endurance",
      label: "Endurance",
      icon: "steady",
      zoneClass: "wb-zone-endurance",
      shortcut: "E",
      kind: "steady",
      durationSec: 300,
      powerRel: 0.7,
    },
    {
      key: "tempo",
      label: "Tempo",
      icon: "steady",
      zoneClass: "wb-zone-tempo",
      shortcut: "T",
      kind: "steady",
      durationSec: 300,
      powerRel: 0.85,
    },
    {
      key: "threshold",
      label: "Threshold",
      icon: "steady",
      zoneClass: "wb-zone-threshold",
      shortcut: "S",
      kind: "steady",
      durationSec: 300,
      powerRel: 0.95,
    },
    {
      key: "vo2max",
      label: "VO2Max",
      icon: "steady",
      zoneClass: "wb-zone-vo2",
      shortcut: "V",
      kind: "steady",
      durationSec: 300,
      powerRel: 1.1,
    },
    {
      key: "anaerobic",
      label: "Anaerobic",
      icon: "steady",
      zoneClass: "wb-zone-anaerobic",
      shortcut: "A",
      kind: "steady",
      durationSec: 300,
      powerRel: 1.25,
    },
    {
      key: "warmup",
      label: "Warmup",
      icon: "rampUp",
      shortcut: "W",
      kind: "warmup",
      durationSec: 600,
      powerLowRel: 0.5,
      powerHighRel: 0.75,
    },
    {
      key: "cooldown",
      label: "Cooldown",
      icon: "rampDown",
      shortcut: "C",
      kind: "cooldown",
      durationSec: 600,
      powerLowRel: 0.75,
      powerHighRel: 0.5,
    },
    {
      key: "intervals",
      label: "IntervalsT",
      icon: "intervals",
      shortcut: "I",
      kind: "intervals",
      repeat: 6,
      onDurationSec: 60,
      offDurationSec: 60,
      onPowerRel: 1.1,
      offPowerRel: 0.55,
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
    if (spec.shortcut) {
      btn.title = `${spec.label} (${spec.shortcut})`;
    } else {
      btn.title = spec.label;
    }
    if (spec.zoneClass) btn.classList.add(spec.zoneClass);

    if (spec.icon) {
      const iconEl = createWorkoutElementIcon(spec.icon);
      btn.appendChild(iconEl);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = spec.label;
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
      insertBlockAtInsertionPoint(spec, {selectOnInsert: false});
    });

    toolbarButtons.appendChild(btn);
  });

  toolbar.appendChild(toolbarButtons);
  toolbar.appendChild(blockEditor);
  toolbar.appendChild(toolbarActions);
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


  body.appendChild(topRow);
  body.appendChild(statsCard);
  body.appendChild(chartCard);
  body.appendChild(toolbarCard);
  wrapper.appendChild(body);
  rootEl.appendChild(wrapper);

  setStatusMessage("Not checked yet.", "neutral");

  // ---------- Events ----------

  [nameField.input, sourceField.input, descField.textarea].forEach((el) => {
    el.addEventListener("input", () => {
      handleAnyChange();
    });
  });

  const handleBuilderShortcuts = (e) => {
    if (e.defaultPrevented) return;
    if (!rootEl || rootEl.getClientRects().length === 0) return;
    const isMetaShortcut =
      (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
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

    if (isMetaShortcut && !hasSelection) {
      if (!currentBlocks || !currentBlocks.length) return;
      if (lower === "a") {
        e.preventDefault();
        insertAfterOverrideIndex = -1;
        renderChart();
        return;
      }
      if (lower === "e") {
        e.preventDefault();
        insertAfterOverrideIndex = currentBlocks.length - 1;
        renderChart();
        return;
      }
    }

    const isUndo =
      (isMetaShortcut && lower === "z") ||
      (!e.metaKey && !e.ctrlKey && !e.altKey && lower === "u" && !e.shiftKey);
    if (isUndo) {
      e.preventDefault();
      undoLastChange();
      return;
    }

    const isRedo =
      ((e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        ((lower === "z" && e.shiftKey) || lower === "y")) ||
      (!e.metaKey && !e.ctrlKey && !e.altKey && lower === "u" && e.shiftKey);
    if (isRedo) {
      e.preventDefault();
      redoLastChange();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const insertByKey = (specKey) => {
      const spec = buttonSpecByKey.get(specKey);
      if (!spec) return false;
      insertBlockAtInsertionPoint(spec, {selectOnInsert: true});
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
      if (key === "Escape" && typeof onRequestBack === "function") {
        e.preventDefault();
        e.stopPropagation();
        onRequestBack();
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
      if (key === "Home") {
        e.preventDefault();
        insertAfterOverrideIndex = -1;
        renderChart();
        return;
      }
      if (key === "End") {
        e.preventDefault();
        insertAfterOverrideIndex = currentBlocks.length - 1;
        renderChart();
        return;
      }
      if (lower === "g") {
        e.preventDefault();
        insertAfterOverrideIndex = -1;
        renderChart();
        return;
      }
      if (lower === "$") {
        e.preventDefault();
        insertAfterOverrideIndex = currentBlocks.length - 1;
        renderChart();
        return;
      }
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
            }, {select: false});
          } else if (b.kind === "warmup" || b.kind === "cooldown") {
            const isStart = position === "start";
            const current = isStart ? getRampLow(b) : getRampHigh(b);
            applyBlockAttrUpdate(idx, {
              [isStart ? "powerLowRel" : "powerHighRel"]: clampRel(
                current + delta,
              ),
            }, {select: false});
          } else if (b.kind === "intervals") {
            const parts = getIntervalParts(b);
            const isStart = position === "start";
            applyBlockAttrUpdate(idx, {
              [isStart ? "onPowerRel" : "offPowerRel"]: clampRel(
                (isStart ? parts.onPowerRel : parts.offPowerRel) + delta,
              ),
            }, {select: false});
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
    if (!currentBlocks || !currentBlocks.length) {
      clearState({persist: true});
    } else {
      refreshLayout({skipPersist: true});
    }
  })();

  // ---------- Public API ----------

  function refreshLayout(opts = {}) {
    handleAnyChange(opts);
    autoGrowTextarea(descField.textarea);
  }

  // Re-render chart when OS theme changes so SVG colors follow CSS vars
  const themePref = document.documentElement?.dataset?.theme || "auto";
  if (window.matchMedia && themePref === "auto") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = () => {
      refreshLayout({skipPersist: true});
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

  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    historyGroupHasUndo = false;
    historyPendingSnapshot = null;
    updateUndoRedoButtons();
  }

  function clearState(options = {}) {
    const {persist = true} = options;

    resetHistory();
    nameField.input.value = "";
    sourceField.input.value = "";
    descField.textarea.value = "";
    urlInput.value = "";

    setDefaultBlocks();
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
    const hasBlocks = currentBlocks && currentBlocks.length;

    nameField.input.classList.remove("wb-input-error");
    sourceField.input.classList.remove("wb-input-error");
    descField.textarea.classList.remove("wb-input-error");

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
    if (!hasBlocks) {
      errors.push({
        field: "code",
        message: "Workout code is empty.",
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

  function setDefaultBlocks() {
    const warmup = createBlock("warmup", {
      durationSec: 600,
      powerLowRel: 0.5,
      powerHighRel: 0.85,
    });
    const steady = createBlock("steady", {
      durationSec: 900,
      powerRel: 0.85,
    });
    const intervals = createBlock("intervals", {
      repeat: 6,
      onDurationSec: 60,
      offDurationSec: 60,
      onPowerRel: 1.1,
      offPowerRel: 0.55,
    });
    const cooldown = createBlock("cooldown", {
      durationSec: 600,
      powerLowRel: 0.55,
      powerHighRel: 0.5,
    });
    currentBlocks = [warmup, steady, intervals, cooldown];
    currentRawSegments = buildRawSegmentsFromBlocks(currentBlocks);
    currentErrors = [];
  }

  function handleAnyChange(opts = {}) {
    const {skipPersist = false} = opts;

    currentRawSegments = buildRawSegmentsFromBlocks(currentBlocks);
    currentErrors = [];
    if (
      selectedBlockIndex != null &&
      !currentBlocks[selectedBlockIndex]
    ) {
      selectedBlockIndex = null;
    }
    if (
      insertAfterOverrideIndex == null &&
      selectedBlockIndex == null &&
      currentBlocks.length
    ) {
      insertAfterOverrideIndex = currentBlocks.length - 1;
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
    updateBlockEditor();
    updateUndoRedoButtons();
    emitUiState();

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
      renderBuilderWorkoutGraph(chartMiniHost, currentBlocks || [], ftp, {
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
        lockTimelineSec:
          dragState && dragState.handle === "right"
            ? dragState.lockedTimelineSec
            : timelineLockSec,
      });
    } catch (e) {
      console.error("[WorkoutBuilder] Failed to render mini chart:", e);
    }
    if (chartContainer) {
      chartContainer.scrollLeft = prevScrollLeft;
    }
    ensureChartFocusVisible();
  }

  function ensureChartFocusVisible() {
    if (!chartContainer || !chartMiniHost) return;
    const svg = chartMiniHost.querySelector("svg");
    if (!svg) return;
    if (!currentBlocks || !currentBlocks.length) return;

    const {timings, totalSec} = buildBlockTimings(currentBlocks);
    if (!timings.length) return;

    const svgRect = svg.getBoundingClientRect();
    const svgWidth = svgRect.width || svg.clientWidth || 1;
    const timelineSec = Math.max(3600, totalSec || 0);

    let focusTimeSec = null;
    if (
      selectedBlockIndex != null &&
      currentBlocks[selectedBlockIndex] &&
      timings[selectedBlockIndex]
    ) {
      const timing = timings[selectedBlockIndex];
      focusTimeSec = (timing.tStart + timing.tEnd) / 2;
    } else {
      const insertAfter =
        dragInsertAfterIndex != null
          ? dragInsertAfterIndex
          : insertAfterOverrideIndex != null
            ? insertAfterOverrideIndex
            : getInsertAfterIndex();
      if (insertAfter != null) {
        const timing =
          insertAfter < 0
            ? {tEnd: 0}
            : timings[Math.min(insertAfter, timings.length - 1)];
        focusTimeSec = timing ? timing.tEnd : null;
      }
    }

    if (focusTimeSec == null) return;
    const focusX = (focusTimeSec / timelineSec) * svgWidth;
    const viewLeft = chartContainer.scrollLeft;
    const viewWidth = chartContainer.clientWidth || 1;
    const padding = Math.min(80, viewWidth * 0.2);
    const minX = viewLeft + padding;
    const maxX = viewLeft + viewWidth - padding;

    if (focusX < minX) {
      chartContainer.scrollLeft = Math.max(0, focusX - padding);
    } else if (focusX > maxX) {
      chartContainer.scrollLeft = Math.max(0, focusX - viewWidth + padding);
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
    insertAfterOverrideIndex = null;
    startHistoryGroup();
    updateBlockEditor();
    renderChart();
    emitUiState();
  }

  function deselectBlock() {
    if (selectedBlockIndex == null) return;
    const prevSelected = selectedBlockIndex;
    selectedBlockIndex = null;
    if (insertAfterOverrideIndex == null && prevSelected != null) {
      insertAfterOverrideIndex = prevSelected;
    }
    startHistoryGroup();
    updateBlockEditor();
    renderChart();
    emitUiState();
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
    insertAfterOverrideIndex = next;
    startHistoryGroup();
    updateBlockEditor();
    renderChart();
    emitUiState();
  }

  function handleBlockSelectionFromChart(idx) {
    if (idx == null) {
      deselectBlock();
      return;
    }
    setSelectedBlock(idx);
  }

  function handleInsertAfterFromChart(idx) {
    setInsertAfterIndex(idx);
  }

  function handleInsertAfterFromSegment(idx) {
    insertAfterOverrideIndex = idx;
    renderChart();
    emitUiState();
  }

  function emitUiState() {
    if (typeof onUiStateChange !== "function") return;
    onUiStateChange({hasSelection: !!getSelectedBlock()});
  }

  function startHistoryGroup() {
    if (isHistoryRestoring) return;
    historyGroupHasUndo = false;
    historyPendingSnapshot = createHistorySnapshot();
  }

  function createHistorySnapshot() {
    return {
      workoutTitle: nameField.input.value,
      source: sourceField.input.value,
      description: descField.textarea.value,
      sourceURL: urlInput.value,
      blocks: cloneBlocks(currentBlocks || []),
      selectedBlockIndex,
      insertAfterOverrideIndex,
    };
  }

  function applyHistorySnapshot(snapshot) {
    if (!snapshot) return;
    isHistoryRestoring = true;
    nameField.input.value = snapshot.workoutTitle || "";
    sourceField.input.value = snapshot.source || "";
    descField.textarea.value = snapshot.description || "";
    urlInput.value = snapshot.sourceURL || "";
    currentBlocks = cloneBlocks(snapshot.blocks || []);
    selectedBlockIndex =
      snapshot.selectedBlockIndex != null ? snapshot.selectedBlockIndex : null;
    insertAfterOverrideIndex =
      snapshot.insertAfterOverrideIndex != null
        ? snapshot.insertAfterOverrideIndex
        : null;
    dragInsertAfterIndex = null;
    refreshLayout();
    isHistoryRestoring = false;
    startHistoryGroup();
    updateUndoRedoButtons();
  }

  function cloneBlocks(blocks) {
    return (blocks || []).map((block) => ({
      ...block,
      attrs: {...(block.attrs || {})},
      segments: Array.isArray(block.segments)
        ? block.segments.map((seg) => ({...seg}))
        : [],
    }));
  }

  function recordHistorySnapshot() {
    if (isHistoryRestoring) return;
    if (selectedBlockIndex != null) {
      if (!historyGroupHasUndo) {
        if (!historyPendingSnapshot) {
          historyPendingSnapshot = createHistorySnapshot();
        }
        undoStack.push(historyPendingSnapshot);
        historyPendingSnapshot = null;
        historyGroupHasUndo = true;
        redoStack.length = 0;
        updateUndoRedoButtons();
      }
      return;
    }
    undoStack.push(createHistorySnapshot());
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function undoLastChange() {
    if (!undoStack.length) return;
    const snapshot = undoStack.pop();
    redoStack.push(createHistorySnapshot());
    applyHistorySnapshot(snapshot);
  }

  function redoLastChange() {
    if (!redoStack.length) return;
    const snapshot = redoStack.pop();
    undoStack.push(createHistorySnapshot());
    applyHistorySnapshot(snapshot);
  }

  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
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

  function buildRawSegmentsFromBlocks(blocks) {
    const raw = [];
    (blocks || []).forEach((block) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      segs.forEach((seg) => {
        const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
        const pStartRel = Number(seg?.pStartRel) || 0;
        const pEndRel =
          seg?.pEndRel != null ? Number(seg.pEndRel) : pStartRel;
        raw.push([durSec / 60, pStartRel * 100, pEndRel * 100]);
      });
    });
    return raw;
  }

  function segmentsToBlocks(segments) {
    if (!Array.isArray(segments) || !segments.length) return [];
    const normalized = [];

    for (const seg of segments) {
      if (!Array.isArray(seg) || seg.length < 2) continue;
      const minutes = Number(seg[0]);
      let startVal = Number(seg[1]);
      let endVal = seg.length > 2 && seg[2] != null ? Number(seg[2]) : startVal;

      if (
        !Number.isFinite(minutes) ||
        minutes <= 0 ||
        !Number.isFinite(startVal) ||
        !Number.isFinite(endVal)
      ) {
        continue;
      }

      const toRel = (v) => (v <= 5 ? v : v / 100);
      const durationSec = clampDuration(minutes * 60);
      const pStartRel = clampRel(toRel(startVal));
      const pEndRel = clampRel(toRel(endVal));

      if (Math.abs(pStartRel - pEndRel) < 1e-6) {
        normalized.push({
          kind: "steady",
          durationSec,
          powerRel: pStartRel,
        });
      } else if (pEndRel > pStartRel) {
        normalized.push({
          kind: "rampUp",
          durationSec,
          powerLowRel: pStartRel,
          powerHighRel: pEndRel,
        });
      } else {
        normalized.push({
          kind: "rampDown",
          durationSec,
          powerLowRel: pStartRel,
          powerHighRel: pEndRel,
        });
      }
    }

    if (!normalized.length) return [];

    const blocks = [];
    const DUR_TOL = 1;
    const PWR_TOL = 0.01;
    let i = 0;

    while (i < normalized.length) {
      if (i + 3 < normalized.length) {
        const firstA = normalized[i];
        const firstB = normalized[i + 1];

        if (firstA.kind === "steady" && firstB.kind === "steady") {
          let repeat = 1;
          let j = i + 2;

          while (j + 1 < normalized.length) {
            const nextA = normalized[j];
            const nextB = normalized[j + 1];

            if (
              nextA.kind !== "steady" ||
              nextB.kind !== "steady" ||
              !blocksSimilarSteady(firstA, nextA, DUR_TOL, PWR_TOL) ||
              !blocksSimilarSteady(firstB, nextB, DUR_TOL, PWR_TOL)
            ) {
              break;
            }

            repeat += 1;
            j += 2;
          }

          if (repeat >= 2) {
            const onDurationSec = clampDuration(firstA.durationSec);
            const offDurationSec = clampDuration(firstB.durationSec);
            const onPowerRel = clampRel(firstA.powerRel);
            const offPowerRel = clampRel(firstB.powerRel);
            blocks.push(
              createBlock("intervals", {
                repeat: clampRepeat(repeat),
                onDurationSec,
                offDurationSec,
                onPowerRel,
                offPowerRel,
              }),
            );
            i += repeat * 2;
            continue;
          }
        }
      }

      const b = normalized[i];
      if (b.kind === "steady") {
        blocks.push(
          createBlock("steady", {
            durationSec: clampDuration(b.durationSec),
            powerRel: clampRel(b.powerRel),
          }),
        );
      } else if (b.kind === "rampUp") {
        blocks.push(
          createBlock("warmup", {
            durationSec: clampDuration(b.durationSec),
            powerLowRel: clampRel(b.powerLowRel),
            powerHighRel: clampRel(b.powerHighRel),
          }),
        );
      } else if (b.kind === "rampDown") {
        blocks.push(
          createBlock("cooldown", {
            durationSec: clampDuration(b.durationSec),
            powerLowRel: clampRel(b.powerLowRel),
            powerHighRel: clampRel(b.powerHighRel),
          }),
        );
      }

      i += 1;
    }

    return blocks;
  }

  function blocksSimilarSteady(a, b, durTolSec, pwrTol) {
    if (a.kind !== "steady" || b.kind !== "steady") return false;
    const durDiff = Math.abs(a.durationSec - b.durationSec);
    const pDiff = Math.abs(a.powerRel - b.powerRel);
    return durDiff <= durTolSec && pDiff <= pwrTol;
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
      if (Number.isFinite(segIndex)) {
        const isOn = segIndex % 2 === 0;
        return isOn ? blockIndex - 1 : blockIndex;
      }
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

    recordHistorySnapshot();
    const updated = currentBlocks.slice();
    const [moving] = updated.splice(fromIndex, 1);
    updated.splice(target + 1, 0, moving);

    selectedBlockIndex = null;
    dragInsertAfterIndex = null;
    commitBlocks(updated, {selectIndex: target + 1});
  }

  function updateErrorStyling() {
    if (!currentBlocks || !currentBlocks.length) {
      setStatusMessage("Empty workout. Add elements to begin.", "neutral");
      return;
    }

    if (!currentErrors.length) {
      setStatusMessage("No errors detected.", "ok");
      return;
    }

    const first = currentErrors[0];
    setStatusMessage(first.message, "error");
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

    resetHistory();
    nameField.input.value = state.workoutTitle || "";
    sourceField.input.value = state.source || "";
    descField.textarea.value = state.description || "";
    urlInput.value = state.sourceURL || "";
    currentBlocks = segmentsToBlocks(state.rawSegments);
    currentRawSegments = buildRawSegmentsFromBlocks(currentBlocks);
    currentErrors = [];

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

    if (config.kind === "duration") {
      minus.title = "Decrease duration (H / \u2190 / Shift+H)";
      plus.title = "Increase duration (L / \u2192 / Shift+L)";
    } else if (config.kind === "power") {
      minus.title = "Decrease power (J / \u2193 / Shift+J)";
      plus.title = "Increase power (K / \u2191 / Shift+K)";
    }

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

  function commitBlocks(updatedBlocks, options = {}) {
    currentBlocks = updatedBlocks || [];
    currentRawSegments = buildRawSegmentsFromBlocks(currentBlocks);
    currentErrors = [];

    if (options.selectIndex !== undefined) {
      selectedBlockIndex = options.selectIndex;
    }

    handleAnyChange({skipPersist: options.skipPersist});
  }

  function applyBlockAttrUpdate(blockIndex, attrs, options = {}) {
    if (
      blockIndex == null ||
      !currentBlocks ||
      !currentBlocks[blockIndex]
    ) {
      return;
    }

    const oldStartEnd = getBlockStartEnd(currentBlocks[blockIndex]);
    recordHistorySnapshot();
    const updatedBlocks = currentBlocks.map((block, idx) => {
      if (idx !== blockIndex) return block;
      const nextBlock = {
        ...block,
        attrs: {...(block.attrs || {}), ...attrs},
      };
      return {
        ...nextBlock,
        segments: buildSegmentsForBlock(nextBlock),
      };
    });

    const newStartEnd = getBlockStartEnd(updatedBlocks[blockIndex]);
    if (oldStartEnd && newStartEnd) {
      syncAdjacentRampLinks(updatedBlocks, blockIndex, oldStartEnd, newStartEnd);
    }

    const nextIndex =
      options.select === false
        ? selectedBlockIndex
        : blockIndex < currentBlocks.length
          ? blockIndex
          : null;
    commitBlocks(updatedBlocks, {selectIndex: nextIndex});
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
    recordHistorySnapshot();
    const updatedBlocks = currentBlocks.filter(
      (_block, idx) => idx !== deleteIndex,
    );

    if (!updatedBlocks.length) {
      commitBlocks(updatedBlocks, {selectIndex: null});
      return;
    }

    const nextIndex =
      deleteIndex > 0
        ? Math.min(deleteIndex - 1, updatedBlocks.length - 1)
        : 0;
    insertAfterOverrideIndex = nextIndex;
    commitBlocks(updatedBlocks, {selectIndex: null});
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

    recordHistorySnapshot();
    const updated = currentBlocks.slice();
    const [moving] = updated.splice(idx, 1);
    updated.splice(target, 0, moving);

    commitBlocks(updated, {selectIndex: target});
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

  function createBlock(kind, attrs) {
    const block = {
      kind,
      attrs: {...(attrs || {})},
    };
    return {
      ...block,
      segments: buildSegmentsForBlock(block),
    };
  }

  function buildSegmentsForBlock(block) {
    if (!block || !block.kind) return [];
    const attrs = block.attrs || {};

    if (block.kind === "steady") {
      const durationSec = clampDuration(
        attrs.durationSec ?? block.segments?.[0]?.durationSec ?? 300,
      );
      const powerRel =
        attrs.powerRel ?? block.segments?.[0]?.pStartRel ?? 0.5;
      return [
        {
          durationSec,
          pStartRel: powerRel,
          pEndRel: powerRel,
        },
      ];
    }

    if (block.kind === "warmup" || block.kind === "cooldown") {
      const durationSec = clampDuration(
        attrs.durationSec ?? block.segments?.[0]?.durationSec ?? 300,
      );
      const low =
        attrs.powerLowRel ?? block.segments?.[0]?.pStartRel ?? 0.5;
      const high =
        attrs.powerHighRel ?? block.segments?.[0]?.pEndRel ?? low;
      return [
        {
          durationSec,
          pStartRel: low,
          pEndRel: high,
        },
      ];
    }

    if (block.kind === "intervals") {
      const parts = getIntervalParts(block);
      const repeat = clampRepeat(attrs.repeat ?? parts.repeat);
      const onDurationSec = clampDuration(
        attrs.onDurationSec ?? parts.onDurationSec,
      );
      const offDurationSec = clampDuration(
        attrs.offDurationSec ?? parts.offDurationSec,
      );
      const onPowerRel = attrs.onPowerRel ?? parts.onPowerRel;
      const offPowerRel = attrs.offPowerRel ?? parts.offPowerRel;
      const segments = [];
      for (let i = 0; i < repeat; i += 1) {
        segments.push({
          durationSec: onDurationSec,
          pStartRel: onPowerRel,
          pEndRel: onPowerRel,
        });
        segments.push({
          durationSec: offDurationSec,
          pStartRel: offPowerRel,
          pEndRel: offPowerRel,
        });
      }
      return segments;
    }

    return block.segments || [];
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

  function getInsertAfterIndex() {
    if (insertAfterOverrideIndex != null) return insertAfterOverrideIndex;
    if (selectedBlockIndex != null) return selectedBlockIndex;
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

  function createUndoIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7 8H4l3-3m0 3h6a6 6 0 1 1 0 12H7");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function createRedoIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M17 8h3l-3-3m0 3h-6a6 6 0 1 0 0 12h6");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
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

  function insertBlockAtInsertionPoint(spec, options = {}) {
    const block = buildBlockFromSpec(spec);
    if (!block) return null;
    const {selectOnInsert = true} = options;

    const insertAfterIndex = getInsertAfterIndex();
    const insertIndex =
      insertAfterIndex == null
        ? currentBlocks.length
        : Math.max(0, insertAfterIndex + 1);

    recordHistorySnapshot();
    const updated = currentBlocks.slice();
    const prevBlock = insertIndex > 0 ? updated[insertIndex - 1] : null;
    const nextBlock =
      insertIndex < updated.length ? updated[insertIndex] : null;

    if (block.kind === "warmup") {
      const durationSec = prevBlock ? 120 : 360;
      block.attrs = {...(block.attrs || {}), durationSec};
      block.segments = buildSegmentsForBlock(block);
    } else if (block.kind === "cooldown") {
      const durationSec = nextBlock ? 120 : 360;
      block.attrs = {...(block.attrs || {}), durationSec};
      block.segments = buildSegmentsForBlock(block);
    }

    updated.splice(insertIndex, 0, block);

    if (block.kind === "steady") {
      adjustAdjacentRampsForSteady(updated, insertIndex, block);
    }

    insertAfterOverrideIndex = insertIndex;
    commitBlocks(updated, {selectIndex: selectOnInsert ? insertIndex : null});
    return insertIndex;
  }

  function buildBlockFromSpec(spec) {
    if (!spec || !spec.kind) return null;
    const kind = spec.kind;
    const attrs = {};

    if (kind === "steady") {
      attrs.durationSec = clampDuration(spec.durationSec ?? 300);
      attrs.powerRel = clampRel(spec.powerRel ?? 0.5);
    } else if (kind === "warmup" || kind === "cooldown") {
      attrs.durationSec = clampDuration(spec.durationSec ?? 600);
      attrs.powerLowRel = clampRel(spec.powerLowRel ?? 0.5);
      attrs.powerHighRel = clampRel(spec.powerHighRel ?? 0.75);
    } else if (kind === "intervals") {
      attrs.repeat = clampRepeat(spec.repeat ?? 3);
      attrs.onDurationSec = clampDuration(spec.onDurationSec ?? 300);
      attrs.offDurationSec = clampDuration(spec.offDurationSec ?? 180);
      attrs.onPowerRel = clampRel(spec.onPowerRel ?? 0.9);
      attrs.offPowerRel = clampRel(spec.offPowerRel ?? 0.5);
    }

    const base = createBlock(kind, attrs);
    if (kind === "warmup" || kind === "cooldown") {
      return buildContextualRampBlock(kind, base);
    }

    return base;
  }

  function adjustAdjacentRampsForSteady(blocks, insertIndex, steadyBlock) {
    const powerRel = getBlockSteadyPower(steadyBlock);
    const prevBlock = insertIndex > 0 ? blocks[insertIndex - 1] : null;
    const nextBlock =
      insertIndex + 1 < blocks.length ? blocks[insertIndex + 1] : null;

    if (prevBlock && (prevBlock.kind === "warmup" || prevBlock.kind === "cooldown")) {
      const start = getRampLow(prevBlock);
      const end = getRampHigh(prevBlock);
      const nextEnd = powerRel;
      const isWarmup = prevBlock.kind === "warmup";
      const keepsDirection = isWarmup ? nextEnd >= start : nextEnd <= start;
      if (keepsDirection) {
        prevBlock.attrs = {...(prevBlock.attrs || {}), powerHighRel: nextEnd};
        prevBlock.segments = buildSegmentsForBlock(prevBlock);
      }
    }

    if (nextBlock && (nextBlock.kind === "warmup" || nextBlock.kind === "cooldown")) {
      const start = getRampLow(nextBlock);
      const end = getRampHigh(nextBlock);
      const nextStart = powerRel;
      const isWarmup = nextBlock.kind === "warmup";
      const keepsDirection = isWarmup ? nextStart <= end : nextStart >= end;
      if (keepsDirection) {
        nextBlock.attrs = {...(nextBlock.attrs || {}), powerLowRel: nextStart};
        nextBlock.segments = buildSegmentsForBlock(nextBlock);
      }
    }
  }

  function buildContextualRampBlock(kind, fallbackBlock) {
    const insertAfterIndex = getInsertAfterIndex();
    if (insertAfterIndex == null) return fallbackBlock;

    const prevBlock = currentBlocks?.[insertAfterIndex] || null;
    const nextBlock = currentBlocks?.[insertAfterIndex + 1] || null;
    const prev = getBlockStartEnd(prevBlock);
    const next = getBlockStartEnd(nextBlock);

    if (!prev && !next) return fallbackBlock;

    const duration = clampDuration(
      fallbackBlock.attrs?.durationSec ||
        fallbackBlock.segments?.[0]?.durationSec ||
        600,
    );
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

    if (low == null || high == null) return fallbackBlock;

    low = clampRel(low);
    high = clampRel(high);

    const seg = {
      durationSec: duration,
      pStartRel: low,
      pEndRel: high,
    };

    return {
      ...fallbackBlock,
      segments: [seg],
      attrs: {
        ...(fallbackBlock.attrs || {}),
        durationSec: duration,
        powerLowRel: low,
        powerHighRel: high,
      },
    };
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

  function syncAdjacentRampLinks(blocks, blockIndex, oldStartEnd, newStartEnd) {
    const EPS = 1e-6;
    const prevBlock = blockIndex > 0 ? blocks[blockIndex - 1] : null;
    const nextBlock =
      blockIndex + 1 < blocks.length ? blocks[blockIndex + 1] : null;

    if (prevBlock && (prevBlock.kind === "warmup" || prevBlock.kind === "cooldown")) {
      const prevEnd = getRampHigh(prevBlock);
      if (Math.abs(prevEnd - oldStartEnd.start) <= EPS) {
        prevBlock.attrs = {
          ...(prevBlock.attrs || {}),
          powerHighRel: newStartEnd.start,
        };
        prevBlock.segments = buildSegmentsForBlock(prevBlock);
      }
    }

    if (nextBlock && (nextBlock.kind === "warmup" || nextBlock.kind === "cooldown")) {
      const nextStart = getRampLow(nextBlock);
      if (Math.abs(nextStart - oldStartEnd.end) <= EPS) {
        nextBlock.attrs = {
          ...(nextBlock.attrs || {}),
          powerLowRel: newStartEnd.end,
        };
        nextBlock.segments = buildSegmentsForBlock(nextBlock);
      }
    }
  }

  function handleChartPointerDown(e) {
    if (!chartMiniHost) return;
    const activeEl = document.elementFromPoint(e.clientX, e.clientY);
    const handleEl =
      activeEl && activeEl.closest
        ? activeEl.closest("[data-drag-handle]")
        : null;
    if (!handleEl) return;

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

    setSelectedBlock(blockIndex);
    const insertIdx = computeInsertIndexFromPoint(
      blockIndex,
      segIndex,
      e.clientX,
    );
    if (insertIdx != null) {
      insertAfterOverrideIndex = insertIdx;
      renderChart();
    }

    const blockTiming = blockTimings.find((t) => t.index === blockIndex);
    const blockStartSec = blockTiming ? blockTiming.tStart : 0;

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
      blockStartSec,
      lockedTimelineSec: Math.max(3600, totalSec || 0),
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
    };

    dragInsertAfterIndex = null;
    chartMiniHost.dataset.dragBlockIndex = String(blockIndex);
    chartMiniHost.dataset.dragSegIndex = String(segIndex);
    if (handle === "right") {
      timelineLockSec = dragState.lockedTimelineSec || 0;
    }

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
      blockStartSec,
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
    const effectiveTimelineSec =
      handle === "right" && dragState?.lockedTimelineSec
        ? Math.max(dragState.lockedTimelineSec, timelineSec)
        : timelineSec;

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
      const timeSec =
        (clampedX / Math.max(1, width)) * effectiveTimelineSec;
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
      const timeSec =
        (clampedX / Math.max(1, width)) * effectiveTimelineSec;
      const duration = snapDurationSec(timeSec - tStart);

      if (blockKind === "steady" || blockKind === "warmup" || blockKind === "cooldown") {
        applyBlockAttrUpdate(blockIndex, {durationSec: duration});
        return;
      }

      if (blockKind === "intervals") {
        const role = segIndex % 2 === 0 ? "on" : "off";
        const parts = getIntervalParts(currentBlocks[blockIndex] || {});
        const repIndex = Math.floor(segIndex / 2);
        const scale = Math.max(1, repIndex + 1);
        if (role === "on") {
          const rawDuration =
            (timeSec - blockStartSec - repIndex * parts.offDurationSec) / scale;
          applyBlockAttrUpdate(blockIndex, {
            onDurationSec: snapDurationSec(rawDuration),
          });
        } else {
          const rawDuration =
            (timeSec - blockStartSec - scale * parts.onDurationSec) / scale;
          applyBlockAttrUpdate(blockIndex, {
            offDurationSec: snapDurationSec(rawDuration),
          });
        }
        return;
      }
    }
  }

  function handleChartPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const {handle, blockIndex} = dragState;

    if (handle === "move" && dragInsertAfterIndex != null) {
      reorderBlocks(blockIndex, dragInsertAfterIndex);
    } else if (!dragState.didDrag) {
      setSelectedBlock(blockIndex);
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

    if (dragState && dragState.handle === "right") {
      timelineLockSec = 0;
    }
    dragState = null;
    if (chartMiniHost) {
      chartMiniHost.removeAttribute("data-drag-block-index");
      chartMiniHost.removeAttribute("data-drag-seg-index");
    }
    document.body.classList.remove("wb-dragging");
    window.removeEventListener("pointermove", handleChartPointerMove);
    window.removeEventListener("pointerup", handleChartPointerUp);
    window.removeEventListener("pointercancel", handleChartPointerUp);
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
