// workout-builder.js

import { renderBuilderWorkoutGraph } from "./workout-chart.js";
import { createBuilderBackend } from "./builder-backend.js";
import { formatDurationMinSec } from "./workout-metrics.js";
import {
  clearWorkoutBuilderState,
  loadWorkoutBuilderState,
  saveWorkoutBuilderState,
} from "./storage.js";
import {
  canonicalWorkoutToZwoXml,
  parseZwoXmlToCanonicalWorkout,
} from "./zwo.js";

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
  const backend = createBuilderBackend();
  let dragInsertAfterIndex = null;
  let dragState = null;
  let timelineLockSec = 0;
  let selectedTextEventIndex = null;
  const DRAG_THRESHOLD_PX = 4;
  const statusTarget = statusMessageEl || null;

  function setStatusMessage(text, tone = "neutral") {
    if (statusTarget) {
      statusTarget.textContent = text;
      statusTarget.dataset.tone = tone;
    }
    if (typeof onStatusChange === "function") {
      onStatusChange({ text, tone });
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
  sourceField.input.value = "Me";
  const descField = createLabeledTextarea("Description");
  descField.textarea.placeholder =
    "Short description, goals, or cues (optional)";

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
  deleteBlockBtn.title = "Delete selected block (Backspace / Delete)";
  deleteBlockBtn.appendChild(createTrashIcon());
  deleteBlockBtn.addEventListener("click", (e) => {
    e.preventDefault();
    deleteSelectedBlock();
  });

  const toolbarActions = document.createElement("div");
  toolbarActions.className = "wb-toolbar-actions";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "wb-toolbar-action-btn";
  undoBtn.title = "Undo (Ctrl/⌘+Z or U)";
  undoBtn.appendChild(createUndoIcon());
  undoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    undoLastChange();
  });

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "wb-toolbar-action-btn";
  redoBtn.title = "Redo (Ctrl/⌘+Shift+Z or Ctrl/⌘+Y)";
  redoBtn.appendChild(createRedoIcon());
  redoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    redoLastChange();
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "wb-toolbar-action-btn";
  copyBtn.title = "Copy (Ctrl/⌘+C or Ctrl/⌘+Insert)";
  copyBtn.appendChild(createCopyIcon());
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    copySelectionToClipboard();
  });

  const pasteBtn = document.createElement("button");
  pasteBtn.type = "button";
  pasteBtn.className = "wb-toolbar-action-btn";
  pasteBtn.title = "Paste (Ctrl/⌘+V or Shift+Insert)";
  pasteBtn.appendChild(createPasteIcon());
  pasteBtn.addEventListener("click", (e) => {
    e.preventDefault();
    pasteFromClipboard();
  });

  toolbarActions.appendChild(moveLeftBtn);
  toolbarActions.appendChild(moveRightBtn);
  toolbarActions.appendChild(deleteBlockBtn);
  toolbarActions.appendChild(undoBtn);
  toolbarActions.appendChild(redoBtn);
  toolbarActions.appendChild(copyBtn);
  toolbarActions.appendChild(pasteBtn);

  statsRow.appendChild(toolbarActions);

  const buttonSpecs = [
    {
      key: "recovery",
      label: "Recovery",
      shortLabel: "Z1",
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
      shortLabel: "Z2",
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
      shortLabel: "Z3",
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
      shortLabel: "Z4",
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
      shortLabel: "Z5",
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
      shortLabel: "Z6",
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
      powerLowRel: 0.5,
      powerHighRel: 0.75,
    },
    {
      key: "cooldown",
      label: "Cooldown",
      icon: "rampDown",
      shortcut: "C",
      kind: "cooldown",
      powerLowRel: 0.75,
      powerHighRel: 0.5,
    },
    {
      key: "intervals",
      label: "Intervals",
      icon: "intervals",
      shortcut: "I",
      kind: "intervals",
      repeat: 6,
      onDurationSec: 60,
      offDurationSec: 60,
      onPowerRel: 1.1,
      offPowerRel: 0.55,
    },
    {
      key: "freeride",
      label: "Freeride",
      icon: "freeride",
      shortcut: "F",
      kind: "freeride",
      durationSec: 300,
    },
    {
      key: "textevent",
      label: "Text",
      icon: "text",
      shortcut: "X",
      kind: "textevent",
    },
  ];
  const buttonSpecByKey = new Map(buttonSpecs.map((spec) => [spec.key, spec]));

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
    labelSpan.dataset.labelFull = spec.label;
    if (spec.shortLabel) {
      labelSpan.dataset.labelShort = spec.shortLabel;
    }
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
      insertBlockAtInsertionPoint(spec, { selectOnInsert: false });
    });

    toolbarButtons.appendChild(btn);
  });

  toolbar.appendChild(toolbarButtons);
  toolbar.appendChild(blockEditor);
  toolbarCard.appendChild(toolbar);

  const updateSteadyLabels = () => {
    if (!toolbarCard) return;
    const width = toolbarCard.clientWidth || 0;
    const hideLabels = width > 0 && width < 950;
    const compact = !hideLabels && width > 0 && width < 1260;
    const buttons = toolbarButtons.querySelectorAll(".wb-code-insert-btn");
    buttons.forEach((btn) => {
      const labelSpan = btn.querySelector("span");
      if (!labelSpan) return;
      if (hideLabels) {
        labelSpan.textContent = "";
        labelSpan.style.display = "none";
        btn.classList.add("wb-code-insert-btn--icon-only");
        return;
      }
      btn.classList.remove("wb-code-insert-btn--icon-only");
      labelSpan.style.display = "";
      const shortLabel = labelSpan.dataset.labelShort;
      if (!shortLabel) {
        labelSpan.textContent = labelSpan.dataset.labelFull || labelSpan.textContent;
        return;
      }
      labelSpan.textContent = compact ? shortLabel : labelSpan.dataset.labelFull;
    });
  };

  updateSteadyLabels();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => updateSteadyLabels());
    ro.observe(toolbarCard);
  } else {
    window.addEventListener("resize", updateSteadyLabels);
  }

  // Chart
  const chartCard = document.createElement("div");
  chartCard.className = "wb-card wb-chart-card";

  const chartContainer = document.createElement("div");
  chartContainer.className = "wb-chart-container";

  const chartMiniHost = document.createElement("div");
  chartMiniHost.className = "wb-chart-mini-host";

  chartContainer.appendChild(chartMiniHost);
  chartCard.appendChild(chartContainer);

  const textEventCard = document.createElement("div");
  textEventCard.className = "wb-card wb-text-event-card";
  textEventCard.style.display = "none";

  const textEventEditor = document.createElement("div");
  textEventEditor.className = "wb-text-event-editor";

  const textEventDurationField = createStepperField(
    {
      key: "textEventDurationSec",
      label: "Duration",
      tooltip: "How long the text event shows (seconds).",
      value: 10,
      unit: "s",
      kind: "duration",
    },
    (val) => updateSelectedTextEvent({ durationSec: val })
  );

  const textEventOffsetField = createStepperField(
    {
      key: "textEventOffsetSec",
      label: "Time",
      tooltip: "When this text event appears (seconds from start).",
      value: 0,
      unit: "s",
      kind: "timestamp",
      step: 30,
    },
    (val) => updateSelectedTextEvent({ offsetSec: val })
  );

  const textEventField = document.createElement("div");
  textEventField.className = "wb-block-field";

  const textEventLabel = document.createElement("label");
  textEventLabel.className = "wb-block-field-label";
  textEventLabel.textContent = "Text";

  const textEventInput = document.createElement("input");
  textEventInput.type = "text";
  textEventInput.id = "wbTextEventInput";
  textEventInput.className = "wb-text-event-input";
  textEventInput.placeholder = "Cue text";
  textEventLabel.setAttribute("for", textEventInput.id);
  textEventField.appendChild(textEventLabel);
  textEventField.appendChild(textEventInput);

  textEventEditor.appendChild(textEventDurationField.wrapper);
  textEventEditor.appendChild(textEventOffsetField.wrapper);
  textEventEditor.appendChild(textEventField);
  textEventCard.appendChild(textEventEditor);

  body.appendChild(statsCard);
  body.appendChild(chartCard);
  body.appendChild(textEventCard);
  body.appendChild(toolbarCard);
  body.appendChild(topRow);
  wrapper.appendChild(body);
  rootEl.appendChild(wrapper);

  setStatusMessage("Not checked yet.", "neutral");

  // ---------- Events ----------

  [nameField.input, sourceField.input, descField.textarea].forEach((el) => {
    el.addEventListener("input", () => {
      handleAnyChange();
    });
  });

  if (textEventInput) {
    textEventInput.addEventListener("input", () => {
      updateSelectedTextEvent({ text: textEventInput.value });
    });
  }

  const handleBuilderShortcuts = (e) => {
    if (e.defaultPrevented) return;
    if (!rootEl || rootEl.getClientRects().length === 0) return;
    const isMetaShortcut = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
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
    const currentBlocks = backend.getCurrentBlocks();
    const selectedBlockIndices = backend.getSelectedBlockIndices();
    const selectedBlockIndex = backend.getSelectedBlockIndex();
    const selectionCount = selectedBlockIndices.length;
    const hasSelection = selectionCount > 0;
    const hasTextEventSelection = selectedTextEventIndex != null;
    const singleSelection = selectionCount === 1;
    const block =
      singleSelection && selectedBlockIndex != null
        ? currentBlocks[selectedBlockIndex]
        : null;

    if (isMetaShortcut && !hasSelection) {
      if (!currentBlocks || !currentBlocks.length) return;
      if (lower === "a") {
        e.preventDefault();
        backend.setInsertAfterOverrideIndex(-1);
        renderChart();
        return;
      }
      if (lower === "e") {
        e.preventDefault();
        backend.setInsertAfterOverrideIndex(currentBlocks.length - 1);
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

    const isShiftInsert =
      !e.metaKey && !e.ctrlKey && e.shiftKey && key === "Insert";
    const isShiftDelete =
      !e.metaKey && !e.ctrlKey && e.shiftKey && key === "Delete";
    const isCtrlInsert =
      (e.metaKey || e.ctrlKey) && !e.altKey && key === "Insert";

    if (isMetaShortcut && lower === "c") {
      e.preventDefault();
      copySelectionToClipboard();
      return;
    }
    if (isMetaShortcut && lower === "x") {
      e.preventDefault();
      cutSelectionToClipboard();
      return;
    }
    if (isMetaShortcut && lower === "v") {
      e.preventDefault();
      pasteFromClipboard();
      return;
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && lower === "p") {
      e.preventDefault();
      pasteFromClipboard();
      return;
    }
    if (isCtrlInsert) {
      e.preventDefault();
      copySelectionToClipboard();
      return;
    }
    if (isShiftInsert) {
      e.preventDefault();
      pasteFromClipboard();
      return;
    }
    if (isShiftDelete) {
      e.preventDefault();
      cutSelectionToClipboard();
      return;
    }

    if (
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      e.shiftKey &&
      (lower === "h" ||
        lower === "l" ||
        key === "ArrowLeft" ||
        key === "ArrowRight")
    ) {
      e.preventDefault();
      const direction = lower === "h" || key === "ArrowLeft" ? -1 : 1;
      backend.shiftMoveSelection(direction);
      syncSelectionUi();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (selectionCount > 1 && lower === "y") {
      e.preventDefault();
      copySelectionToClipboard();
      backend.deselectBlock();
      syncSelectionUi({ withHistory: true });
      return;
    }

    const insertByKey = (specKey) => {
      const spec = buttonSpecByKey.get(specKey);
      if (!spec) return false;
      insertBlockAtInsertionPoint(spec, { selectOnInsert: true });
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
    if (lower === "f") {
      if (insertByKey("freeride")) e.preventDefault();
      return;
    }
    if (lower === "x") {
      if (insertByKey("textevent")) e.preventDefault();
      return;
    }

    if (lower === "d" || key === "Delete" || key === "Backspace") {
      if (hasTextEventSelection) {
        e.preventDefault();
        backend.deleteTextEvent(selectedTextEventIndex);
        clearSelectedTextEvent();
        handleAnyChange();
        return;
      }
      if (hasSelection) {
        e.preventDefault();
        if (lower === "d") {
          cutSelectionToClipboard();
        } else {
          deleteSelectedBlock();
        }
        return;
      }
      if (currentBlocks && currentBlocks.length) {
        const current =
          backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
        if (key === "Backspace") {
          const prev = current != null ? current : -1;
          if (prev >= 0) {
            e.preventDefault();
            backend.setSelectedBlock(prev);
            deleteSelectedBlock();
          }
        } else if (key === "Delete") {
          const next = current != null ? current + 1 : 0;
          if (next >= 0 && next < currentBlocks.length) {
            e.preventDefault();
            backend.setSelectedBlock(next);
            deleteSelectedBlock();
          }
        }
      }
      return;
    }

    if (key === "Escape" || key === "Enter") {
      if (hasSelection || hasTextEventSelection) {
        e.preventDefault();
        e.stopPropagation();
        if (hasSelection) {
          deselectBlock();
        } else {
          clearSelectedTextEvent();
        }
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
          backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
        const prev =
          current != null ? Math.min(current, currentBlocks.length - 1) : null;
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
        backend.getInsertAfterOverrideIndex() != null
          ? backend.getInsertAfterOverrideIndex()
          : backend.getInsertAfterIndex();
      if (singleSelection) return insertAfter === selectedBlockIndex;
      if (!selectedBlockIndices.length) return false;
      const last = selectedBlockIndices[selectedBlockIndices.length - 1];
      return insertAfter === last;
    };

    if (key === " " || e.code === "Space") {
      if (hasSelection) {
        e.preventDefault();
        e.stopPropagation();
        if (singleSelection) {
          const atEnd = isInsertionAtEndOfSelection();
          backend.setInsertAfterOverrideIndex(
            atEnd ? selectedBlockIndex - 1 : selectedBlockIndex,
          );
        } else {
          const first = selectedBlockIndices[0];
          const last = selectedBlockIndices[selectedBlockIndices.length - 1];
          const atEnd = backend.getInsertAfterOverrideIndex() === last;
          backend.setInsertAfterOverrideIndex(atEnd ? first - 1 : last);
        }
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
        backend.setInsertAfterOverrideIndex(-1);
        renderChart();
        return;
      }
      if (key === "End") {
        e.preventDefault();
        backend.setInsertAfterOverrideIndex(currentBlocks.length - 1);
        renderChart();
        return;
      }
      if (lower === "g") {
        e.preventDefault();
        backend.setInsertAfterOverrideIndex(-1);
        renderChart();
        return;
      }
      if (lower === "$") {
        e.preventDefault();
        backend.setInsertAfterOverrideIndex(currentBlocks.length - 1);
        renderChart();
        return;
      }
      if (lower === "h" || key === "ArrowLeft") {
        e.preventDefault();
        const current =
          backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
        const next = Math.max(
          -1,
          Math.min((current ?? -1) - 1, currentBlocks.length - 1),
        );
        backend.setInsertAfterOverrideIndex(next);
        renderChart();
      } else if (lower === "l" || key === "ArrowRight") {
        e.preventDefault();
        const current =
          backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
        const next = Math.max(
          -1,
          Math.min((current ?? -1) + 1, currentBlocks.length - 1),
        );
        backend.setInsertAfterOverrideIndex(next);
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
          backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
        const prevIndex = insertAfter != null ? insertAfter : -1;
        const nextIndex = prevIndex + 1;

        backend.applyPowerUpdatesAroundCursor(prevIndex, nextIndex, delta);
        handleAnyChange();
      }
      return;
    }

    if (!singleSelection) {
      return;
    }

    const adjustDuration = (current, delta) =>
      backend.clampDuration(current + delta);
    const durationStep = (current) => backend.getDurationStep(current);

    const handleDurationChange = (delta) => {
      if (!block) return;
      if (block.kind === "intervals") {
        const parts = backend.getIntervalParts(block);
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
      const current = backend.getBlockDurationSec(block);
      const next = adjustDuration(current, delta);
      applyBlockAttrUpdate(selectedBlockIndex, { durationSec: next });
    };

    const handlePowerChange = (delta) => {
      if (!block) return;
      if (block.kind === "freeride") {
        return;
      }
      if (block.kind === "steady") {
        const current = backend.getBlockSteadyPower(block);
        applyBlockAttrUpdate(selectedBlockIndex, {
          powerRel: backend.clampRel(current + delta),
        });
        return;
      }
      if (block.kind === "warmup" || block.kind === "cooldown") {
        const atEnd = isInsertionAtEndOfSelection();
        const current = atEnd
          ? backend.getRampHigh(block)
          : backend.getRampLow(block);
        applyBlockAttrUpdate(selectedBlockIndex, {
          [atEnd ? "powerHighRel" : "powerLowRel"]: backend.clampRel(
            current + delta,
          ),
        });
        return;
      }
      if (block.kind === "intervals") {
        const parts = backend.getIntervalParts(block);
        const atEnd = isInsertionAtEndOfSelection();
        applyBlockAttrUpdate(selectedBlockIndex, {
          [atEnd ? "offPowerRel" : "onPowerRel"]: backend.clampRel(
            (atEnd ? parts.offPowerRel : parts.onPowerRel) + delta,
          ),
        });
      }
    };

    if (lower === "h" || key === "ArrowLeft") {
      e.preventDefault();
      const step =
        block.kind === "intervals"
          ? durationStep(backend.getIntervalParts(block).onDurationSec)
          : durationStep(backend.getBlockDurationSec(block));
      handleDurationChange(-step * stepScale);
      return;
    }
    if (lower === "l" || key === "ArrowRight") {
      e.preventDefault();
      const step =
        block.kind === "intervals"
          ? durationStep(backend.getIntervalParts(block).onDurationSec)
          : durationStep(backend.getBlockDurationSec(block));
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
          backend.setPersistedState(saved);
          hydrateFromState(saved, { skipPersist: true });
        }
      }
    } catch (e) {
      console.warn("[WorkoutBuilder] Failed to load saved state:", e);
    }
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks || !currentBlocks.length) {
      clearState({ persist: true });
    } else {
      refreshLayout({ skipPersist: true });
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
      refreshLayout({ skipPersist: true });
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", onThemeChange);
    }
  }

  function getState() {
    syncMetaFromInputs();
    return backend.getCanonicalState();
  }

  function syncMetaFromInputs() {
    const title =
      (nameField.input.value || "Custom workout").trim() || "Custom workout";
    const source = (sourceField.input.value || "").trim();
    const description = descField.textarea.value || "";
    const sourceURL = (urlInput.value || "").trim();
    backend.setMeta({
      workoutTitle: title,
      source,
      description,
      sourceURL,
    });
  }

  function resetHistory() {
    backend.resetHistory();
    updateUndoRedoButtons();
  }

  function clearState(options = {}) {
    const { persist = true } = options;

    resetHistory();
    nameField.input.value = "";
    sourceField.input.value = "Me";
    descField.textarea.value = "";
    urlInput.value = "";

    backend.setDefaultBlocks();
    selectedTextEventIndex = null;
    if (!persist) {
      backend.setPersistedState(null);
      refreshLayout({ skipPersist: true });
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
    const hasBlocks = backend.getCurrentBlocks().length > 0;

    nameField.input.classList.remove("wb-input-error");
    sourceField.input.classList.remove("wb-input-error");
    descField.textarea.classList.remove("wb-input-error");

    /** @type {{field: string, message: string}[]} */
    const errors = [];

    if (!name) errors.push({ field: "name", message: "Name is required." });
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

  function handleAnyChange(opts = {}) {
    const { skipPersist = false } = opts;

    syncMetaFromInputs();
    const ftp = getCurrentFtp() || 0;
    backend.recomputeDerived(ftp);

    updateStats();
    renderChart();
    updateErrorStyling();
    updateBlockEditor();
    updateTextEventEditor();
    updateUndoRedoButtons();
    emitUiState();

    const state = getState();

    if (typeof onChange === "function") {
      onChange(state);
    }

    if (!skipPersist) {
      try {
        const toSave = { ...state, _shouldRestore: true };
        backend.setPersistedState(toSave);
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
    const currentMetrics = backend.getCurrentMetrics();
    const currentZone = backend.getCurrentZone();

    if (!currentMetrics || currentMetrics.totalSec === 0) {
      statTss.value.textContent = "--";
      statIf.value.textContent = "--";
      statKj.value.textContent = "--";
      statDuration.value.textContent = "--";
      statFtp.value.textContent = ftp > 0 ? `${Math.round(ftp)} W` : "--";
      statZone.value.textContent = currentZone || "--";
      return;
    }

    statTss.value.textContent =
      currentMetrics.tss != null
        ? String(Math.round(currentMetrics.tss))
        : "--";
    statIf.value.textContent =
      currentMetrics.ifValue != null ? currentMetrics.ifValue.toFixed(2) : "--";
    statKj.value.textContent =
      currentMetrics.kj != null ? String(Math.round(currentMetrics.kj)) : "--";
    statDuration.value.textContent =
      currentMetrics.totalSec != null
        ? formatDurationMinSec(currentMetrics.totalSec)
        : "--";
    statFtp.value.textContent =
      currentMetrics.ftp != null ? `${Math.round(currentMetrics.ftp)} W` : "--";
    statZone.value.textContent = currentZone || "--";
  }

  function renderChart() {
    const ftp = getCurrentFtp() || 0;
    const currentBlocks = backend.getCurrentBlocks();
    const selectedBlockIndex = backend.getSelectedBlockIndex();
    const selectedBlockIndices = backend.getSelectedBlockIndices();

    const prevScrollLeft = chartContainer ? chartContainer.scrollLeft : 0;
    chartMiniHost.innerHTML = "";
    try {
      renderBuilderWorkoutGraph(chartMiniHost, currentBlocks || [], ftp, {
        selectedBlockIndex,
        selectedBlockIndices,
        textEvents: backend.getTextEvents(),
        activeTextEventIndex: selectedTextEventIndex,
        insertAfterBlockIndex:
          dragInsertAfterIndex != null
            ? dragInsertAfterIndex
            : backend.getInsertAfterOverrideIndex() != null
              ? backend.getInsertAfterOverrideIndex()
              : backend.getInsertAfterIndex(),
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

  function syncSelectionUi(options = {}) {
    const { withHistory = false } = options;
    if (withHistory) {
      backend.startHistoryGroup();
    }
    updateBlockEditor();
    renderChart();
    emitUiState();
  }

  function ensureChartFocusVisible() {
    if (!chartContainer || !chartMiniHost) return;
    const svg = chartMiniHost.querySelector("svg");
    if (!svg) return;
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks || !currentBlocks.length) return;

    const { timings, totalSec } = backend.buildBlockTimings(currentBlocks);
    if (!timings.length) return;

    const svgRect = svg.getBoundingClientRect();
    const svgWidth = svgRect.width || svg.clientWidth || 1;
    const timelineSec = Math.max(3600, totalSec || 0);

    let focusTimeSec = null;
    const selectedBlockIndex = backend.getSelectedBlockIndex();
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
          : backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex();
      if (insertAfter != null) {
        const timing =
          insertAfter < 0
            ? { tEnd: 0 }
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
    return backend.getSelectedBlock();
  }

  function getSelectedTextEvent() {
    if (selectedTextEventIndex == null) return null;
    const events = backend.getTextEvents();
    return events[selectedTextEventIndex] || null;
  }

  function setSelectedTextEventIndex(index) {
    if (index == null || !Number.isFinite(index)) {
      selectedTextEventIndex = null;
      updateTextEventEditor();
      updateBlockEditor();
      return;
    }
    selectedTextEventIndex = index;
    backend.deselectBlock();
    updateTextEventEditor();
    updateBlockEditor();
    renderChart();
  }

  function clearSelectedTextEvent() {
    if (selectedTextEventIndex == null) return;
    selectedTextEventIndex = null;
    updateTextEventEditor();
    updateBlockEditor();
    renderChart();
  }

  function updateSelectedTextEvent(updates) {
    if (selectedTextEventIndex == null) return;
    backend.updateTextEvent(selectedTextEventIndex, updates);
    handleAnyChange();
  }

  function setSelectedBlock(idx) {
    clearSelectedTextEvent();
    backend.setSelectedBlock(idx);
    syncSelectionUi({ withHistory: true });
  }

  function deselectBlock() {
    clearSelectedTextEvent();
    backend.deselectBlock();
    syncSelectionUi({ withHistory: true });
  }

  function handleBlockSelectionFromChart(idx, opts = {}) {
    if (idx == null) {
      deselectBlock();
      return;
    }
    if (opts.shiftKey) {
      const selection = backend.getSelectionSnapshot();
      const anchor =
        selection.selectionAnchorIndex != null
          ? selection.selectionAnchorIndex
          : selection.selectedBlockIndex;
      if (anchor == null || anchor === idx) {
        setSelectedBlock(idx);
        return;
      }
      const isRight = idx > anchor;
      const anchorCursor = backend.clampCursorIndex(
        isRight ? anchor - 1 : anchor,
      );
      const cursorIndex = backend.clampCursorIndex(isRight ? idx : idx - 1);
      backend.setInsertAfterOverrideIndex(cursorIndex);
      backend.setSelectionFromCursors(anchorCursor, cursorIndex, {
        preserveInsert: true,
      });
      syncSelectionUi();
    } else {
      setSelectedBlock(idx);
    }
  }

  function handleInsertAfterFromChart(idx) {
    clearSelectedTextEvent();
    backend.setInsertAfterIndex(idx);
    syncSelectionUi({ withHistory: true });
  }

  function handleInsertAfterFromSegment(idx) {
    backend.setInsertAfterOverrideIndex(idx);
    syncSelectionUi();
  }

  function emitUiState() {
    if (typeof onUiStateChange !== "function") return;
    onUiStateChange({ hasSelection: backend.hasSelection() });
  }

  function getSelectedIndicesSorted() {
    return backend.getSelectedIndicesSorted();
  }

  async function copySelectionToClipboard() {
    if (!backend.hasSelection()) {
      return;
    }
    const indices = getSelectedIndicesSorted();
    const blocks = indices
      .map((idx) => backend.getCurrentBlocks()[idx])
      .filter(Boolean);
    const rawSegments = backend.buildRawSegmentsFromBlocks(blocks);
    if (!rawSegments.length) {
      return;
    }
    const canonical = {
      source: "Me",
      sourceURL: "",
      workoutTitle: "Clipboard",
      rawSegments,
      description: "",
    };
    try {
      const xml = canonicalWorkoutToZwoXml(canonical);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(xml);
        return;
      }
      console.warn("[WorkoutBuilder] Clipboard writeText not available.");
    } catch (err) {
      console.warn("[WorkoutBuilder] Clipboard write failed:", err);
    }
  }

  async function cutSelectionToClipboard() {
    await copySelectionToClipboard();
    deleteSelectedBlock();
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.warn("[WorkoutBuilder] Clipboard read failed:", err);
      return;
    }
    if (!text) return;
    const canonical = parseZwoXmlToCanonicalWorkout(text);
    if (!canonical || !Array.isArray(canonical.rawSegments)) return;
    const blocks = backend.segmentsToBlocks(canonical.rawSegments);
    if (!blocks.length) return;
    backend.insertBlocksAtInsertionPoint(blocks, { selectOnInsert: false });
    handleAnyChange();
  }

  function applyMetaFromBackend() {
    const meta = backend.getMeta();
    nameField.input.value = meta.workoutTitle || "";
    sourceField.input.value = meta.source || "";
    descField.textarea.value = meta.description || "";
    urlInput.value = meta.sourceURL || "";
    autoGrowTextarea(descField.textarea);
  }

  function undoLastChange() {
    backend.undoLastChange();
    applyMetaFromBackend();
    refreshLayout();
  }

  function redoLastChange() {
    backend.redoLastChange();
    applyMetaFromBackend();
    refreshLayout();
  }

  function updateUndoRedoButtons() {
    const history = backend.getHistoryStatus();
    if (undoBtn) undoBtn.disabled = !history.canUndo;
    if (redoBtn) redoBtn.disabled = !history.canRedo;
    if (copyBtn) copyBtn.disabled = !backend.hasSelection();
  }

  function computeInsertIndexFromPoint(blockIndex, segIndex, clientX) {
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks || !currentBlocks.length) return null;
    const svg = chartMiniHost ? chartMiniHost.querySelector("svg") : null;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 1;
    const clampedX = Math.max(0, Math.min(width, clientX - rect.left));
    const { totalSec } = backend.buildBlockTimings(currentBlocks);
    const timelineSec = Math.max(3600, totalSec || 0);
    const timeSec = (clampedX / width) * timelineSec;

    const { timings: blockTimings } = backend.buildBlockTimings(currentBlocks);
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

    const { timings: segmentTimings } =
      backend.buildSegmentTimings(currentBlocks);
    const seg = segmentTimings.find(
      (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
    );
    if (seg) {
      const mid = (seg.tStart + seg.tEnd) / 2;
      return timeSec < mid ? blockIndex - 1 : blockIndex;
    }

    return blockIndex;
  }

  function reorderBlocks(fromIndex, insertAfterIndex) {
    const didMove = backend.reorderBlocks(fromIndex, insertAfterIndex);
    if (!didMove) return;
    dragInsertAfterIndex = null;
    handleAnyChange();
  }

  function updateErrorStyling() {
    const currentBlocks = backend.getCurrentBlocks();
    const currentErrors = backend.getCurrentErrors();
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
    backend.setPersistedState(null);
    try {
      if (typeof clearWorkoutBuilderState === "function") {
        await clearWorkoutBuilderState();
      }
    } catch (err) {
      console.warn(
        "[WorkoutBuilder] Failed to clear saved builder state:",
        err,
      );
    }
  }

  function hydrateFromState(state, opts = {}) {
    const { skipPersist = false } = opts;

    if (!state || !Array.isArray(state.rawSegments)) return;

    resetHistory();
    nameField.input.value = state.workoutTitle || "";
    sourceField.input.value = state.source || "";
    descField.textarea.value = state.description || "";
    urlInput.value = state.sourceURL || "";
    backend.setMeta({
      workoutTitle: nameField.input.value,
      source: sourceField.input.value,
      description: descField.textarea.value,
      sourceURL: urlInput.value,
    });
    backend.commitBlocks(backend.segmentsToBlocks(state.rawSegments), {
      selectIndex: null,
    });
    backend.setTextEvents(state.textEvents || []);
    selectedTextEventIndex = null;

    if (skipPersist) {
      refreshLayout({ skipPersist: true });
    } else {
      refreshLayout();
    }
  }

  async function restorePersistedStateOrDefault() {
    const persistedState = backend.getPersistedState();
    if (
      persistedState &&
      Array.isArray(persistedState.rawSegments) &&
      persistedState.rawSegments.length
    ) {
      hydrateFromState(persistedState, { skipPersist: true });
      return true;
    }

    clearState({ persist: true });
    return false;
  }

  function updateBlockEditor() {
    if (!blockEditor || !toolbarButtons) return;

    if (selectedTextEventIndex != null) {
      if (toolbarCard) {
        toolbarCard.style.display = "none";
      }
      toolbarButtons.style.display = "none";
      blockEditor.style.display = "none";
      blockEditorFields.innerHTML = "";
      moveLeftBtn.style.display = "none";
      moveRightBtn.style.display = "none";
      deleteBlockBtn.style.display = "none";
      return;
    }

    if (toolbarCard) {
      toolbarCard.style.display = "";
    }

    const selectionCount = backend.getSelectedBlockIndices().length;
    const block = getSelectedBlock();
    if (!selectionCount) {
      toolbarButtons.style.display = "";
      blockEditor.style.display = "none";
      blockEditorFields.innerHTML = "";
      moveLeftBtn.style.display = "none";
      moveRightBtn.style.display = "none";
      deleteBlockBtn.style.display = "none";
      return;
    }

    toolbarButtons.style.display = "none";
    blockEditor.style.display = "flex";
    blockEditorFields.innerHTML = "";
    deleteBlockBtn.style.display = "";

    if (!block) {
      toolbarButtons.style.display = "";
      blockEditor.style.display = "none";
      blockEditorFields.innerHTML = "";
      moveLeftBtn.style.display = "none";
      moveRightBtn.style.display = "none";
      deleteBlockBtn.style.display = "none";
      return;
    }

    if (selectionCount > 1) {
      moveLeftBtn.style.display = "none";
      moveRightBtn.style.display = "none";
      return;
    }

    moveLeftBtn.style.display = "";
    moveRightBtn.style.display = "";

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
    const idx = backend.getSelectedBlockIndex();
    const list = [];
    const durationSec = Math.round(backend.getBlockDurationSec(block));

    const commitDuration = (val) =>
      applyBlockAttrUpdate(idx, { durationSec: backend.clampDuration(val) });

    if (block.kind === "steady") {
      const powerPct = Math.round(backend.getBlockSteadyPower(block) * 100);
      const cadence = backend.getBlockCadence(block);
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
            powerRel: backend.clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "cadenceRpm",
        label: "Cadence",
        tooltip: "Target cadence (rpm). Leave empty for no target.",
        value: cadence,
        unit: "rpm",
        kind: "cadence",
        step: 5,
        allowEmpty: true,
        defaultValue: 90,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, { cadenceRpm: val }),
      });
    } else if (block.kind === "warmup" || block.kind === "cooldown") {
      const lowPct = Math.round(backend.getRampLow(block) * 100);
      const highPct = Math.round(backend.getRampHigh(block) * 100);
      const cadence = backend.getBlockCadence(block);
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
            powerLowRel: backend.clampPowerPercent(val) / 100,
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
            powerHighRel: backend.clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "cadenceRpm",
        label: "Cadence",
        tooltip: "Target cadence (rpm). Leave empty for no target.",
        value: cadence,
        unit: "rpm",
        kind: "cadence",
        step: 5,
        allowEmpty: true,
        defaultValue: 90,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, { cadenceRpm: val }),
      });
    } else if (block.kind === "freeride") {
      list.push({
        key: "durationSec",
        label: "Duration",
        tooltip: "Length of this free ride block (seconds).",
        value: durationSec,
        unit: "s",
        kind: "duration",
        onCommit: commitDuration,
      });
    } else if (block.kind === "intervals") {
      const intervals = backend.getIntervalParts(block);
      list.push({
        key: "repeat",
        label: "Reps",
        tooltip: "Number of on/off pairs.",
        value: Math.max(1, Math.round(intervals.repeat)),
        unit: "",
        kind: "repeat",
        step: 1,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, { repeat: backend.clampRepeat(val) }),
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
            onDurationSec: backend.clampDuration(val),
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
        hideLabel: true,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            onPowerRel: backend.clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "onCadenceRpm",
        label: "Cadence",
        tooltip: "Work interval cadence (rpm). Leave empty for no target.",
        value: intervals.onCadenceRpm,
        unit: "rpm",
        kind: "cadence",
        step: 5,
        allowEmpty: true,
        defaultValue: 90,
        hideLabel: true,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, { onCadenceRpm: val }),
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
            offDurationSec: backend.clampDuration(val),
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
        hideLabel: true,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, {
            offPowerRel: backend.clampPowerPercent(val) / 100,
          }),
      });
      list.push({
        key: "offCadenceRpm",
        label: "Cadence",
        tooltip: "Recovery cadence (rpm). Leave empty for no target.",
        value: intervals.offCadenceRpm,
        unit: "rpm",
        kind: "cadence",
        step: 5,
        allowEmpty: true,
        defaultValue: 90,
        hideLabel: true,
        onCommit: (val) =>
          applyBlockAttrUpdate(idx, { offCadenceRpm: val }),
      });
    }

    return list;
  }

  function updateTextEventEditor() {
    if (!textEventCard) return;
    const evt = getSelectedTextEvent();
    if (!evt) {
      textEventCard.style.display = "none";
      return;
    }

    textEventCard.style.display = "flex";
    if (textEventDurationField?.input) {
      textEventDurationField.input.value = String(
        Math.max(1, Math.round(evt.durationSec || 10)),
      );
    }
    if (textEventOffsetField?.input) {
      textEventOffsetField.input.value = String(
        Math.max(0, Math.round(evt.offsetSec || 0)),
      );
    }
    if (textEventInput) {
      textEventInput.value = evt.text || "";
    }
  }

  function createStepperField(config, onCommit) {
    const wrapper = document.createElement("div");
    wrapper.className = "wb-block-field";

    if (config.hideLabel) {
      wrapper.classList.add("wb-block-field--nolabel");
      if (config.tooltip) wrapper.title = config.tooltip;
    } else {
      const label = document.createElement("label");
      label.className = "wb-block-field-label";
      label.textContent = config.label || "";
      if (config.tooltip) label.title = config.tooltip;
      wrapper.appendChild(label);
    }

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
    if (config.allowEmpty && !Number.isFinite(config.value)) {
      input.value = "";
    } else {
      input.value = Number.isFinite(config.value) ? String(config.value) : "0";
    }
    input.inputMode = "numeric";
    if (Number.isFinite(config.step)) {
      input.step = String(config.step);
    }

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "control-btn";
    plus.textContent = "+";

    if (config.kind === "duration") {
      minus.title = "Decrease duration (H / \u2190)";
      plus.title = "Increase duration (L / \u2192)";
    } else if (config.kind === "power") {
      minus.title = "Decrease power (J / \u2193 / Shift+J)";
      plus.title = "Increase power (K / \u2191 / Shift+K)";
    } else if (config.kind === "cadence") {
      minus.title = "Decrease cadence (J / \u2193)";
      plus.title = "Increase cadence (K / \u2191)";
    } else if (config.kind === "timestamp") {
      minus.title = "Move earlier";
      plus.title = "Move later";
    }

    const commitValue = (raw) => {
      if (config.allowEmpty && (raw == null || String(raw).trim() === "")) {
        if (typeof onCommit === "function") {
          onCommit(null);
        }
        return;
      }
      const n = Number(raw);
      const base = Number.isFinite(n) ? n : Number(config.value) || 0;
      if (typeof onCommit === "function") {
        onCommit(base);
      }
    };

    minus.addEventListener("click", (e) => {
      e.preventDefault();
      if (config.allowEmpty && input.value.trim() === "") {
        const fallback = Number(config.defaultValue);
        if (Number.isFinite(fallback)) {
          input.value = String(fallback);
          commitValue(fallback);
        }
        return;
      }
      const current = Number(input.value);
      const step =
        config.kind === "duration"
          ? backend.getDurationStep(Number.isFinite(current) ? current : 0)
          : Number(config.step) || 1;
      const next = Number.isFinite(current) ? current - step : step * -1;
      input.value = String(next);
      commitValue(next);
    });

    plus.addEventListener("click", (e) => {
      e.preventDefault();
      if (config.allowEmpty && input.value.trim() === "") {
        const fallback = Number(config.defaultValue);
        if (Number.isFinite(fallback)) {
          input.value = String(fallback);
          commitValue(fallback);
        }
        return;
      }
      const current = Number(input.value);
      const step =
        config.kind === "duration"
          ? backend.getDurationStep(Number.isFinite(current) ? current : 0)
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
    return { wrapper, input };
  }

  function applyBlockAttrUpdate(blockIndex, attrs) {
    if (blockIndex == null) return;
    backend.applyBlockAttrUpdate(blockIndex, attrs);
    handleAnyChange();
  }

  function deleteSelectedBlock() {
    backend.deleteSelectedBlock();
    handleAnyChange();
  }

  function moveSelectedBlock(direction) {
    backend.moveSelectedBlock(direction);
    handleAnyChange();
  }

  function createWorkoutElementIcon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.classList.add("wb-code-icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");

    switch (kind) {
      case "steady":
        path.setAttribute("d", "M6 6h12v12H6z");
        break;
      case "freeride":
        path.setAttribute(
          "d",
          "M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0v8H3z",
        );
        break;
      case "rampUp":
        path.setAttribute("d", "M4 20 L20 20 20 8 4 16 Z");
        break;
      case "rampDown":
        path.setAttribute("d", "M4 8 L20 16 20 20 4 20 Z");
        break;
      case "text":
        path.setAttribute("d", "M5 5h14v10H10l-5 4v-4H5z");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "1.8");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        ["M8 9h8", "M8 12h6"].forEach((d) => {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
          line.setAttribute("d", d);
          line.setAttribute("fill", "none");
          line.setAttribute("stroke", "currentColor");
          line.setAttribute("stroke-width", "1.8");
          line.setAttribute("stroke-linecap", "round");
          svg.appendChild(line);
        });
        return svg;
      case "intervals":
      default:
        path.setAttribute("d", "M4 20h4v-8H4zm6 0h4v-14h-4zm6 0h4v-10h-4z");
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

  function createCopyIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const r1 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r1.setAttribute("x", "8");
    r1.setAttribute("y", "8");
    r1.setAttribute("width", "10");
    r1.setAttribute("height", "10");
    r1.setAttribute("rx", "2");
    r1.setAttribute("fill", "none");
    r1.setAttribute("stroke", "currentColor");
    r1.setAttribute("stroke-width", "2");
    const r2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r2.setAttribute("x", "4");
    r2.setAttribute("y", "4");
    r2.setAttribute("width", "10");
    r2.setAttribute("height", "10");
    r2.setAttribute("rx", "2");
    r2.setAttribute("fill", "none");
    r2.setAttribute("stroke", "currentColor");
    r2.setAttribute("stroke-width", "2");
    svg.appendChild(r2);
    svg.appendChild(r1);
    return svg;
  }

  function createPasteIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "6");
    rect.setAttribute("y", "7");
    rect.setAttribute("width", "12");
    rect.setAttribute("height", "13");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "currentColor");
    rect.setAttribute("stroke-width", "2");
    const clip = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clip.setAttribute("x", "9");
    clip.setAttribute("y", "3");
    clip.setAttribute("width", "6");
    clip.setAttribute("height", "4");
    clip.setAttribute("rx", "1.5");
    clip.setAttribute("fill", "none");
    clip.setAttribute("stroke", "currentColor");
    clip.setAttribute("stroke-width", "2");
    svg.appendChild(rect);
    svg.appendChild(clip);
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

    return { wrapper, input };
  }

  function createLabeledTextarea(labelText) {
    const wrapper = document.createElement("div");
    wrapper.className = "wb-field";

    const label = document.createElement("label");
    label.className = "wb-field-label";
    label.textContent = labelText;

    const textarea = document.createElement("textarea");
    textarea.className = "wb-field-textarea";

    wrapper.appendChild(label);
    wrapper.appendChild(textarea);

    return { wrapper, textarea };
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
    return { el, value: valueEl };
  }

  function insertBlockAtInsertionPoint(spec, options = {}) {
    if (spec?.kind === "textevent") {
      return insertTextEventAtInsertionPoint();
    }
    const insertIndex = backend.insertBlockAtInsertionPoint(spec, options);
    handleAnyChange();
    return insertIndex;
  }

  function insertTextEventAtInsertionPoint() {
    const currentBlocks = backend.getCurrentBlocks();
    const { timings } = backend.buildBlockTimings(currentBlocks);
    const insertAfter =
      dragInsertAfterIndex != null
        ? dragInsertAfterIndex
        : backend.getInsertAfterOverrideIndex() != null
          ? backend.getInsertAfterOverrideIndex()
          : backend.getInsertAfterIndex();
    let offsetSec = 0;
    if (timings.length) {
      const safeIndex =
        insertAfter == null
          ? -1
          : Math.max(-1, Math.min(insertAfter, timings.length - 1));
      if (safeIndex >= 0) {
        offsetSec = timings[safeIndex]?.tEnd || 0;
      }
    }
    const nextIndex = backend.addTextEvent({
      offsetSec,
      durationSec: 10,
      text: "",
    });
    selectedTextEventIndex = nextIndex;
    handleAnyChange();
    return nextIndex;
  }

  function handleChartPointerDown(e) {
    blurBuilderInputs();
    if (e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (!chartMiniHost) return;
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks || !currentBlocks.length) return;
    const activeEl = document.elementFromPoint(e.clientX, e.clientY);
    const textEventEl =
      activeEl && activeEl.closest
        ? activeEl.closest("[data-text-event-index]")
        : null;
    if (textEventEl && chartMiniHost.contains(textEventEl)) {
      const textEventIndex = Number(textEventEl.dataset.textEventIndex);
      if (!Number.isFinite(textEventIndex)) return;
      const svg = chartMiniHost.querySelector("svg");
      if (!svg) return;
      e.preventDefault();
      if (textEventEl.setPointerCapture) {
        textEventEl.setPointerCapture(e.pointerId);
      }

      const rect = svg.getBoundingClientRect();
      const { totalSec } = backend.buildSegmentTimings(currentBlocks);
      const timelineSec = Math.max(3600, totalSec || 0);
      const events = backend.getTextEvents();
      const evt = events[textEventIndex];
      if (!evt) return;

      setSelectedTextEventIndex(textEventIndex);
      dragState = {
        pointerId: e.pointerId,
        handle: "text-event",
        textEventIndex,
        rect,
        width: rect.width,
        height: rect.height,
        timelineSec,
        totalSec: totalSec || 0,
        startOffsetSec: evt.offsetSec || 0,
        startClientX: e.clientX,
        startClientY: e.clientY,
        didDrag: false,
      };
      chartMiniHost.dataset.dragTextEventIndex = String(textEventIndex);
      document.body.classList.add("wb-dragging");
      window.addEventListener("pointermove", handleChartPointerMove);
      window.addEventListener("pointerup", handleChartPointerUp);
      window.addEventListener("pointercancel", handleChartPointerUp);
      return;
    }
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

    const { timings: segmentTimings, totalSec } =
      backend.buildSegmentTimings(currentBlocks);
    const { timings: blockTimings } = backend.buildBlockTimings(currentBlocks);
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
      backend.setInsertAfterOverrideIndex(insertIdx);
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
      startLow: backend.getRampLow(block),
      startHigh: backend.getRampHigh(block),
      startPower: backend.getBlockSteadyPower(block),
      startOnPower: backend.getIntervalParts(block).onPowerRel,
      startOffPower: backend.getIntervalParts(block).offPowerRel,
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
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks || !currentBlocks.length) return;
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
    const { timings: blockTimings, totalSec } =
      backend.buildBlockTimings(currentBlocks);
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

    if (handle === "text-event") {
      const timeSec = (clampedX / Math.max(1, width)) * effectiveTimelineSec;
      const snapped = Math.round(timeSec / 30) * 30;
      const maxOffset = Math.max(0, totalSec || 0);
      const nextOffset = Math.max(0, Math.min(maxOffset, snapped));
      updateSelectedTextEvent({ offsetSec: nextOffset });
      return;
    }

    if (handle === "move") {
      const timeSec = (clampedX / Math.max(1, width)) * effectiveTimelineSec;
      const { timings: segmentTimings } =
        backend.buildSegmentTimings(currentBlocks);
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
    const powerRel = backend.snapPowerRel(powerW / Math.max(1, ftp));

    if (handle === "top") {
      if (blockKind === "steady") {
        applyBlockAttrUpdate(blockIndex, { powerRel });
        return;
      }

      if (blockKind === "warmup" || blockKind === "cooldown") {
        if (rampRegion === "left") {
          applyBlockAttrUpdate(blockIndex, { powerLowRel: powerRel });
        } else if (rampRegion === "right") {
          applyBlockAttrUpdate(blockIndex, { powerHighRel: powerRel });
        } else {
          const startMid = (startLow + startHigh) / 2;
          const delta = powerRel - startMid;
          applyBlockAttrUpdate(blockIndex, {
            powerLowRel: backend.clampRel(startLow + delta),
            powerHighRel: backend.clampRel(startHigh + delta),
          });
        }
        return;
      }

      if (blockKind === "intervals") {
        const role = segIndex % 2 === 0 ? "on" : "off";
        if (role === "on") {
          if (powerRel !== startOnPower) {
            applyBlockAttrUpdate(blockIndex, { onPowerRel: powerRel });
          }
        } else if (powerRel !== startOffPower) {
          applyBlockAttrUpdate(blockIndex, { offPowerRel: powerRel });
        }
      }
      return;
    }

    if (handle === "right") {
      const timeSec = (clampedX / Math.max(1, width)) * effectiveTimelineSec;
      const duration = backend.snapDurationSec(timeSec - tStart);

      if (
        blockKind === "steady" ||
        blockKind === "freeride" ||
        blockKind === "warmup" ||
        blockKind === "cooldown"
      ) {
        applyBlockAttrUpdate(blockIndex, { durationSec: duration });
        return;
      }

      if (blockKind === "intervals") {
        const role = segIndex % 2 === 0 ? "on" : "off";
        const parts = backend.getIntervalParts(currentBlocks[blockIndex] || {});
        const repIndex = Math.floor(segIndex / 2);
        const scale = Math.max(1, repIndex + 1);
        if (role === "on") {
          const rawDuration =
            (timeSec - blockStartSec - repIndex * parts.offDurationSec) / scale;
          applyBlockAttrUpdate(blockIndex, {
            onDurationSec: backend.snapDurationSec(rawDuration),
          });
        } else {
          const rawDuration =
            (timeSec - blockStartSec - scale * parts.onDurationSec) / scale;
          applyBlockAttrUpdate(blockIndex, {
            offDurationSec: backend.snapDurationSec(rawDuration),
          });
        }
        return;
      }
    }
  }

  function handleChartPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const { handle, blockIndex, textEventIndex } = dragState;

    if (handle === "text-event") {
      if (!dragState.didDrag && Number.isFinite(textEventIndex)) {
        setSelectedTextEventIndex(textEventIndex);
      }
      dragState = null;
      if (chartMiniHost) {
        chartMiniHost.removeAttribute("data-drag-text-event-index");
      }
      document.body.classList.remove("wb-dragging");
      window.removeEventListener("pointermove", handleChartPointerMove);
      window.removeEventListener("pointerup", handleChartPointerUp);
      window.removeEventListener("pointercancel", handleChartPointerUp);
      return;
    }

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
        backend.setInsertAfterOverrideIndex(insertIdx);
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
      chartMiniHost.removeAttribute("data-drag-text-event-index");
    }
    document.body.classList.remove("wb-dragging");
    window.removeEventListener("pointermove", handleChartPointerMove);
    window.removeEventListener("pointerup", handleChartPointerUp);
    window.removeEventListener("pointercancel", handleChartPointerUp);
  }

  function blurBuilderInputs() {
    if (!rootEl) return;
    const inputs = rootEl.querySelectorAll("input, textarea, select");
    inputs.forEach((el) => {
      if (typeof el.blur === "function") {
        el.blur();
      }
    });
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
