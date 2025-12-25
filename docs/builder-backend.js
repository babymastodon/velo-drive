// builder-backend.js

import {
  computeMetricsFromSegments,
  inferZoneFromSegments,
} from "./workout-metrics.js";

export function createBuilderBackend() {
  const FREERIDE_POWER_REL = 0.5;
  let nextBlockId = 1;
  const state = {
    meta: {
      workoutTitle: "",
      source: "Me",
      description: "",
      sourceURL: "",
    },
    currentRawSegments: [],
    currentErrors: [],
    currentBlocks: [],
    currentMetrics: null,
    currentZone: null,
    persistedState: null,
    textEvents: [],
    selectedBlockIndex: null,
    selectedBlockIndices: [],
    selectionAnchorIndex: null,
    selectionAnchorCursorIndex: null,
    insertAfterOverrideIndex: null,
    undoStack: [],
    redoStack: [],
    historyGroupHasUndo: false,
    historyPendingSnapshot: null,
    isHistoryRestoring: false,
  };

  function getMeta() {
    return { ...state.meta };
  }

  function setMeta(nextMeta) {
    state.meta = {
      ...state.meta,
      ...(nextMeta || {}),
    };
  }

  function getCanonicalState() {
    return {
      source: state.meta.source,
      sourceURL: state.meta.sourceURL,
      workoutTitle: state.meta.workoutTitle,
      rawSegments: state.currentRawSegments.slice(),
      description: state.meta.description,
      textEvents: stripTextEventAnchors(resolveTextEvents(state.textEvents)),
    };
  }

  function setPersistedState(snapshot) {
    state.persistedState = snapshot || null;
  }

  function getPersistedState() {
    return state.persistedState;
  }

  function getCurrentBlocks() {
    return state.currentBlocks;
  }

  function getCurrentRawSegments() {
    return state.currentRawSegments;
  }

  function getCurrentMetrics() {
    return state.currentMetrics;
  }

  function getCurrentZone() {
    return state.currentZone;
  }

  function getCurrentErrors() {
    return state.currentErrors;
  }

  function getTextEvents() {
    return stripTextEventAnchors(resolveTextEvents(state.textEvents));
  }

  function setTextEvents(events) {
    state.textEvents = normalizeTextEvents(events, state.currentBlocks);
  }

  function addTextEvent(event) {
    const next = normalizeTextEvent(event, state.currentBlocks);
    recordHistorySnapshot();
    state.textEvents = normalizeTextEvents(
      [...(state.textEvents || []), next],
      state.currentBlocks,
    );
    return state.textEvents.length - 1;
  }

  function updateTextEvent(index, updates) {
    if (!Number.isFinite(index) || index < 0) return;
    if (!Array.isArray(state.textEvents) || !state.textEvents[index]) return;
    recordHistorySnapshot();
    const current = state.textEvents[index];
    const hasOffsetUpdate =
      updates && Object.prototype.hasOwnProperty.call(updates, "offsetSec");
    const merged = {
      ...current,
      ...(updates || {}),
    };
    if (hasOffsetUpdate && updates.anchor === undefined) {
      merged.anchor = null;
    }
    const next = normalizeTextEvent(merged, state.currentBlocks);
    const updated = state.textEvents.slice();
    updated[index] = next;
    state.textEvents = normalizeTextEvents(updated, state.currentBlocks);
  }

  function deleteTextEvent(index) {
    if (!Number.isFinite(index) || index < 0) return;
    if (!Array.isArray(state.textEvents) || !state.textEvents[index]) return;
    recordHistorySnapshot();
    state.textEvents = state.textEvents.filter((_, idx) => idx !== index);
  }

  function getSelectionSnapshot() {
    return {
      selectedBlockIndex: state.selectedBlockIndex,
      selectedBlockIndices: state.selectedBlockIndices.slice(),
      selectionAnchorIndex: state.selectionAnchorIndex,
      selectionAnchorCursorIndex: state.selectionAnchorCursorIndex,
    };
  }

  function getSelectedBlockIndex() {
    return state.selectedBlockIndex;
  }

  function getSelectedBlockIndices() {
    return state.selectedBlockIndices.slice();
  }

  function getInsertAfterOverrideIndex() {
    return state.insertAfterOverrideIndex;
  }

  function setInsertAfterOverrideIndex(idx) {
    state.insertAfterOverrideIndex = idx;
  }

  function hasSelection() {
    return state.selectedBlockIndices.length > 0;
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
    state.currentBlocks = [warmup, steady, intervals, cooldown];
    state.currentRawSegments = buildRawSegmentsFromBlocks(state.currentBlocks);
    state.currentErrors = [];
    state.textEvents = [];
  }

  function recomputeDerived(ftp) {
    state.currentRawSegments = buildRawSegmentsFromBlocks(state.currentBlocks);
    state.currentErrors = [];
    if (
      state.selectedBlockIndex != null &&
      !state.currentBlocks[state.selectedBlockIndex]
    ) {
      state.selectedBlockIndex = null;
    }
    if (
      state.insertAfterOverrideIndex == null &&
      state.selectedBlockIndex == null &&
      state.currentBlocks.length
    ) {
      state.insertAfterOverrideIndex = state.currentBlocks.length - 1;
    }

    if (state.currentRawSegments.length && ftp > 0) {
      state.currentMetrics = computeMetricsFromSegments(
        state.currentRawSegments,
        ftp,
      );
      state.currentZone = inferZoneFromSegments(state.currentRawSegments);
    } else {
      state.currentMetrics = {
        totalSec: 0,
        durationMin: 0,
        ifValue: null,
        tss: null,
        kj: null,
        ftp: ftp || null,
      };
      state.currentZone = null;
    }
  }

  function getSelectedBlock() {
    if (
      state.selectedBlockIndices.length !== 1 ||
      state.selectedBlockIndex == null ||
      !state.currentBlocks ||
      !state.currentBlocks[state.selectedBlockIndex]
    ) {
      return null;
    }
    return state.currentBlocks[state.selectedBlockIndex];
  }

  function setSelectedBlock(idx) {
    const next =
      idx == null ||
      !Number.isFinite(idx) ||
      idx < 0 ||
      !state.currentBlocks ||
      idx >= state.currentBlocks.length
        ? null
        : idx;

    if (
      next === state.selectedBlockIndex &&
      state.selectedBlockIndices.length === 1
    ) {
      return;
    }
    state.selectedBlockIndex = next;
    state.selectedBlockIndices = next == null ? [] : [next];
    state.selectionAnchorIndex = next;
    state.selectionAnchorCursorIndex = null;
    state.insertAfterOverrideIndex = null;
  }

  function deselectBlock() {
    if (state.selectedBlockIndex == null && !state.selectedBlockIndices.length) {
      return;
    }
    const prevSelected = state.selectedBlockIndex;
    state.selectedBlockIndex = null;
    state.selectedBlockIndices = [];
    state.selectionAnchorIndex = null;
    state.selectionAnchorCursorIndex = null;
    if (state.insertAfterOverrideIndex == null && prevSelected != null) {
      state.insertAfterOverrideIndex = prevSelected;
    }
  }

  function setInsertAfterIndex(idx) {
    const next =
      idx == null ||
      !Number.isFinite(idx) ||
      idx < 0 ||
      !state.currentBlocks ||
      idx >= state.currentBlocks.length
        ? null
        : idx;

    state.selectedBlockIndex = null;
    state.selectedBlockIndices = [];
    state.selectionAnchorIndex = null;
    state.selectionAnchorCursorIndex = null;
    state.insertAfterOverrideIndex = next;
  }

  function setSelectionRange(targetIndex, options = {}) {
    if (!state.currentBlocks || !state.currentBlocks.length) return;
    const { preserveInsert = false } = options;
    const idx = Math.max(
      0,
      Math.min(targetIndex, state.currentBlocks.length - 1),
    );
    const anchor =
      state.selectionAnchorIndex != null
        ? state.selectionAnchorIndex
        : state.selectedBlockIndex;
    if (anchor == null) {
      setSelectedBlock(idx);
      return;
    }
    state.selectionAnchorCursorIndex = null;
    const start = Math.min(anchor, idx);
    const end = Math.max(anchor, idx);
    state.selectedBlockIndices = [];
    for (let i = start; i <= end; i += 1) {
      state.selectedBlockIndices.push(i);
    }
    state.selectedBlockIndex = idx;
    if (!preserveInsert) {
      state.insertAfterOverrideIndex = null;
    }
  }

  function clampCursorIndex(val) {
    if (!state.currentBlocks || !state.currentBlocks.length) return -1;
    const n = Number.isFinite(val) ? val : -1;
    return Math.max(-1, Math.min(n, state.currentBlocks.length - 1));
  }

  function setSelectionFromCursors(anchorCursorIndex, cursorIndex, options = {}) {
    if (!state.currentBlocks || !state.currentBlocks.length) return;
    const { preserveInsert = false } = options;
    const anchorCursor = clampCursorIndex(anchorCursorIndex);
    const cursor = clampCursorIndex(cursorIndex);
    state.selectionAnchorCursorIndex = anchorCursor;

    const start = Math.min(anchorCursor, cursor) + 1;
    const end = Math.max(anchorCursor, cursor);
    state.selectedBlockIndices = [];
    state.selectedBlockIndex = null;

    if (start <= end && end >= 0 && start < state.currentBlocks.length) {
      const clampedStart = Math.max(0, start);
      const clampedEnd = Math.min(state.currentBlocks.length - 1, end);
      for (let i = clampedStart; i <= clampedEnd; i += 1) {
        state.selectedBlockIndices.push(i);
      }
      if (cursor > anchorCursor) {
        state.selectedBlockIndex = clampedEnd;
      } else if (cursor < anchorCursor) {
        state.selectedBlockIndex = clampedStart;
      }
      if (state.selectionAnchorIndex == null) {
        state.selectionAnchorIndex =
          anchorCursor < cursor ? anchorCursor + 1 : anchorCursor;
      }
    }
    if (!state.selectedBlockIndices.length) {
      state.selectionAnchorIndex = null;
      state.selectionAnchorCursorIndex = null;
    }

    if (!preserveInsert) {
      state.insertAfterOverrideIndex = cursor;
    }
  }

  function shiftMoveSelection(direction) {
    if (!state.currentBlocks || !state.currentBlocks.length) return;
    const current =
      state.insertAfterOverrideIndex != null
        ? state.insertAfterOverrideIndex
        : getInsertAfterIndex() ?? -1;
    const next = clampCursorIndex(current + direction);
    if (next === current) return;

    if (state.selectionAnchorCursorIndex != null) {
      state.insertAfterOverrideIndex = next;
      setSelectionFromCursors(state.selectionAnchorCursorIndex, next, {
        preserveInsert: true,
      });
      return;
    }

    if (state.selectedBlockIndices.length) {
      const anchor =
        state.selectionAnchorIndex != null
          ? state.selectionAnchorIndex
          : state.selectedBlockIndex;
      if (anchor == null) {
        state.insertAfterOverrideIndex = next;
        return;
      }
      const anchorCursor = clampCursorIndex(
        direction > 0 ? anchor - 1 : anchor,
      );
      const cursor = clampCursorIndex(
        direction > 0 ? anchor + 1 : anchor - 2,
      );
      state.selectionAnchorIndex = anchor;
      state.selectionAnchorCursorIndex = anchorCursor;
      state.insertAfterOverrideIndex = cursor;
      setSelectionFromCursors(anchorCursor, cursor, { preserveInsert: true });
      return;
    }

    const anchorCursor = clampCursorIndex(current);
    const anchorIndex = direction > 0 ? anchorCursor + 1 : anchorCursor;
    state.selectionAnchorCursorIndex = anchorCursor;
    state.selectionAnchorIndex =
      anchorIndex >= 0 && anchorIndex < state.currentBlocks.length
        ? anchorIndex
        : null;
    state.insertAfterOverrideIndex = next;
    setSelectionFromCursors(anchorCursor, next, { preserveInsert: true });
  }

  function getSelectedIndicesSorted() {
    return state.selectedBlockIndices.slice().sort((a, b) => a - b);
  }

  function startHistoryGroup() {
    if (state.isHistoryRestoring) return;
    state.historyGroupHasUndo = false;
    state.historyPendingSnapshot = createHistorySnapshot();
  }

  function createHistorySnapshot() {
    return {
      meta: { ...state.meta },
      blocks: cloneBlocks(state.currentBlocks || []),
      textEvents: cloneTextEvents(state.textEvents),
      selectedBlockIndex: state.selectedBlockIndex,
      insertAfterOverrideIndex: state.insertAfterOverrideIndex,
    };
  }

  function applyHistorySnapshot(snapshot) {
    if (!snapshot) return;
    state.isHistoryRestoring = true;
    state.meta = { ...snapshot.meta };
    state.currentBlocks = ensureBlockIds(cloneBlocks(snapshot.blocks || []));
    state.textEvents = syncTextEventsToBlocks(
      state.currentBlocks,
      state.currentBlocks,
      cloneTextEvents(snapshot.textEvents),
    );
    state.selectedBlockIndex =
      snapshot.selectedBlockIndex != null ? snapshot.selectedBlockIndex : null;
    state.selectedBlockIndices =
      state.selectedBlockIndex == null ? [] : [state.selectedBlockIndex];
    state.selectionAnchorIndex = state.selectedBlockIndex;
    state.selectionAnchorCursorIndex = null;
    state.insertAfterOverrideIndex =
      snapshot.insertAfterOverrideIndex != null
        ? snapshot.insertAfterOverrideIndex
        : null;
    state.isHistoryRestoring = false;
    startHistoryGroup();
  }

  function cloneBlocks(blocks) {
    return (blocks || []).map((block) => ({
      ...block,
      attrs: { ...(block.attrs || {}) },
      segments: Array.isArray(block.segments)
        ? block.segments.map((seg) => ({ ...seg }))
        : [],
    }));
  }

  function cloneTextEvents(events) {
    return Array.isArray(events)
      ? events.map((evt) => ({
        offsetSec: Number(evt?.offsetSec) || 0,
        durationSec: Number(evt?.durationSec) || 0,
        text: evt?.text || "",
        anchor: evt?.anchor
          ? {
            blockId: evt.anchor.blockId,
            segIndex: Number(evt.anchor.segIndex) || 0,
            offsetRel: Number(evt.anchor.offsetRel) || 0,
          }
          : null,
      }))
      : [];
  }

  function recordHistorySnapshot() {
    if (state.isHistoryRestoring) return;
    if (state.selectedBlockIndex != null) {
      if (!state.historyGroupHasUndo) {
        if (!state.historyPendingSnapshot) {
          state.historyPendingSnapshot = createHistorySnapshot();
        }
        state.undoStack.push(state.historyPendingSnapshot);
        state.historyPendingSnapshot = null;
        state.historyGroupHasUndo = true;
        state.redoStack.length = 0;
      }
      return;
    }
    state.undoStack.push(createHistorySnapshot());
    state.redoStack.length = 0;
  }

  function undoLastChange() {
    if (!state.undoStack.length) return;
    const snapshot = state.undoStack.pop();
    state.redoStack.push(createHistorySnapshot());
    applyHistorySnapshot(snapshot);
  }

  function redoLastChange() {
    if (!state.redoStack.length) return;
    const snapshot = state.redoStack.pop();
    state.undoStack.push(createHistorySnapshot());
    applyHistorySnapshot(snapshot);
  }

  function resetHistory() {
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.historyGroupHasUndo = false;
    state.historyPendingSnapshot = null;
  }

  function getHistoryStatus() {
    return {
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
    };
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
      timings.push({ index: idx, tStart: start, tEnd: totalSec });
    });
    return { timings, totalSec };
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
        timings.push({ blockIndex, segIndex, tStart: start, tEnd: end });
        totalSec = end;
      });
    });
    return { timings, totalSec };
  }

  function buildRawSegmentsFromBlocks(blocks) {
    const raw = [];
    (blocks || []).forEach((block) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      segs.forEach((seg) => {
      const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
      const isFreeRide = block?.kind === "freeride" || seg?.isFreeRide;
      const pStartRel = Number(seg?.pStartRel) || 0;
      const pEndRel = seg?.pEndRel != null ? Number(seg.pEndRel) : pStartRel;
      const cadence = normalizeCadence(seg?.cadence);
      if (isFreeRide) {
        raw.push([
          durSec / 60,
          FREERIDE_POWER_REL * 100,
          FREERIDE_POWER_REL * 100,
          "freeride",
        ]);
        return;
      }
      if (cadence != null) {
        raw.push([durSec / 60, pStartRel * 100, pEndRel * 100, null, cadence]);
      } else {
        raw.push([durSec / 60, pStartRel * 100, pEndRel * 100]);
      }
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
      const isFreeRide = seg[3] === "freeride";
      const cadence = getRawCadence(seg);

      if (
        !Number.isFinite(minutes) ||
        minutes <= 0 ||
        (!isFreeRide && (!Number.isFinite(startVal) || !Number.isFinite(endVal)))
      ) {
        continue;
      }

      if (isFreeRide) {
        normalized.push({
          kind: "freeride",
          durationSec: clampDuration(minutes * 60),
        });
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
          cadenceRpm: cadence,
        });
      } else if (pEndRel > pStartRel) {
        normalized.push({
          kind: "rampUp",
          durationSec,
          powerLowRel: pStartRel,
          powerHighRel: pEndRel,
          cadenceRpm: cadence,
        });
      } else {
        normalized.push({
          kind: "rampDown",
          durationSec,
          powerLowRel: pStartRel,
          powerHighRel: pEndRel,
          cadenceRpm: cadence,
        });
      }
    }

    if (!normalized.length) return [];

    /** @type {ReturnType<typeof createBlock>[]} */
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
                onCadenceRpm: normalizeCadence(firstA.cadenceRpm),
                offCadenceRpm: normalizeCadence(firstB.cadenceRpm),
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
            cadenceRpm: normalizeCadence(b.cadenceRpm),
          }),
        );
      } else if (b.kind === "freeride") {
        blocks.push(
          createBlock("freeride", {
            durationSec: clampDuration(b.durationSec),
          }),
        );
      } else if (b.kind === "rampUp") {
        blocks.push(
          createBlock("warmup", {
            durationSec: clampDuration(b.durationSec),
            powerLowRel: clampRel(b.powerLowRel),
            powerHighRel: clampRel(b.powerHighRel),
            cadenceRpm: normalizeCadence(b.cadenceRpm),
          }),
        );
      } else if (b.kind === "rampDown") {
        blocks.push(
          createBlock("cooldown", {
            durationSec: clampDuration(b.durationSec),
            powerLowRel: clampRel(b.powerLowRel),
            powerHighRel: clampRel(b.powerHighRel),
            cadenceRpm: normalizeCadence(b.cadenceRpm),
          }),
        );
      }

      i += 1;
    }

    return blocks;
  }

  function getRawCadence(seg) {
    if (!Array.isArray(seg)) return null;
    if (seg[3] === "freeride") return null;
    if (Number.isFinite(seg[4])) return normalizeCadence(seg[4]);
    if (typeof seg[3] === "number" && Number.isFinite(seg[3])) {
      return normalizeCadence(seg[3]);
    }
    return null;
  }

  function blocksSimilarSteady(a, b, durTolSec, pwrTol) {
    if (a.kind !== "steady" || b.kind !== "steady") return false;
    const durDiff = Math.abs(a.durationSec - b.durationSec);
    const pDiff = Math.abs(a.powerRel - b.powerRel);
    const cadA = normalizeCadence(a.cadenceRpm);
    const cadB = normalizeCadence(b.cadenceRpm);
    const cadenceMatch = cadA == null && cadB == null ? true : cadA === cadB;
    return durDiff <= durTolSec && pDiff <= pwrTol && cadenceMatch;
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
    const snapped = Math.round((Number(sec) || 0) / step) * step;
    return Math.max(1, snapped);
  }

  function getDurationStep(sec) {
    const s = Math.max(1, Math.round(sec || 0));
    if (s < 30) return 5;
    if (s < 60) return 10;
    if (s < 300) return 30;
    return 60;
  }

  function reorderBlocks(fromIndex, insertAfterIndex) {
    if (
      fromIndex == null ||
      insertAfterIndex == null ||
      !state.currentBlocks ||
      !state.currentBlocks.length
    ) {
      return false;
    }
    let target = insertAfterIndex;
    if (target >= fromIndex) target -= 1;
    if (target < -1) target = -1;
    if (target >= state.currentBlocks.length) {
      target = state.currentBlocks.length - 1;
    }

    const updated = state.currentBlocks.slice();
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(target + 1, 0, moved);
    commitBlocks(updated, { selectIndex: target + 1 });
    return true;
  }

  function commitBlocks(updatedBlocks, options = {}) {
    const prevBlocks = state.currentBlocks || [];
    state.currentBlocks = ensureBlockIds(updatedBlocks || []);
    state.currentRawSegments = buildRawSegmentsFromBlocks(state.currentBlocks);
    state.currentErrors = [];
    state.textEvents = syncTextEventsToBlocks(
      prevBlocks,
      state.currentBlocks,
      state.textEvents,
    );

    if (options.selectIndex !== undefined) {
      state.selectedBlockIndex = options.selectIndex;
      if (options.selectIndex == null) {
        state.selectedBlockIndices = [];
        state.selectionAnchorIndex = null;
        state.selectionAnchorCursorIndex = null;
      } else {
        state.selectedBlockIndices = [options.selectIndex];
        state.selectionAnchorIndex = options.selectIndex;
        state.selectionAnchorCursorIndex = null;
      }
    }
  }

  function applyBlockAttrUpdate(blockIndex, attrs) {
    if (
      blockIndex == null ||
      !state.currentBlocks ||
      !state.currentBlocks[blockIndex]
    ) {
      return;
    }

    const oldStartEnd = getBlockStartEnd(state.currentBlocks[blockIndex]);
    recordHistorySnapshot();
    const updatedBlocks = state.currentBlocks.map((block, idx) => {
      if (idx !== blockIndex) return block;
      const nextBlock = {
        ...block,
        attrs: { ...(block.attrs || {}), ...attrs },
      };
      if (nextBlock.kind === "warmup" || nextBlock.kind === "cooldown") {
        const low = nextBlock.attrs?.powerLowRel;
        const high = nextBlock.attrs?.powerHighRel;
        if (Number.isFinite(low) && Number.isFinite(high)) {
          if (nextBlock.kind === "warmup" && high < low) {
            nextBlock.kind = "cooldown";
          } else if (nextBlock.kind === "cooldown" && high > low) {
            nextBlock.kind = "warmup";
          }
        }
      }
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
      blockIndex < state.currentBlocks.length ? blockIndex : null;
    commitBlocks(updatedBlocks, { selectIndex: nextIndex });
  }

  function deleteSelectedBlock() {
    if (!state.currentBlocks || !state.currentBlocks.length) return;
    if (!state.selectedBlockIndices.length) return;

    const indices = state.selectedBlockIndices
      .slice()
      .sort((a, b) => a - b);
    const deleteIndex = indices[0];
    recordHistorySnapshot();
    const updatedBlocks = state.currentBlocks.filter(
      (_block, idx) => !indices.includes(idx),
    );

    if (!updatedBlocks.length) {
      state.selectedBlockIndex = null;
      state.selectedBlockIndices = [];
      state.selectionAnchorIndex = null;
      state.selectionAnchorCursorIndex = null;
      commitBlocks(updatedBlocks, { selectIndex: null });
      return;
    }

    let nextInsertAfter = deleteIndex - 1;
    if (nextInsertAfter >= updatedBlocks.length) {
      nextInsertAfter = updatedBlocks.length - 1;
    }
    if (nextInsertAfter < -1) nextInsertAfter = -1;
    state.insertAfterOverrideIndex = nextInsertAfter;
    state.selectedBlockIndex = null;
    state.selectedBlockIndices = [];
    state.selectionAnchorIndex = null;
    state.selectionAnchorCursorIndex = null;
    commitBlocks(updatedBlocks, { selectIndex: null });
  }

  function moveSelectedBlock(direction) {
    if (
      state.selectedBlockIndex == null ||
      !state.currentBlocks ||
      !state.currentBlocks[state.selectedBlockIndex]
    ) {
      return;
    }

    const idx = state.selectedBlockIndex;
    const target = idx + direction;
    if (target < 0 || target >= state.currentBlocks.length) return;

    recordHistorySnapshot();
    const updated = state.currentBlocks.slice();
    const [moved] = updated.splice(idx, 1);
    updated.splice(target, 0, moved);
    commitBlocks(updated, { selectIndex: target });
  }

  function getBlockDurationSec(block) {
    if (!block) return 0;
    if (block.kind === "intervals") {
      const parts = getIntervalParts(block);
      const on = parts.onDurationSec;
      const off = parts.offDurationSec;
      const repeat = parts.repeat;
      return Math.max(1, Math.round((on + off) * repeat));
    }
    if (block.kind === "steady") {
      const dur = block.attrs?.durationSec;
      return Math.max(1, Math.round(Number(dur) || 0));
    }
    if (block.kind === "freeride") {
      const dur = block.attrs?.durationSec;
      return Math.max(1, Math.round(Number(dur) || 0));
    }
    if (block.kind === "warmup" || block.kind === "cooldown") {
      const dur = block.attrs?.durationSec;
      return Math.max(1, Math.round(Number(dur) || 0));
    }
    return 0;
  }

  function getBlockSteadyPower(block) {
    if (!block) return 0;
    const power = block.attrs?.powerRel;
    return Number.isFinite(power) ? power : 0;
  }

  function getBlockCadence(block) {
    if (!block) return null;
    const cadence = block.attrs?.cadenceRpm;
    return normalizeCadence(cadence);
  }

  function getRampLow(block) {
    if (!block) return 0;
    const low = block.attrs?.powerLowRel;
    return Number.isFinite(low) ? low : 0;
  }

  function getRampHigh(block) {
    if (!block) return 0;
    const high = block.attrs?.powerHighRel;
    return Number.isFinite(high) ? high : 0;
  }

  function getIntervalParts(block) {
    const attrs = block?.attrs || {};
    return {
      repeat: clampRepeat(attrs.repeat),
      onDurationSec: clampDuration(attrs.onDurationSec),
      offDurationSec: clampDuration(attrs.offDurationSec),
      onPowerRel: clampRel(attrs.onPowerRel),
      offPowerRel: clampRel(attrs.offPowerRel),
      onCadenceRpm: normalizeCadence(attrs.onCadenceRpm),
      offCadenceRpm: normalizeCadence(attrs.offCadenceRpm),
    };
  }

  function createBlock(kind, attrs) {
    const base = {
      id: allocateBlockId(),
      kind,
      attrs: { ...(attrs || {}) },
    };
    return {
      ...base,
      segments: buildSegmentsForBlock(base),
    };
  }

  function buildSegmentsForBlock(block) {
    if (!block) return [];

    if (block.kind === "steady") {
      const duration = clampDuration(block.attrs?.durationSec);
      const powerRel = clampRel(block.attrs?.powerRel);
      const cadence = normalizeCadence(block.attrs?.cadenceRpm);
      return [
        {
          durationSec: duration,
          pStartRel: powerRel,
          pEndRel: powerRel,
          cadence,
        },
      ];
    }

    if (block.kind === "freeride") {
      const duration = clampDuration(block.attrs?.durationSec);
      return [
        {
          durationSec: duration,
          pStartRel: FREERIDE_POWER_REL,
          pEndRel: FREERIDE_POWER_REL,
          isFreeRide: true,
        },
      ];
    }

    if (block.kind === "warmup" || block.kind === "cooldown") {
      const duration = clampDuration(block.attrs?.durationSec);
      const low = clampRel(block.attrs?.powerLowRel);
      const high = clampRel(block.attrs?.powerHighRel);
      const cadence = normalizeCadence(block.attrs?.cadenceRpm);
      return [
        {
          durationSec: duration,
          pStartRel: low,
          pEndRel: high,
          cadence,
        },
      ];
    }

    if (block.kind === "intervals") {
      const {
        repeat,
        onDurationSec,
        offDurationSec,
        onPowerRel,
        offPowerRel,
        onCadenceRpm,
        offCadenceRpm,
      } = getIntervalParts(block);
      const segments = [];
      for (let i = 0; i < repeat; i += 1) {
        segments.push({
          durationSec: onDurationSec,
          pStartRel: onPowerRel,
          pEndRel: onPowerRel,
          cadence: onCadenceRpm,
        });
        segments.push({
          durationSec: offDurationSec,
          pStartRel: offPowerRel,
          pEndRel: offPowerRel,
          cadence: offCadenceRpm,
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

  function normalizeCadence(val) {
    if (val == null || val === "") return null;
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return Math.max(30, Math.min(200, Math.round(n)));
  }

  function normalizeTextEvent(evt, blocks) {
    if (!evt || typeof evt !== "object") {
      return { offsetSec: 0, durationSec: 10, text: "", anchor: null };
    }
    const offsetSec = Math.max(0, Math.round(Number(evt.offsetSec) || 0));
    const durationSec = Math.max(1, Math.round(Number(evt.durationSec) || 10));
    const text = String(evt.text || "");
    const anchor = normalizeTextEventAnchor(evt.anchor);
    if (!blocks || !Array.isArray(blocks) || !blocks.length) {
      return { offsetSec, durationSec, text, anchor };
    }
    if (anchor) {
      const resolved = resolveOffsetFromAnchor(anchor, blocks);
      if (resolved) {
        return {
          offsetSec: resolved.offsetSec,
          durationSec,
          text,
          anchor: resolved.anchor,
        };
      }
    }
    const anchored = anchorTextEventToBlocks(offsetSec, blocks);
    if (anchored) {
      return {
        offsetSec: anchored.offsetSec,
        durationSec,
        text,
        anchor: anchored.anchor,
      };
    }
    return { offsetSec, durationSec, text, anchor };
  }

  function normalizeTextEvents(events, blocks) {
    return Array.isArray(events)
      ? events.map((evt) => normalizeTextEvent(evt, blocks))
      : [];
  }

  function normalizeTextEventAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") return null;
    const blockId = anchor.blockId;
    if (blockId == null) return null;
    const segIndex = Math.max(0, Math.round(Number(anchor.segIndex) || 0));
    const offsetRelRaw = Number(anchor.offsetRel);
    const offsetRel = Number.isFinite(offsetRelRaw)
      ? Math.max(0, Math.min(1, offsetRelRaw))
      : 0;
    return { blockId, segIndex, offsetRel };
  }

  function resolveTextEvents(events) {
    return normalizeTextEvents(events, state.currentBlocks);
  }

  function stripTextEventAnchors(events) {
    return Array.isArray(events)
      ? events.map((evt) => ({
        offsetSec: Number(evt?.offsetSec) || 0,
        durationSec: Number(evt?.durationSec) || 0,
        text: evt?.text || "",
      }))
      : [];
  }

  function resolveOffsetFromAnchor(anchor, blocks) {
    const clean = normalizeTextEventAnchor(anchor);
    if (!clean) return null;
    const blockInfo = findBlockById(blocks, clean.blockId);
    if (!blockInfo) return null;
    const { block, blockStart } = blockInfo;
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    if (!segs.length) return null;
    const segIndex = Math.min(clean.segIndex, segs.length - 1);
    let segStart = blockStart;
    for (let i = 0; i < segIndex; i += 1) {
      segStart += Math.max(1, Math.round(segs[i]?.durationSec || 0));
    }
    const segDuration = Math.max(1, Math.round(segs[segIndex]?.durationSec || 0));
    const offsetRel = Number.isFinite(clean.offsetRel)
      ? Math.max(0, Math.min(1, clean.offsetRel))
      : 0;
    const offsetSec = Math.round(segStart + segDuration * offsetRel);
    return {
      offsetSec,
      anchor: { blockId: block.id, segIndex, offsetRel },
    };
  }

  function anchorTextEventToBlocks(offsetSec, blocks) {
    const found = findSegmentAtTime(blocks, offsetSec);
    if (!found) return null;
    const offsetRel = found.durationSec
      ? Math.max(0, Math.min(1, (offsetSec - found.startSec) / found.durationSec))
      : 0;
    return {
      offsetSec: Math.round(found.startSec + found.durationSec * offsetRel),
      anchor: {
        blockId: found.blockId,
        segIndex: found.segIndex,
        offsetRel,
      },
    };
  }

  function findSegmentAtTime(blocks, tSec) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    let cursor = 0;
    const totalSec = blocks.reduce((sum, block) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      return (
        sum +
        segs.reduce(
          (segSum, seg) => segSum + Math.max(1, Math.round(seg?.durationSec || 0)),
          0,
        )
      );
    }, 0);
    const clamped = Math.max(0, Math.min(Number(tSec) || 0, Math.max(0, totalSec)));

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      for (let segIndex = 0; segIndex < segs.length; segIndex += 1) {
        const durSec = Math.max(1, Math.round(segs[segIndex]?.durationSec || 0));
        const start = cursor;
        const end = cursor + durSec;
        if (clamped < end || (blockIndex === blocks.length - 1 && segIndex === segs.length - 1)) {
          return {
            blockId: block?.id,
            segIndex,
            startSec: start,
            durationSec: durSec,
          };
        }
        cursor = end;
      }
    }
    return null;
  }

  function findBlockById(blocks, blockId) {
    if (!Array.isArray(blocks)) return null;
    let blockStart = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      if (block?.id === blockId) {
        return { blockIndex: i, block, blockStart };
      }
      segs.forEach((seg) => {
        blockStart += Math.max(1, Math.round(seg?.durationSec || 0));
      });
    }
    return null;
  }

  function allocateBlockId() {
    const next = nextBlockId;
    nextBlockId += 1;
    return next;
  }

  function ensureBlockIds(blocks) {
    const updated = (blocks || []).map((block) => {
      if (!block) return block;
      if (block.id != null) return block;
      return { ...block, id: allocateBlockId() };
    });
    let maxId = nextBlockId - 1;
    updated.forEach((block) => {
      const idNum = Number(block?.id);
      if (Number.isFinite(idNum)) {
        maxId = Math.max(maxId, idNum);
      }
    });
    nextBlockId = Math.max(nextBlockId, maxId + 1);
    return updated;
  }

  function syncTextEventsToBlocks(prevBlocks, nextBlocks, events) {
    if (!Array.isArray(events) || !events.length) return [];
    const prevList = Array.isArray(prevBlocks) ? prevBlocks : [];
    const nextList = Array.isArray(nextBlocks) ? nextBlocks : [];
    return events.map((evt) => {
      const baseOffset =
        evt?.anchor && prevList.length
          ? resolveOffsetFromAnchor(evt.anchor, prevList)?.offsetSec ?? evt.offsetSec
          : evt.offsetSec;
      if (evt?.anchor) {
        const resolved = resolveOffsetFromAnchor(evt.anchor, nextList);
        if (resolved) {
          return { ...evt, offsetSec: resolved.offsetSec, anchor: resolved.anchor };
        }
      }
      const anchored = anchorTextEventToBlocks(baseOffset, nextList);
      if (anchored) {
        return { ...evt, offsetSec: anchored.offsetSec, anchor: anchored.anchor };
      }
      return evt;
    });
  }

  function insertTextEventsAtInsertionPoint(textEvents) {
    if (!Array.isArray(textEvents) || !textEvents.length) return;
    const blocks = state.currentBlocks || [];
    if (!blocks.length) return;
    recordHistorySnapshot();
    const { timings } = buildBlockTimings(blocks);
    const insertAfter =
      state.insertAfterOverrideIndex != null
        ? state.insertAfterOverrideIndex
        : state.selectedBlockIndex;
    let baseOffset = 0;
    if (timings.length) {
      const safeIndex =
        insertAfter == null
          ? -1
          : Math.max(-1, Math.min(insertAfter, timings.length - 1));
      if (safeIndex >= 0) {
        baseOffset = timings[safeIndex]?.tEnd || 0;
      }
    }

    const inserted = textEvents.map((evt) => ({
      offsetSec: Math.max(0, Math.round(Number(evt?.offsetSec) || 0)) + baseOffset,
      durationSec: Math.max(1, Math.round(Number(evt?.durationSec) || 10)),
      text: String(evt?.text || ""),
      anchor: null,
    }));

    state.textEvents = normalizeTextEvents(
      [...state.textEvents, ...inserted],
      state.currentBlocks,
    );
  }

  function buildTextEventsForInsertion(textEvents, insertIndex, insertedBlocks, allBlocks) {
    if (!Array.isArray(textEvents) || !textEvents.length) return [];
    const baseOffset = getBlocksDurationUpTo(allBlocks, insertIndex);
    return textEvents
      .map((evt) => normalizeTextEvent(evt, insertedBlocks))
      .map((evt) => {
        if (!evt.anchor) return null;
        const resolved = resolveOffsetFromAnchor(evt.anchor, insertedBlocks);
        const offsetWithin = resolved ? resolved.offsetSec : evt.offsetSec;
        return {
          offsetSec: Math.round(baseOffset + (offsetWithin || 0)),
          durationSec: evt.durationSec,
          text: evt.text,
          anchor: evt.anchor,
        };
      })
      .filter(Boolean);
  }

  function getBlocksDurationUpTo(blocks, endIndex) {
    const limit = Math.max(0, Math.min(endIndex, (blocks || []).length));
    let total = 0;
    for (let i = 0; i < limit; i += 1) {
      total += getBlockDurationSec(blocks[i]);
    }
    return total;
  }

  function getTextEventsForSelection() {
    const indices = getSelectedIndicesSorted();
    if (!indices.length) return [];
    const { timings } = buildBlockTimings(state.currentBlocks);
    const start = timings[indices[0]]?.tStart ?? 0;
    const end = timings[indices[indices.length - 1]]?.tEnd ?? start;
    return stripTextEventAnchors(resolveTextEvents(state.textEvents))
      .filter((evt) => evt.offsetSec >= start && evt.offsetSec < end)
      .map((evt) => ({
        offsetSec: Math.max(0, Math.round(evt.offsetSec - start)),
        durationSec: evt.durationSec,
        text: evt.text,
      }));
  }

  function getInsertAfterIndex() {
    if (state.insertAfterOverrideIndex != null) return state.insertAfterOverrideIndex;
    if (state.selectedBlockIndex != null) return state.selectedBlockIndex;
    return null;
  }

  function insertBlockAtInsertionPoint(spec, options = {}) {
    const { selectOnInsert = true } = options;
    let block = buildBlockFromSpec(spec);
    if (!block) return;
    if (block.kind === "warmup" || block.kind === "cooldown") {
      const contextual = buildContextualRampBlock(block.kind, block);
      if (contextual) block = contextual;
    }
    const insertAfterIndex = getInsertAfterIndex();
    const insertIndex =
      insertAfterIndex == null
        ? 0
        : Math.max(0, insertAfterIndex + 1);
    insertBlocksAtInsertionPoint([block], {
      selectOnInsert,
      insertIndex,
    });
  }

  function insertBlocksAtInsertionPoint(blocks, options = {}) {
    if (!blocks || !blocks.length) return;
    const insertAfterIndex = getInsertAfterIndex();
    const insertIndex =
      options.insertIndex != null
        ? options.insertIndex
        : insertAfterIndex == null
          ? 0
          : Math.max(0, insertAfterIndex + 1);

    recordHistorySnapshot();
    const updated = state.currentBlocks.slice();
    updated.splice(insertIndex, 0, ...blocks);
    blocks.forEach((block, offset) => {
      if (block && block.kind === "steady") {
        adjustAdjacentRampsForSteady(updated, insertIndex + offset, block);
      }
    });

    const shouldSelect = options.selectOnInsert !== false;
    const selectIndex = shouldSelect ? insertIndex : null;
    commitBlocks(updated, { selectIndex });
    state.insertAfterOverrideIndex = insertIndex + blocks.length - 1;

    if (Array.isArray(options.textEvents) && options.textEvents.length) {
      const inserted = buildTextEventsForInsertion(
        options.textEvents,
        insertIndex,
        blocks,
        state.currentBlocks,
      );
      if (inserted.length) {
        state.textEvents = normalizeTextEvents(
          [...state.textEvents, ...inserted],
          state.currentBlocks,
        );
      }
    }
  }

  function buildBlockFromSpec(spec) {
    if (!spec) return null;
    const kind = spec.kind || "steady";
    if (kind === "intervals") {
      return createBlock("intervals", {
        repeat: clampRepeat(spec.repeat || 6),
        onDurationSec: clampDuration(spec.onDurationSec || 60),
        offDurationSec: clampDuration(spec.offDurationSec || 60),
        onPowerRel: clampRel(spec.onPowerRel || 1.0),
        offPowerRel: clampRel(spec.offPowerRel || 0.55),
      });
    }
    if (kind === "warmup" || kind === "cooldown") {
      return createBlock(kind, {
        durationSec: clampDuration(spec.durationSec || 300),
        powerLowRel: clampRel(spec.powerLowRel || 0.5),
        powerHighRel: clampRel(spec.powerHighRel || 0.8),
      });
    }
    if (kind === "freeride") {
      return createBlock("freeride", {
        durationSec: clampDuration(spec.durationSec || 300),
      });
    }
    return createBlock("steady", {
      durationSec: clampDuration(spec.durationSec || 300),
      powerRel: clampRel(spec.powerRel || 0.6),
    });
  }

  function adjustAdjacentRampsForSteady(blocks, insertIndex, steadyBlock) {
    if (!blocks || !steadyBlock) return;

    const prev = insertIndex > 0 ? blocks[insertIndex - 1] : null;
    const next =
      insertIndex + 1 < blocks.length ? blocks[insertIndex + 1] : null;

    const steadyPower = getBlockSteadyPower(steadyBlock);

    if (prev && (prev.kind === "warmup" || prev.kind === "cooldown")) {
      const start = getRampLow(prev);
      const canUpdate =
        prev.kind === "warmup"
          ? steadyPower > start
          : steadyPower < start;
      if (canUpdate) {
        prev.attrs = {
          ...(prev.attrs || {}),
          powerHighRel: steadyPower,
        };
        prev.segments = buildSegmentsForBlock(prev);
      }
    }

    if (next && (next.kind === "warmup" || next.kind === "cooldown")) {
      const end = getRampHigh(next);
      const canUpdate =
        next.kind === "warmup"
          ? steadyPower < end
          : steadyPower > end;
      if (canUpdate) {
        next.attrs = {
          ...(next.attrs || {}),
          powerLowRel: steadyPower,
        };
        next.segments = buildSegmentsForBlock(next);
      }
    }
  }

  function buildContextualRampBlock(kind, fallbackBlock) {
    if (!fallbackBlock) return null;

    const insertAfterIndex = getInsertAfterIndex();
    if (insertAfterIndex == null) return fallbackBlock;

    const prevBlock = state.currentBlocks?.[insertAfterIndex] || null;
    const nextBlock = state.currentBlocks?.[insertAfterIndex + 1] || null;

    const prevPower = prevBlock ? getBlockStartEnd(prevBlock) : null;
    const nextPower = nextBlock ? getBlockStartEnd(nextBlock) : null;

    let low = prevPower ? prevPower.end : null;
    let high = nextPower ? nextPower.start : null;

    if (low == null && high == null) return fallbackBlock;

    if (low != null && high != null) {
      if (kind === "warmup" && high <= low) {
        high = low + 0.5;
      } else if (kind === "cooldown" && high >= low) {
        high = low - 0.5;
      }
    } else if (low == null && high != null) {
      low = kind === "cooldown" ? high + 0.5 : high - 0.5;
    } else if (high == null && low != null) {
      high = kind === "cooldown" ? low - 0.5 : low + 0.5;
    }

    if (low == null || high == null) return fallbackBlock;

    low = clampRel(low);
    high = clampRel(high);

    const hasPrev = low != null && prevPower != null;
    const hasNext = high != null && nextPower != null;
    const durationSec = hasPrev && hasNext ? 120 : 360;
    const seg = {
      durationSec,
      pStartRel: low,
      pEndRel: high,
    };

    return {
      ...fallbackBlock,
      segments: [seg],
      attrs: {
        ...(fallbackBlock.attrs || {}),
        durationSec: seg.durationSec,
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
      const start = Number.isFinite(first?.pStartRel) ? first.pStartRel : null;
      const end = Number.isFinite(last?.pEndRel) ? last.pEndRel : start;
      if (start != null && end != null) {
        return { start, end };
      }
    }

    const attrs = block.attrs || {};
    if (block.kind === "steady") {
      const power = attrs.powerRel;
      if (Number.isFinite(power)) return { start: power, end: power };
    } else if (block.kind === "freeride") {
      return { start: FREERIDE_POWER_REL, end: FREERIDE_POWER_REL };
    } else if (block.kind === "warmup" || block.kind === "cooldown") {
      const low = attrs.powerLowRel;
      const high = attrs.powerHighRel;
      if (Number.isFinite(low) && Number.isFinite(high)) {
        return { start: low, end: high };
      }
    } else if (block.kind === "intervals") {
      const on = attrs.onPowerRel;
      const off = attrs.offPowerRel;
      if (Number.isFinite(on) && Number.isFinite(off)) {
        return { start: on, end: off };
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

  function applyPowerUpdatesAroundCursor(prevIndex, nextIndex, delta) {
    const updates = [];

    const collectPowerUpdate = (idx, position) => {
      const b = state.currentBlocks[idx];
      if (!b) return;
      if (b.kind === "steady") {
        updates.push({
          idx,
          attrs: {
            powerRel: clampRel(getBlockSteadyPower(b) + delta),
          },
        });
      } else if (b.kind === "warmup" || b.kind === "cooldown") {
        const isStart = position === "start";
        const current = isStart ? getRampLow(b) : getRampHigh(b);
        updates.push({
          idx,
          attrs: {
            [isStart ? "powerLowRel" : "powerHighRel"]: clampRel(
              current + delta,
            ),
          },
        });
      } else if (b.kind === "intervals") {
        const parts = getIntervalParts(b);
        const isStart = position === "start";
        updates.push({
          idx,
          attrs: {
            [isStart ? "onPowerRel" : "offPowerRel"]: clampRel(
              (isStart ? parts.onPowerRel : parts.offPowerRel) + delta,
            ),
          },
        });
      }
    };

    if (prevIndex >= 0) collectPowerUpdate(prevIndex, "end");
    if (nextIndex >= 0 && nextIndex < state.currentBlocks.length) {
      collectPowerUpdate(nextIndex, "start");
    }

    if (!updates.length) return;

    recordHistorySnapshot();
    const updatedBlocks = cloneBlocks(state.currentBlocks);
    const oldStartEnds = new Map();
    updates.forEach(({ idx, attrs }) => {
      const b = updatedBlocks[idx];
      if (!b) return;
      oldStartEnds.set(idx, getBlockStartEnd(b));
      const nextBlock = {
        ...b,
        attrs: { ...(b.attrs || {}), ...attrs },
      };
      updatedBlocks[idx] = {
        ...nextBlock,
        segments: buildSegmentsForBlock(nextBlock),
      };
    });
    updates.forEach(({ idx }) => {
      const oldStartEnd = oldStartEnds.get(idx);
      const nextBlock = updatedBlocks[idx];
      const newStartEnd = getBlockStartEnd(nextBlock);
      if (oldStartEnd && newStartEnd) {
        syncAdjacentRampLinks(updatedBlocks, idx, oldStartEnd, newStartEnd);
      }
    });
    commitBlocks(updatedBlocks, { selectIndex: state.selectedBlockIndex });
  }

  return {
    getMeta,
    setMeta,
    getCanonicalState,
    setPersistedState,
    getPersistedState,
    getCurrentBlocks,
    getCurrentRawSegments,
    getCurrentMetrics,
    getCurrentZone,
    getCurrentErrors,
    getTextEvents,
    setTextEvents,
    addTextEvent,
    updateTextEvent,
    deleteTextEvent,
    getSelectionSnapshot,
    getSelectedBlockIndex,
    getSelectedBlockIndices,
    getInsertAfterOverrideIndex,
    setInsertAfterOverrideIndex,
    hasSelection,
    setDefaultBlocks,
    recomputeDerived,
    getSelectedBlock,
    setSelectedBlock,
    deselectBlock,
    setInsertAfterIndex,
    setSelectionRange,
    clampCursorIndex,
    setSelectionFromCursors,
    shiftMoveSelection,
    getSelectedIndicesSorted,
    startHistoryGroup,
    recordHistorySnapshot,
    undoLastChange,
    redoLastChange,
    resetHistory,
    getHistoryStatus,
    buildBlockTimings,
    buildSegmentTimings,
    buildRawSegmentsFromBlocks,
    segmentsToBlocks,
    snapPowerRel,
    clampRel,
    snapDurationSec,
    getDurationStep,
    reorderBlocks,
    commitBlocks,
    applyBlockAttrUpdate,
    deleteSelectedBlock,
    moveSelectedBlock,
    getBlockDurationSec,
    getBlockSteadyPower,
    getBlockCadence,
    getRampLow,
    getRampHigh,
    getIntervalParts,
    createBlock,
    buildSegmentsForBlock,
    clampDuration,
    clampRepeat,
    clampPowerPercent,
    getTextEventsForSelection,
    insertTextEventsAtInsertionPoint,
    getInsertAfterIndex,
    insertBlockAtInsertionPoint,
    insertBlocksAtInsertionPoint,
    buildBlockFromSpec,
    adjustAdjacentRampsForSteady,
    buildContextualRampBlock,
    getBlockStartEnd,
    syncAdjacentRampLinks,
    applyPowerUpdatesAroundCursor,
  };
}
