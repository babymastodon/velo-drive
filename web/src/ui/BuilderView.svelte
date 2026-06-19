<script lang="ts" module>
  // Public imperative API the host (PickerView) drives. Mirrors the legacy
  // workoutBuilder return object (docs/workout-builder.js): getState /
  // clearState / refreshLayout / validateForSave / loadCanonicalWorkout.
  export interface BuilderApi {
    getState: () => CanonicalWorkout;
    clearState: (opts?: { persist?: boolean }) => void;
    refreshLayout: () => void;
    validateForSave: () => { ok: boolean; errors: string[] };
    loadCanonicalWorkout: (cw: CanonicalWorkout) => void;
  }
</script>

<script lang="ts">
  // BuilderView — faithful re-host of the legacy in-picker workout builder
  // (docs/workout-builder.js UI + docs/builder-backend.js model, ported to
  // core/builder-backend.ts). Reproduces the wb-* DOM/classes so the re-hosted
  // workout-picker.css applies unchanged. The block MODEL is the DOM-free
  // backend; the chart is rendered imperatively via core/chart.ts
  // renderBuilderWorkoutGraph. Stats / toolbar / block-editor are reactive
  // Svelte bound to a version-bumped snapshot of the backend.
  //
  // Required behavior path (per milestone): keyboard/stepper editing + the saved
  // .zwo outcome. Drag-on-chart: pointerdown selects a block / sets the insert
  // point + supports right-edge duration + top power drag (the pointer->time/
  // power math reuses the legacy formulas); pixel-perfect ramp-region drag is
  // simplified (see handleChartPointerMove).

  import {
    createBuilderBackend,
    encodeClipboard,
    encodeTextEventClipboard,
    parseClipboard,
    type Block,
  } from '../core/builder-backend.js';
  import { renderBuilderWorkoutGraph } from '../core/chart.js';
  import { getScaledMaxY } from '../core/chart.js';
  import { themeAutoVersion } from '../state/theme.svelte.js';
  import { formatDurationMinSec } from '../core/metrics.js';
  import { isEditableTarget } from './dom-utils.js';
  import type { CanonicalWorkout } from '../core/model.js';

  let {
    getCurrentFtp,
    onRequestBack,
    onStatusChange,
    onUiStateChange,
    onChange,
    api = $bindable(),
  }: {
    getCurrentFtp: () => number;
    onRequestBack?: () => void;
    onStatusChange?: (p: { text: string; tone: string }) => void;
    onUiStateChange?: (p: { hasSelection: boolean }) => void;
    // Fired after any model mutation (version bump). The host uses this to
    // diff against a baseline for unsaved-changes tracking + draft persistence
    // (mirrors docs/workout-picker.js handleBuilderChange wiring).
    onChange?: () => void;
    api?: BuilderApi;
  } = $props();

  const backend = createBuilderBackend();
  const DRAG_THRESHOLD_PX = 4;

  // version bumps whenever the model mutates; reactive reads depend on it.
  let version = $state(0);
  // Notify the host on every mutation (skip the very first init bump so the
  // host's baseline is taken against the initialized state, not a dirty one).
  $effect(() => {
    void version;
    if (version > 0) onChange?.();
  });
  function bump(): void {
    version += 1;
  }

  // Meta inputs (reactive).
  let nameValue = $state('');
  let sourceValue = $state('Me');
  let descValue = $state('');
  let urlValue = $state('');
  let nameError = $state(false);
  let sourceError = $state(false);
  let descError = $state(false);

  let selectedTextEventIndex = $state<number | null>(null);

  let chartHost = $state<HTMLDivElement | null>(null);
  let chartContainer = $state<HTMLDivElement | null>(null);
  let descTextarea = $state<HTMLTextAreaElement | null>(null);
  let toolbarCard = $state<HTMLDivElement | null>(null);

  // Responsive toolbar label mode (mirrors docs/workout-builder.js
  // updateSteadyLabels): width<950 -> icon-only; <1260 -> short (Z1..Z6);
  // otherwise full labels.
  let labelMode = $state<'full' | 'short' | 'icon'>('full');
  function updateLabelMode(): void {
    if (!toolbarCard) return;
    const width = toolbarCard.clientWidth || 0;
    if (width > 0 && width < 950) labelMode = 'icon';
    else if (width > 0 && width < 1260) labelMode = 'short';
    else labelMode = 'full';
  }
  function labelFor(spec: ButtonSpec): string {
    if (labelMode === 'icon') return '';
    if (labelMode === 'short' && spec.shortLabel) return spec.shortLabel;
    return spec.label;
  }
  $effect(() => {
    if (!toolbarCard) return;
    updateLabelMode();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateLabelMode());
      ro.observe(toolbarCard);
      return () => ro.disconnect();
    }
    return undefined;
  });

  let dragInsertAfterIndex: number | null = null;
  let dragState: any = null;
  let timelineLockSec = 0;

  // --------------------------- toolbar specs ---------------------------
  interface ButtonSpec {
    key: string;
    label: string;
    shortLabel?: string;
    icon: string;
    zoneClass?: string;
    shortcut: string;
    kind: string;
    durationSec?: number;
    powerRel?: number;
    powerLowRel?: number;
    powerHighRel?: number;
    repeat?: number;
    onDurationSec?: number;
    offDurationSec?: number;
    onPowerRel?: number;
    offPowerRel?: number;
  }
  const buttonSpecs: ButtonSpec[] = [
    { key: 'recovery', label: 'Recovery', shortLabel: 'Z1', icon: 'steady', zoneClass: 'wb-zone-recovery', shortcut: 'R', kind: 'steady', durationSec: 300, powerRel: 0.55 },
    { key: 'endurance', label: 'Endurance', shortLabel: 'Z2', icon: 'steady', zoneClass: 'wb-zone-endurance', shortcut: 'E', kind: 'steady', durationSec: 300, powerRel: 0.7 },
    { key: 'tempo', label: 'Tempo', shortLabel: 'Z3', icon: 'steady', zoneClass: 'wb-zone-tempo', shortcut: 'T', kind: 'steady', durationSec: 300, powerRel: 0.85 },
    { key: 'threshold', label: 'Threshold', shortLabel: 'Z4', icon: 'steady', zoneClass: 'wb-zone-threshold', shortcut: 'S', kind: 'steady', durationSec: 300, powerRel: 0.95 },
    { key: 'vo2max', label: 'VO2Max', shortLabel: 'Z5', icon: 'steady', zoneClass: 'wb-zone-vo2', shortcut: 'V', kind: 'steady', durationSec: 300, powerRel: 1.1 },
    { key: 'anaerobic', label: 'Anaerobic', shortLabel: 'Z6', icon: 'steady', zoneClass: 'wb-zone-anaerobic', shortcut: 'A', kind: 'steady', durationSec: 300, powerRel: 1.25 },
    { key: 'warmup', label: 'Warmup', icon: 'rampUp', shortcut: 'W', kind: 'warmup', powerLowRel: 0.5, powerHighRel: 0.75 },
    { key: 'cooldown', label: 'Cooldown', icon: 'rampDown', shortcut: 'C', kind: 'cooldown', powerLowRel: 0.75, powerHighRel: 0.5 },
    { key: 'intervals', label: 'Intervals', icon: 'intervals', shortcut: 'I', kind: 'intervals', repeat: 6, onDurationSec: 60, offDurationSec: 60, onPowerRel: 1.1, offPowerRel: 0.55 },
    { key: 'freeride', label: 'Freeride', icon: 'freeride', shortcut: 'F', kind: 'freeride', durationSec: 300 },
    { key: 'textevent', label: 'Text', icon: 'text', shortcut: 'X', kind: 'textevent' },
  ];
  const buttonSpecByKey = new Map(buttonSpecs.map((s) => [s.key, s]));

  // --------------------------- derived (snapshots) ---------------------------
  const snapshot = $derived.by(() => {
    void version;
    const ftp = getCurrentFtp() || 0;
    backend.recomputeDerived(ftp);
    return {
      blocks: backend.getCurrentBlocks(),
      metrics: backend.getCurrentMetrics(),
      zone: backend.getCurrentZone(),
      selectedIndex: backend.getSelectedBlockIndex(),
      selectedIndices: backend.getSelectedBlockIndices(),
      insertAfter:
        backend.getInsertAfterOverrideIndex() != null
          ? backend.getInsertAfterOverrideIndex()
          : backend.getInsertAfterIndex(),
      history: backend.getHistoryStatus(),
      hasSelection: backend.hasSelection(),
      ftp,
    };
  });

  const selectedBlock = $derived.by<Block | null>(() => {
    void version;
    return backend.getSelectedBlock();
  });

  const selectionCount = $derived(snapshot.selectedIndices.length);
  const showBlockEditor = $derived(
    selectedTextEventIndex == null && selectionCount > 0 && selectedBlock != null,
  );
  const showToolbarButtons = $derived(
    selectedTextEventIndex == null && !showBlockEditor,
  );

  // --------------------------- stats text ---------------------------
  const statText = $derived.by(() => {
    void version;
    const m = snapshot.metrics;
    const ftp = snapshot.ftp;
    if (!m || m.totalSec === 0) {
      return {
        tss: '--',
        if: '--',
        kj: '--',
        duration: '--',
        ftp: ftp > 0 ? `${Math.round(ftp)} W` : '--',
        zone: snapshot.zone || '--',
      };
    }
    return {
      tss: m.tss != null ? String(Math.round(m.tss)) : '--',
      if: m.ifValue != null ? m.ifValue.toFixed(2) : '--',
      kj: m.kj != null ? String(Math.round(m.kj)) : '--',
      duration: m.totalSec != null ? formatDurationMinSec(m.totalSec) : '--',
      ftp: m.ftp != null ? `${Math.round(m.ftp)} W` : '--',
      zone: snapshot.zone || '--',
    };
  });

  // --------------------------- block editor fields ---------------------------
  interface FieldConfig {
    key: string;
    label: string;
    tooltip: string;
    value: number | null;
    unit: string;
    kind: string;
    step?: number;
    hideLabel?: boolean;
    allowEmpty?: boolean;
    defaultValue?: number;
    onCommit: (val: number | null) => void;
  }

  const blockFields = $derived.by<FieldConfig[]>(() => {
    void version;
    const block = selectedBlock;
    if (!block) return [];
    const idx = backend.getSelectedBlockIndex();
    if (idx == null) return [];
    const list: FieldConfig[] = [];
    const durationSec = Math.round(backend.getBlockDurationSec(block));
    const commitDuration = (val: number | null) =>
      applyAttr(idx, { durationSec: backend.clampDuration(val ?? 0) });

    if (block.kind === 'steady') {
      list.push({ key: 'durationSec', label: 'Duration', tooltip: 'Length of this steady block (seconds).', value: durationSec, unit: 's', kind: 'duration', onCommit: commitDuration });
      list.push({ key: 'powerRel', label: 'Power', tooltip: 'Target power as % of FTP.', value: Math.round(backend.getBlockSteadyPower(block) * 100), unit: '%', kind: 'power', step: 5, onCommit: (val) => applyAttr(idx, { powerRel: backend.clampPowerPercent(val ?? 0) / 100 }) });
      list.push({ key: 'cadenceRpm', label: 'Cadence', tooltip: 'Target cadence (rpm). Leave empty for no target.', value: backend.getBlockCadence(block), unit: 'rpm', kind: 'cadence', step: 5, allowEmpty: true, defaultValue: 90, onCommit: (val) => applyAttr(idx, { cadenceRpm: val }) });
    } else if (block.kind === 'warmup' || block.kind === 'cooldown') {
      list.push({ key: 'durationSec', label: 'Duration', tooltip: 'Length of this ramp block (seconds).', value: durationSec, unit: 's', kind: 'duration', onCommit: commitDuration });
      list.push({ key: 'powerLowRel', label: 'Power Low', tooltip: 'Starting power as % of FTP.', value: Math.round(backend.getRampLow(block) * 100), unit: '%', kind: 'power', step: 5, onCommit: (val) => applyAttr(idx, { powerLowRel: backend.clampPowerPercent(val ?? 0) / 100 }) });
      list.push({ key: 'powerHighRel', label: 'Power High', tooltip: 'Ending power as % of FTP.', value: Math.round(backend.getRampHigh(block) * 100), unit: '%', kind: 'power', step: 5, onCommit: (val) => applyAttr(idx, { powerHighRel: backend.clampPowerPercent(val ?? 0) / 100 }) });
      list.push({ key: 'cadenceRpm', label: 'Cadence', tooltip: 'Target cadence (rpm). Leave empty for no target.', value: backend.getBlockCadence(block), unit: 'rpm', kind: 'cadence', step: 5, allowEmpty: true, defaultValue: 90, onCommit: (val) => applyAttr(idx, { cadenceRpm: val }) });
    } else if (block.kind === 'freeride') {
      list.push({ key: 'durationSec', label: 'Duration', tooltip: 'Length of this free ride block (seconds).', value: durationSec, unit: 's', kind: 'duration', onCommit: commitDuration });
    } else if (block.kind === 'intervals') {
      const intervals = backend.getIntervalParts(block);
      list.push({ key: 'repeat', label: 'Reps', tooltip: 'Number of on/off pairs.', value: Math.max(1, Math.round(intervals.repeat)), unit: '', kind: 'repeat', step: 1, onCommit: (val) => applyAttr(idx, { repeat: backend.clampRepeat(val ?? 1) }) });
      list.push({ key: 'onDurationSec', label: 'On', tooltip: 'Work interval length (seconds).', value: Math.round(intervals.onDurationSec), unit: 's', kind: 'duration', onCommit: (val) => applyAttr(idx, { onDurationSec: backend.clampDuration(val ?? 0) }) });
      list.push({ key: 'onPowerRel', label: 'Power', tooltip: 'Work interval power (% FTP).', value: Math.round(intervals.onPowerRel * 100), unit: '%', kind: 'power', step: 5, hideLabel: true, onCommit: (val) => applyAttr(idx, { onPowerRel: backend.clampPowerPercent(val ?? 0) / 100 }) });
      list.push({ key: 'onCadenceRpm', label: 'Cadence', tooltip: 'Work interval cadence (rpm). Leave empty for no target.', value: intervals.onCadenceRpm, unit: 'rpm', kind: 'cadence', step: 5, allowEmpty: true, defaultValue: 90, hideLabel: true, onCommit: (val) => applyAttr(idx, { onCadenceRpm: val }) });
      list.push({ key: 'offDurationSec', label: 'Off', tooltip: 'Recovery interval length (seconds).', value: Math.round(intervals.offDurationSec), unit: 's', kind: 'duration', onCommit: (val) => applyAttr(idx, { offDurationSec: backend.clampDuration(val ?? 0) }) });
      list.push({ key: 'offPowerRel', label: 'Power', tooltip: 'Recovery interval power (% FTP).', value: Math.round(intervals.offPowerRel * 100), unit: '%', kind: 'power', step: 5, hideLabel: true, onCommit: (val) => applyAttr(idx, { offPowerRel: backend.clampPowerPercent(val ?? 0) / 100 }) });
      list.push({ key: 'offCadenceRpm', label: 'Cadence', tooltip: 'Recovery cadence (rpm). Leave empty for no target.', value: intervals.offCadenceRpm, unit: 'rpm', kind: 'cadence', step: 5, allowEmpty: true, defaultValue: 90, hideLabel: true, onCommit: (val) => applyAttr(idx, { offCadenceRpm: val }) });
    }
    return list;
  });

  // --------------------------- text event editor ---------------------------
  const selectedTextEvent = $derived.by(() => {
    void version;
    if (selectedTextEventIndex == null) return null;
    return backend.getTextEvents()[selectedTextEventIndex] || null;
  });

  // --------------------------- mutations ---------------------------
  function applyAttr(idx: number, attrs: Record<string, unknown>): void {
    backend.applyBlockAttrUpdate(idx, attrs as any);
    bump();
  }

  function insertSpec(spec: ButtonSpec, selectOnInsert: boolean): void {
    if (spec.kind === 'textevent') {
      insertTextEvent();
      return;
    }
    backend.insertBlockAtInsertionPoint(spec as any, { selectOnInsert });
    bump();
  }

  function insertTextEvent(): void {
    const blocks = backend.getCurrentBlocks();
    const { timings } = backend.buildBlockTimings(blocks);
    const insertAfter =
      backend.getInsertAfterOverrideIndex() != null
        ? backend.getInsertAfterOverrideIndex()
        : backend.getInsertAfterIndex();
    let offsetSec = 0;
    if (timings.length) {
      const safeIndex =
        insertAfter == null ? -1 : Math.max(-1, Math.min(insertAfter, timings.length - 1));
      if (safeIndex >= 0) offsetSec = timings[safeIndex]?.tEnd || 0;
    }
    const nextIndex = backend.addTextEvent({ offsetSec, durationSec: 10, text: '' });
    selectedTextEventIndex = nextIndex;
    bump();
  }

  function deleteSelected(): void {
    backend.deleteSelectedBlock();
    bump();
  }
  function moveSelected(direction: number): void {
    backend.moveSelectedBlock(direction);
    bump();
  }
  function undo(): void {
    backend.undoLastChange();
    applyMetaFromBackend();
    bump();
  }
  function redo(): void {
    backend.redoLastChange();
    applyMetaFromBackend();
    bump();
  }

  function updateSelectedTextEvent(updates: Record<string, unknown>): void {
    if (selectedTextEventIndex == null) return;
    backend.updateTextEvent(selectedTextEventIndex, updates as any);
    bump();
  }
  function clearSelectedTextEvent(): void {
    if (selectedTextEventIndex == null) return;
    selectedTextEventIndex = null;
    bump();
  }

  // --------------------------- clipboard ---------------------------
  // Faithful port of docs/workout-builder.js copy/cut/pasteFromClipboard. The
  // wire format (ZWO XML for blocks, VELO_TEXT_EVENTS:{json} for a lone text
  // event) lives in core/builder-backend.ts as pure encode/parse functions;
  // here we only do the navigator.clipboard I/O.
  async function clipboardWrite(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn('[Builder] Clipboard write failed:', err);
    }
  }
  async function copySelectionToClipboard(): Promise<void> {
    if (!backend.hasSelection() && selectedTextEventIndex == null) return;
    if (!backend.hasSelection() && selectedTextEventIndex != null) {
      const evt = backend.getTextEvents()[selectedTextEventIndex];
      if (!evt) return;
      await clipboardWrite(encodeTextEventClipboard([evt]));
      return;
    }
    const indices = backend.getSelectedIndicesSorted();
    const blocks = indices.map((i) => backend.getCurrentBlocks()[i]).filter(Boolean) as Block[];
    const rawSegments = backend.buildRawSegmentsFromBlocks(blocks);
    if (!rawSegments.length) return;
    const textEvents = backend.getTextEventsForSelection();
    await clipboardWrite(encodeClipboard(rawSegments, textEvents));
  }
  async function cutSelectionToClipboard(): Promise<void> {
    await copySelectionToClipboard();
    deleteSelected();
  }
  async function pasteFromClipboard(): Promise<void> {
    if (!navigator.clipboard?.readText) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.warn('[Builder] Clipboard read failed:', err);
      return;
    }
    const payload = parseClipboard(text);
    if (!payload) return;
    if (payload.kind === 'textEvents') {
      backend.insertTextEventsAtInsertionPoint(payload.textEvents);
      bump();
      return;
    }
    const blocks = backend.segmentsToBlocks(payload.canonical.rawSegments);
    if (!blocks.length) return;
    backend.insertBlocksAtInsertionPoint(blocks, {
      selectOnInsert: false,
      textEvents: payload.canonical.textEvents || [],
    });
    bump();
  }

  function setSelectedBlock(idx: number | null): void {
    clearSelectedTextEventNoBump();
    backend.setSelectedBlock(idx);
    backend.startHistoryGroup();
    bump();
    emitUi();
  }
  function clearSelectedTextEventNoBump(): void {
    selectedTextEventIndex = null;
  }
  function deselectBlock(): void {
    selectedTextEventIndex = null;
    backend.deselectBlock();
    backend.startHistoryGroup();
    bump();
    emitUi();
  }

  function emitUi(): void {
    onUiStateChange?.({ hasSelection: backend.hasSelection() });
  }

  function syncMetaToBackend(): void {
    const title = (nameValue || 'Custom workout').trim() || 'Custom workout';
    backend.setMeta({
      workoutTitle: title,
      source: (sourceValue || '').trim(),
      description: descValue || '',
      sourceURL: (urlValue || '').trim(),
    });
  }

  function applyMetaFromBackend(): void {
    const meta = backend.getMeta();
    nameValue = meta.workoutTitle || '';
    sourceValue = meta.source || '';
    descValue = meta.description || '';
    urlValue = meta.sourceURL || '';
    autoGrow();
  }

  function autoGrow(): void {
    if (!descTextarea) return;
    descTextarea.style.height = 'auto';
    descTextarea.style.height = descTextarea.scrollHeight + 'px';
  }

  function onMetaInput(): void {
    syncMetaToBackend();
    bump();
  }

  // --------------------------- status / validation ---------------------------
  let statusText = $state('Not checked yet.');
  let statusTone = $state('neutral');
  function setStatus(text: string, tone: string): void {
    statusText = text;
    statusTone = tone;
    onStatusChange?.({ text, tone });
  }

  // emit empty/no-error status as the model changes (mirrors updateErrorStyling).
  $effect(() => {
    void version;
    const blocks = backend.getCurrentBlocks();
    if (!blocks || !blocks.length) {
      setStatus('Empty workout. Add elements to begin.', 'neutral');
    } else {
      setStatus('No errors detected.', 'ok');
    }
    emitUi();
  });

  // --------------------------- imperative chart render ---------------------------
  $effect(() => {
    void version;
    // Redraw on an Auto-mode OS light/dark flip too (charts read CSS-var colors
    // at draw time; J-DARK-06 / J-CFG-13). Uses themeAutoVersion (matchMedia
    // path only) to match legacy workout-picker.js — a manual data-theme toggle
    // does not redraw the builder there, keeping the dark visual baseline valid.
    void themeAutoVersion();
    if (!chartHost) return;
    const ftp = getCurrentFtp() || 0;
    const prevScrollLeft = chartContainer ? chartContainer.scrollLeft : 0;
    renderBuilderWorkoutGraph(chartHost, backend.getCurrentBlocks(), ftp, {
      selectedBlockIndex: backend.getSelectedBlockIndex(),
      selectedBlockIndices: backend.getSelectedBlockIndices(),
      textEvents: backend.getTextEvents(),
      activeTextEventIndex: selectedTextEventIndex,
      insertAfterBlockIndex:
        dragInsertAfterIndex != null
          ? dragInsertAfterIndex
          : backend.getInsertAfterOverrideIndex() != null
            ? backend.getInsertAfterOverrideIndex()
            : backend.getInsertAfterIndex(),
      lockTimelineSec:
        dragState && dragState.handle === 'right'
          ? dragState.lockedTimelineSec
          : timelineLockSec,
      onSelectBlock: handleBlockSelectionFromChart,
      onSetInsertAfter: handleInsertAfterFromChart,
      onSetInsertAfterFromSegment: handleInsertAfterFromSegment,
    });
    if (chartContainer) chartContainer.scrollLeft = prevScrollLeft;
  });

  function handleBlockSelectionFromChart(
    idx: number | null,
    opts: { shiftKey?: boolean } = {},
  ): void {
    if (idx == null) {
      deselectBlock();
      return;
    }
    // Shift-click range-select (docs/workout-builder.js:1362). Extend from the
    // existing anchor to the clicked block via the cursor-based selection.
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
      const anchorCursor = backend.clampCursorIndex(isRight ? anchor - 1 : anchor);
      const cursorIndex = backend.clampCursorIndex(isRight ? idx : idx - 1);
      clearSelectedTextEventNoBump();
      backend.setInsertAfterOverrideIndex(cursorIndex);
      backend.setSelectionFromCursors(anchorCursor, cursorIndex, { preserveInsert: true });
      bump();
      emitUi();
      return;
    }
    setSelectedBlock(idx);
  }
  function handleInsertAfterFromChart(idx: number): void {
    selectedTextEventIndex = null;
    backend.setInsertAfterIndex(idx);
    backend.startHistoryGroup();
    bump();
    emitUi();
  }
  function handleInsertAfterFromSegment(idx: number): void {
    backend.setInsertAfterOverrideIndex(idx);
    bump();
  }

  // --------------------------- drag engine (chart pointer) ---------------------------
  function handleChartPointerDown(e: PointerEvent): void {
    if (e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (!chartHost) return;
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks.length) return;
    const hitEls = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];

    // Text-event hit -> select it (drag offset simplified to a click-select).
    const textEventEl = hitEls
      .find((el) => el && el.closest && el.closest('[data-text-event-index]'))
      ?.closest('[data-text-event-index]') as HTMLElement | undefined;
    if (textEventEl && chartHost.contains(textEventEl)) {
      const tIdx = Number(textEventEl.dataset.textEventIndex);
      if (Number.isFinite(tIdx)) {
        e.preventDefault();
        selectedTextEventIndex = tIdx;
        backend.deselectBlock();
        bump();
      }
      return;
    }

    const activeEl = hitEls[0];
    const handleEl =
      activeEl && activeEl.closest ? (activeEl.closest('[data-drag-handle]') as HTMLElement | null) : null;
    if (!handleEl) return;
    const handle = handleEl.dataset.dragHandle;
    const blockIndex = Number(handleEl.dataset.blockIndex);
    const segIndex = Number(handleEl.dataset.segIndex);
    if (!Number.isFinite(blockIndex) || !Number.isFinite(segIndex)) return;

    const svg = chartHost.querySelector('svg');
    if (!svg) return;
    e.preventDefault();
    if (handleEl.setPointerCapture) handleEl.setPointerCapture(e.pointerId);

    const rect = svg.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const { timings: segmentTimings, totalSec } = backend.buildSegmentTimings(currentBlocks);
    const segmentTiming = segmentTimings.find(
      (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
    );
    const ftp = getCurrentFtp() || 0;
    const safeFtp = ftp > 0 ? ftp : 200;
    const maxTarget = currentBlocks.reduce((max, block) => {
      const segs = Array.isArray(block?.segments) ? block.segments : [];
      return segs.reduce((segMax, seg) => {
        const pStartRel = Number(seg?.pStartRel) || 0;
        const pEndRel = seg?.pEndRel != null ? Number(seg.pEndRel) : pStartRel;
        return Math.max(segMax, pStartRel * safeFtp, pEndRel * safeFtp);
      }, max);
    }, 0);
    const maxY = getScaledMaxY({ ftp: safeFtp, peak: maxTarget, minBase: 200 });
    const block = currentBlocks[blockIndex];
    if (!block || !segmentTiming) return;

    let rampRegion: string | null = null;
    if (handle === 'top') {
      const x1 = Number(handleEl.dataset.x1);
      const x2 = Number(handleEl.dataset.x2);
      if (Number.isFinite(x1) && Number.isFinite(x2)) {
        const third = (x2 - x1) / 3;
        if (localX <= x1 + third) rampRegion = 'left';
        else if (localX >= x2 - third) rampRegion = 'right';
        else rampRegion = 'middle';
      } else {
        rampRegion = 'middle';
      }
    }

    setSelectedBlock(blockIndex);

    dragState = {
      pointerId: e.pointerId,
      handle,
      blockIndex,
      segIndex,
      width: rect.width,
      height: rect.height,
      maxY,
      ftp: safeFtp,
      tStart: segmentTiming.tStart,
      blockKind: block.kind,
      lockedTimelineSec: Math.max(3600, totalSec || 0),
      rampRegion,
      startLow: backend.getRampLow(block),
      startHigh: backend.getRampHigh(block),
      startClientX: e.clientX,
      startClientY: e.clientY,
      didDrag: false,
    };
    dragInsertAfterIndex = null;
    if (handle === 'right') timelineLockSec = dragState.lockedTimelineSec || 0;
    // Legacy workout-builder.js:2548 — drives the `grabbing` cursor for the
    // move-drag handle (workout-picker.css:1307 `body.wb-dragging …--move`).
    document.body.classList.add('wb-dragging');
    window.addEventListener('pointermove', handleChartPointerMove);
    window.addEventListener('pointerup', handleChartPointerUp);
    window.addEventListener('pointercancel', handleChartPointerUp);
  }

  function handleChartPointerMove(e: PointerEvent): void {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const currentBlocks = backend.getCurrentBlocks();
    if (!currentBlocks.length) return;
    const { handle, blockIndex, segIndex, maxY, ftp, tStart, blockKind, rampRegion, startLow, startHigh } = dragState;
    const svg = chartHost ? chartHost.querySelector('svg') : null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const { totalSec } = backend.buildBlockTimings(currentBlocks);
    const timelineSec = Math.max(3600, totalSec || 0);
    const effectiveTimelineSec =
      handle === 'right' && dragState?.lockedTimelineSec
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

    const powerW = (1 - clampedY / Math.max(1, height)) * maxY;
    const powerRel = backend.snapPowerRel(powerW / Math.max(1, ftp));

    if (handle === 'top') {
      if (blockKind === 'steady') {
        applyAttr(blockIndex, { powerRel });
        return;
      }
      if (blockKind === 'warmup' || blockKind === 'cooldown') {
        if (rampRegion === 'left') applyAttr(blockIndex, { powerLowRel: powerRel });
        else if (rampRegion === 'right') applyAttr(blockIndex, { powerHighRel: powerRel });
        else {
          const startMid = (startLow + startHigh) / 2;
          const delta = powerRel - startMid;
          applyAttr(blockIndex, {
            powerLowRel: backend.clampRel(startLow + delta),
            powerHighRel: backend.clampRel(startHigh + delta),
          });
        }
        return;
      }
      if (blockKind === 'intervals') {
        const role = segIndex % 2 === 0 ? 'on' : 'off';
        if (role === 'on') applyAttr(blockIndex, { onPowerRel: powerRel });
        else applyAttr(blockIndex, { offPowerRel: powerRel });
      }
      return;
    }

    if (handle === 'right') {
      const timeSec = (clampedX / Math.max(1, width)) * effectiveTimelineSec;
      const duration = backend.snapDurationSec(timeSec - tStart);
      if (blockKind === 'steady' || blockKind === 'freeride' || blockKind === 'warmup' || blockKind === 'cooldown') {
        applyAttr(blockIndex, { durationSec: duration });
        return;
      }
      if (blockKind === 'intervals') {
        const role = segIndex % 2 === 0 ? 'on' : 'off';
        const parts = backend.getIntervalParts(currentBlocks[blockIndex] || null);
        const repIndex = Math.floor(segIndex / 2);
        const scale = Math.max(1, repIndex + 1);
        const { timings: blockTimings } = backend.buildBlockTimings(currentBlocks);
        const blockStartSec = blockTimings.find((t) => t.index === blockIndex)?.tStart ?? 0;
        if (role === 'on') {
          const rawDuration = (timeSec - blockStartSec - repIndex * parts.offDurationSec) / scale;
          applyAttr(blockIndex, { onDurationSec: backend.snapDurationSec(rawDuration) });
        } else {
          const rawDuration = (timeSec - blockStartSec - scale * parts.onDurationSec) / scale;
          applyAttr(blockIndex, { offDurationSec: backend.snapDurationSec(rawDuration) });
        }
      }
    }
  }

  function handleChartPointerUp(e: PointerEvent): void {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    if (dragState.handle === 'right') timelineLockSec = 0;
    dragState = null;
    dragInsertAfterIndex = null;
    document.body.classList.remove('wb-dragging');
    bump();
    window.removeEventListener('pointermove', handleChartPointerMove);
    window.removeEventListener('pointerup', handleChartPointerUp);
    window.removeEventListener('pointercancel', handleChartPointerUp);
  }

  // --------------------------- keyboard (vim keymap subset) ---------------------------
  function handleKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) {
      return;
    }
    const key = e.key;
    const lower = key.toLowerCase();
    const currentBlocks = backend.getCurrentBlocks();
    const selectedBlockIndices = backend.getSelectedBlockIndices();
    const selectedBlockIndex = backend.getSelectedBlockIndex();
    const selCount = selectedBlockIndices.length;
    const hasSel = selCount > 0;
    const hasTextSel = selectedTextEventIndex != null;
    const single = selCount === 1;
    const block = single && selectedBlockIndex != null ? currentBlocks[selectedBlockIndex] : null;
    const isMeta = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

    const isUndo = (isMeta && lower === 'z') || (!e.metaKey && !e.ctrlKey && !e.altKey && lower === 'u' && !e.shiftKey);
    if (isUndo) { e.preventDefault(); undo(); return; }
    const isRedo = ((e.metaKey || e.ctrlKey) && !e.altKey && ((lower === 'z' && e.shiftKey) || lower === 'y')) || (!e.metaKey && !e.ctrlKey && !e.altKey && lower === 'u' && e.shiftKey);
    if (isRedo) { e.preventDefault(); redo(); return; }

    // Cmd/Ctrl+A / Cmd/Ctrl+E (no selection) -> move the insertion cursor to
    // start / end (docs/workout-builder.js:525-539).
    if (isMeta && !hasSel && currentBlocks.length) {
      if (lower === 'a') { e.preventDefault(); backend.setInsertAfterOverrideIndex(-1); bump(); return; }
      if (lower === 'e') { e.preventDefault(); backend.setInsertAfterOverrideIndex(currentBlocks.length - 1); bump(); return; }
    }

    // Clipboard (docs/workout-builder.js:561-602): Cmd/Ctrl+C/X/V, the legacy
    // Insert/Delete variants, and bare P for paste.
    const isShiftInsert = !e.metaKey && !e.ctrlKey && e.shiftKey && key === 'Insert';
    const isShiftDelete = !e.metaKey && !e.ctrlKey && e.shiftKey && key === 'Delete';
    const isCtrlInsert = (e.metaKey || e.ctrlKey) && !e.altKey && key === 'Insert';
    if (isMeta && lower === 'c') { e.preventDefault(); void copySelectionToClipboard(); return; }
    if (isMeta && lower === 'x') { e.preventDefault(); void cutSelectionToClipboard(); return; }
    if (isMeta && lower === 'v') { e.preventDefault(); void pasteFromClipboard(); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && lower === 'p') { e.preventDefault(); void pasteFromClipboard(); return; }
    if (isCtrlInsert) { e.preventDefault(); void copySelectionToClipboard(); return; }
    if (isShiftInsert) { e.preventDefault(); void pasteFromClipboard(); return; }
    if (isShiftDelete) { e.preventDefault(); void cutSelectionToClipboard(); return; }

    // Shift+H/L/Arrows -> extend the multi-block selection by cursor
    // (docs/workout-builder.js:604-619).
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey &&
        (lower === 'h' || lower === 'l' || key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      const direction = lower === 'h' || key === 'ArrowLeft' ? -1 : 1;
      backend.shiftMoveSelection(direction);
      bump();
      emitUi();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Multi-selection Y -> copy then deselect (docs/workout-builder.js:623-629).
    if (selCount > 1 && lower === 'y') {
      e.preventDefault();
      void copySelectionToClipboard();
      deselectBlock();
      return;
    }

    const insertByKey = (specKey: string): boolean => {
      const spec = buttonSpecByKey.get(specKey);
      if (!spec) return false;
      insertSpec(spec, true);
      return true;
    };
    const insertMap: Record<string, string> = {
      r: 'recovery', e: 'endurance', t: 'tempo', s: 'threshold', v: 'vo2max',
      a: 'anaerobic', w: 'warmup', c: 'cooldown', i: 'intervals', f: 'freeride', x: 'textevent',
    };
    if (insertMap[lower]) {
      if (insertByKey(insertMap[lower])) e.preventDefault();
      return;
    }

    if (lower === 'd' || key === 'Delete' || key === 'Backspace') {
      if (hasTextSel) {
        e.preventDefault();
        backend.deleteTextEvent(selectedTextEventIndex!);
        clearSelectedTextEvent();
        return;
      }
      if (hasSel) {
        e.preventDefault();
        // Legacy `d` is CUT-to-clipboard (copy+delete); Delete/Backspace are
        // plain delete (docs/workout-builder.js:693-697).
        if (lower === 'd') void cutSelectionToClipboard();
        else deleteSelected();
        return;
      }
      if (currentBlocks.length) {
        const current = backend.getInsertAfterOverrideIndex() != null ? backend.getInsertAfterOverrideIndex() : backend.getInsertAfterIndex();
        if (key === 'Backspace') {
          const prev = current != null ? current : -1;
          if (prev >= 0) { e.preventDefault(); backend.setSelectedBlock(prev); deleteSelected(); }
        } else if (key === 'Delete') {
          const next = current != null ? current + 1 : 0;
          if (next >= 0 && next < currentBlocks.length) { e.preventDefault(); backend.setSelectedBlock(next); deleteSelected(); }
        }
      }
      return;
    }

    if (key === 'Escape' || key === 'Enter') {
      if (hasSel || hasTextSel) {
        e.preventDefault();
        e.stopPropagation();
        if (hasSel) deselectBlock();
        else clearSelectedTextEvent();
        return;
      }
      if (key === 'Escape' && typeof onRequestBack === 'function') {
        e.preventDefault();
        e.stopPropagation();
        onRequestBack();
        return;
      }
      if (key === 'Enter' && currentBlocks.length) {
        e.preventDefault();
        e.stopPropagation();
        const current = backend.getInsertAfterOverrideIndex() != null ? backend.getInsertAfterOverrideIndex() : backend.getInsertAfterIndex();
        const prev = current != null ? Math.min(current, currentBlocks.length - 1) : null;
        setSelectedBlock(prev != null && prev >= 0 ? prev : 0);
      }
      return;
    }

    const powerStepRel = 0.05;
    const stepScale = e.shiftKey ? 5 : 1;
    const scaledPowerStep = powerStepRel * stepScale;

    if (!hasSel) {
      if (!currentBlocks.length) return;
      const cur = () => backend.getInsertAfterOverrideIndex() != null ? backend.getInsertAfterOverrideIndex() : backend.getInsertAfterIndex();
      if (key === 'Home' || lower === 'g') { e.preventDefault(); backend.setInsertAfterOverrideIndex(-1); bump(); return; }
      if (key === 'End' || lower === '$') { e.preventDefault(); backend.setInsertAfterOverrideIndex(currentBlocks.length - 1); bump(); return; }
      if (lower === 'h' || key === 'ArrowLeft') {
        e.preventDefault();
        const next = Math.max(-1, Math.min((cur() ?? -1) - 1, currentBlocks.length - 1));
        backend.setInsertAfterOverrideIndex(next); bump();
      } else if (lower === 'l' || key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.max(-1, Math.min((cur() ?? -1) + 1, currentBlocks.length - 1));
        backend.setInsertAfterOverrideIndex(next); bump();
      } else if (lower === 'j' || lower === 'k' || key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        const delta = lower === 'j' || key === 'ArrowDown' ? -scaledPowerStep : scaledPowerStep;
        const insertAfter = cur();
        const prevIndex = insertAfter != null ? insertAfter : -1;
        backend.applyPowerUpdatesAroundCursor(prevIndex, prevIndex + 1, delta);
        bump();
      }
      return;
    }

    // Multi-selection Space -> toggle insert side to first-1 / last of the
    // range (docs/workout-builder.js:779-784).
    if (!single && hasSel && (key === ' ' || e.code === 'Space')) {
      e.preventDefault();
      e.stopPropagation();
      const sorted = backend.getSelectedIndicesSorted();
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const atEnd = backend.getInsertAfterOverrideIndex() === last;
      backend.setInsertAfterOverrideIndex(atEnd ? first - 1 : last);
      bump();
      return;
    }

    if (!single || !block) return;

    const isInsertionAtEndOfSelection = (): boolean => {
      const insertAfter = backend.getInsertAfterOverrideIndex() != null ? backend.getInsertAfterOverrideIndex() : backend.getInsertAfterIndex();
      return insertAfter === selectedBlockIndex;
    };
    const durationStep = (current: number) => backend.getDurationStep(current);
    const handleDurationChange = (delta: number) => {
      if (block.kind === 'intervals') {
        const parts = backend.getIntervalParts(block);
        const atEnd = isInsertionAtEndOfSelection();
        const next = backend.clampDuration((atEnd ? parts.offDurationSec : parts.onDurationSec) + delta);
        applyAttr(selectedBlockIndex!, { [atEnd ? 'offDurationSec' : 'onDurationSec']: next });
        return;
      }
      const current = backend.getBlockDurationSec(block);
      applyAttr(selectedBlockIndex!, { durationSec: backend.clampDuration(current + delta) });
    };
    const handlePowerChange = (delta: number) => {
      if (block.kind === 'freeride') return;
      if (block.kind === 'steady') {
        applyAttr(selectedBlockIndex!, { powerRel: backend.clampRel(backend.getBlockSteadyPower(block) + delta) });
        return;
      }
      if (block.kind === 'warmup' || block.kind === 'cooldown') {
        const atEnd = isInsertionAtEndOfSelection();
        const current = atEnd ? backend.getRampHigh(block) : backend.getRampLow(block);
        applyAttr(selectedBlockIndex!, { [atEnd ? 'powerHighRel' : 'powerLowRel']: backend.clampRel(current + delta) });
        return;
      }
      if (block.kind === 'intervals') {
        const parts = backend.getIntervalParts(block);
        const atEnd = isInsertionAtEndOfSelection();
        applyAttr(selectedBlockIndex!, { [atEnd ? 'offPowerRel' : 'onPowerRel']: backend.clampRel((atEnd ? parts.offPowerRel : parts.onPowerRel) + delta) });
      }
    };

    if (lower === 'h' || key === 'ArrowLeft') {
      e.preventDefault();
      const step = block.kind === 'intervals' ? durationStep(backend.getIntervalParts(block).onDurationSec) : durationStep(backend.getBlockDurationSec(block));
      handleDurationChange(-step * stepScale);
    } else if (lower === 'l' || key === 'ArrowRight') {
      e.preventDefault();
      const step = block.kind === 'intervals' ? durationStep(backend.getIntervalParts(block).onDurationSec) : durationStep(backend.getBlockDurationSec(block));
      handleDurationChange(step * stepScale);
    } else if (lower === 'j' || key === 'ArrowDown') {
      e.preventDefault();
      handlePowerChange(-scaledPowerStep);
    } else if (lower === 'k' || key === 'ArrowUp') {
      e.preventDefault();
      handlePowerChange(scaledPowerStep);
    } else if (key === ' ' || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      const atEnd = isInsertionAtEndOfSelection();
      backend.setInsertAfterOverrideIndex(atEnd ? selectedBlockIndex! - 1 : selectedBlockIndex!);
      bump();
    }
  }

  // --------------------------- stepper helper ---------------------------
  function stepperAdjust(cfg: FieldConfig, dir: 1 | -1, inputEl: HTMLInputElement): void {
    if (cfg.allowEmpty && inputEl.value.trim() === '') {
      const fallback = Number(cfg.defaultValue);
      if (Number.isFinite(fallback)) {
        inputEl.value = String(fallback);
        cfg.onCommit(fallback);
      }
      return;
    }
    const current = Number(inputEl.value);
    const step = cfg.kind === 'duration'
      ? backend.getDurationStep(Number.isFinite(current) ? current : 0)
      : Number(cfg.step) || 1;
    const next = Number.isFinite(current) ? current + dir * step : dir * step;
    inputEl.value = String(next);
    cfg.onCommit(next);
  }
  function stepperCommit(cfg: FieldConfig, inputEl: HTMLInputElement): void {
    const raw = inputEl.value;
    if (cfg.allowEmpty && (raw == null || String(raw).trim() === '')) {
      cfg.onCommit(null);
      return;
    }
    const n = Number(raw);
    const base = Number.isFinite(n) ? n : Number(cfg.value) || 0;
    cfg.onCommit(base);
  }
  function stepperTitle(cfg: FieldConfig, dir: 1 | -1): string {
    if (cfg.kind === 'duration') return dir < 0 ? 'Decrease duration (H / ←)' : 'Increase duration (L / →)';
    if (cfg.kind === 'power') return dir < 0 ? 'Decrease power (J / ↓ / Shift+J)' : 'Increase power (K / ↑ / Shift+K)';
    if (cfg.kind === 'cadence') return dir < 0 ? 'Decrease cadence (J / ↓)' : 'Increase cadence (K / ↑)';
    if (cfg.kind === 'timestamp') return dir < 0 ? 'Move earlier' : 'Move later';
    return '';
  }

  // --------------------------- icons ---------------------------
  function elementIconPath(kind: string): string {
    switch (kind) {
      case 'steady': return 'M6 6h12v12H6z';
      case 'freeride': return 'M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0v8H3z';
      case 'rampUp': return 'M4 20 L20 20 20 8 4 16 Z';
      case 'rampDown': return 'M4 8 L20 16 20 20 4 20 Z';
      default: return 'M4 20h4v-8H4zm6 0h4v-14h-4zm6 0h4v-10h-4z';
    }
  }

  // --------------------------- lifecycle / public API ---------------------------
  function initDefault(persist = true): void {
    backend.resetHistory();
    // Match the legacy create-default flow: the builder hydrates from its own
    // persisted snapshot, whose title was normalized to "Custom workout" by
    // syncMetaFromInputs (docs/workout-builder.js). So the Name field shows
    // "Custom workout" on a fresh create, not an empty string.
    nameValue = 'Custom workout';
    sourceValue = 'Me';
    descValue = '';
    urlValue = '';
    selectedTextEventIndex = null;
    backend.setDefaultBlocks();
    syncMetaToBackend();
    void persist;
    bump();
    autoGrowSoon();
  }

  function autoGrowSoon(): void {
    requestAnimationFrame(autoGrow);
  }

  api = {
    getState(): CanonicalWorkout {
      syncMetaToBackend();
      return backend.getCanonicalState();
    },
    clearState(): void {
      initDefault(false);
    },
    refreshLayout(): void {
      syncMetaToBackend();
      bump();
      autoGrowSoon();
    },
    validateForSave(): { ok: boolean; errors: string[] } {
      syncMetaToBackend();
      backend.recomputeDerived(getCurrentFtp() || 0);
      const name = (nameValue || '').trim();
      const source = (sourceValue || '').trim();
      const desc = (descValue || '').trim();
      const hasBlocks = backend.getCurrentBlocks().length > 0;
      nameError = false;
      sourceError = false;
      descError = false;
      const errors: { field: string; message: string }[] = [];
      if (!name) errors.push({ field: 'name', message: 'Name is required.' });
      if (!source) errors.push({ field: 'source', message: 'Author / Source is required.' });
      if (!desc) errors.push({ field: 'description', message: 'Description is required.' });
      if (!hasBlocks) errors.push({ field: 'code', message: 'Workout code is empty.' });
      for (const err of errors) {
        if (err.field === 'name') nameError = true;
        else if (err.field === 'source') sourceError = true;
        else if (err.field === 'description') descError = true;
      }
      if (errors.length) setStatus(errors[0]!.message, 'error');
      else setStatus('Ready to save.', 'ok');
      return { ok: errors.length === 0, errors: errors.map((e) => e.message) };
    },
    loadCanonicalWorkout(canonical: CanonicalWorkout): void {
      if (!canonical || !Array.isArray(canonical.rawSegments) || !canonical.rawSegments.length) {
        return;
      }
      backend.resetHistory();
      nameValue = canonical.workoutTitle || '';
      sourceValue = canonical.source || '';
      descValue = canonical.description || '';
      urlValue = canonical.sourceURL || '';
      backend.setMeta({
        workoutTitle: nameValue,
        source: sourceValue,
        description: descValue,
        sourceURL: urlValue,
      });
      backend.commitBlocks(backend.segmentsToBlocks(canonical.rawSegments), { selectIndex: null });
      backend.setTextEvents(canonical.textEvents || []);
      selectedTextEventIndex = null;
      bump();
      autoGrowSoon();
    },
  };

  // Initialize a default workout on mount (host enters create-mode by default;
  // edit-mode calls loadCanonicalWorkout afterwards).
  initDefault(true);

  $effect(() => {
    autoGrowSoon();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="workout-builder">
  <div class="workout-builder-body">
    <!-- Stats card (full width) + toolbar actions -->
    <div class="wb-card wb-stats-card">
      <div class="wb-stats-row">
        <div class="wb-stat-chip"><div class="wb-stat-label">TSS</div><div class="wb-stat-value">{statText.tss}</div></div>
        <div class="wb-stat-chip"><div class="wb-stat-label">IF</div><div class="wb-stat-value">{statText.if}</div></div>
        <div class="wb-stat-chip"><div class="wb-stat-label">kJ</div><div class="wb-stat-value">{statText.kj}</div></div>
        <div class="wb-stat-chip"><div class="wb-stat-label">Duration</div><div class="wb-stat-value">{statText.duration}</div></div>
        <div class="wb-stat-chip"><div class="wb-stat-label">FTP</div><div class="wb-stat-value">{statText.ftp}</div></div>
        <div class="wb-stat-chip"><div class="wb-stat-label">Zone</div><div class="wb-stat-value">{statText.zone}</div></div>

        <div class="wb-toolbar-actions">
          {#if showBlockEditor && selectionCount === 1}
            <button type="button" class="wb-block-move-btn" title="Move block left" onclick={(e) => { e.preventDefault(); moveSelected(-1); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="wb-code-icon"><path d="M14 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" class="wb-block-move-btn" title="Move block right" onclick={(e) => { e.preventDefault(); moveSelected(1); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="wb-code-icon"><path d="M10 6l6 6-6 6" /></svg>
            </button>
          {/if}
          {#if showBlockEditor}
            <button type="button" class="wb-block-delete-btn" data-testid="wb-delete-block" title="Delete selected block (Backspace / Delete)" onclick={(e) => { e.preventDefault(); deleteSelected(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="wb-code-icon"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
            </button>
          {/if}
          <button type="button" class="wb-toolbar-action-btn" data-testid="wb-undo" title="Undo (Ctrl/⌘+Z or U)" disabled={!snapshot.history.canUndo} onclick={(e) => { e.preventDefault(); undo(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8H4l3-3m0 3h6a6 6 0 1 1 0 12H7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="wb-toolbar-action-btn" data-testid="wb-redo" title="Redo (Ctrl/⌘+Shift+Z or Ctrl/⌘+Y)" disabled={!snapshot.history.canRedo} onclick={(e) => { e.preventDefault(); redo(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 8h3l-3-3m0 3h-6a6 6 0 1 0 0 12h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button type="button" class="wb-toolbar-action-btn" title="Copy (Ctrl/⌘+C or Ctrl/⌘+Insert)" disabled={!snapshot.hasSelection} onclick={(e) => { e.preventDefault(); void copySelectionToClipboard(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><rect x="8" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
          <button type="button" class="wb-toolbar-action-btn" title="Paste (Ctrl/⌘+V or Shift+Insert)" onclick={(e) => { e.preventDefault(); void pasteFromClipboard(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="7" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><rect x="9" y="3" width="6" height="4" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Chart card -->
    <div class="wb-card wb-chart-card">
      <div class="wb-chart-container" bind:this={chartContainer}>
        <div
          class="wb-chart-mini-host"
          data-testid="wb-chart"
          bind:this={chartHost}
          onpointerdown={handleChartPointerDown}
        ></div>
      </div>
    </div>

    <!-- Text event card -->
    {#if selectedTextEvent}
      <div class="wb-card wb-text-event-card" style="display: flex">
        <div class="wb-text-event-editor">
          <div class="wb-block-field" data-kind="duration">
            <label class="wb-block-field-label" title="How long the text event shows (seconds).">Duration</label>
            <div class="control-group wb-block-stepper">
              <button type="button" class="control-btn" onclick={() => updateSelectedTextEvent({ durationSec: Math.max(1, (selectedTextEvent?.durationSec || 10) - 1) })}>-</button>
              <div class="control-value">
                <input class="settings-ftp-input wb-block-stepper-input" type="number" inputmode="numeric" value={Math.max(1, Math.round(selectedTextEvent?.durationSec || 10))} onchange={(e) => updateSelectedTextEvent({ durationSec: Number((e.currentTarget as HTMLInputElement).value) })} />
                <span class="settings-ftp-unit wb-block-unit">s</span>
              </div>
              <button type="button" class="control-btn" onclick={() => updateSelectedTextEvent({ durationSec: (selectedTextEvent?.durationSec || 10) + 1 })}>+</button>
            </div>
          </div>
          <div class="wb-block-field" data-kind="timestamp">
            <label class="wb-block-field-label" title="When this text event appears (seconds from start).">Starts at</label>
            <div class="control-group wb-block-stepper">
              <button type="button" class="control-btn" onclick={() => updateSelectedTextEvent({ offsetSec: Math.max(0, (selectedTextEvent?.offsetSec || 0) - 15) })}>-</button>
              <div class="control-value">
                <input class="settings-ftp-input wb-block-stepper-input" type="number" inputmode="numeric" step="15" value={Math.max(0, Math.round(selectedTextEvent?.offsetSec || 0))} onchange={(e) => updateSelectedTextEvent({ offsetSec: Number((e.currentTarget as HTMLInputElement).value) })} />
                <span class="settings-ftp-unit wb-block-unit">s</span>
              </div>
              <button type="button" class="control-btn" onclick={() => updateSelectedTextEvent({ offsetSec: (selectedTextEvent?.offsetSec || 0) + 15 })}>+</button>
            </div>
          </div>
          <div class="wb-block-field wb-text-event-field">
            <label class="wb-block-field-label" for="wbTextEventInput">Text</label>
            <input id="wbTextEventInput" type="text" class="wb-text-event-input" placeholder="Cue text" value={selectedTextEvent?.text || ''} oninput={(e) => updateSelectedTextEvent({ text: (e.currentTarget as HTMLInputElement).value })} />
          </div>
        </div>
      </div>
    {/if}

    <!-- Toolbar card -->
    <div class="wb-card wb-toolbar-card" bind:this={toolbarCard} style:display={selectedTextEventIndex != null ? 'none' : ''}>
      <div class="wb-code-toolbar">
        {#if showToolbarButtons}
          <div class="wb-code-toolbar-buttons" data-testid="wb-toolbar-buttons">
            {#each buttonSpecs as spec (spec.key)}
              <button
                type="button"
                class="wb-code-insert-btn {spec.zoneClass || ''}"
                class:wb-code-insert-btn--icon-only={labelMode === 'icon'}
                data-key={spec.key}
                data-testid="wb-insert-{spec.key}"
                title={spec.shortcut ? `${spec.label} (${spec.shortcut})` : spec.label}
                onclick={() => insertSpec(spec, false)}
              >
                {#if spec.icon === 'text'}
                  <svg viewBox="0 0 24 24" class="wb-code-icon">
                    <path d="M5 5h14v10H10l-5 4v-4H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M8 9h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    <path d="M8 12h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                {:else}
                  <svg viewBox="0 0 24 24" class="wb-code-icon"><path fill="currentColor" d={elementIconPath(spec.icon)} /></svg>
                {/if}
                <span data-label-full={spec.label} data-label-short={spec.shortLabel} style:display={labelMode === 'icon' ? 'none' : ''}>{labelFor(spec)}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if showBlockEditor}
          <div class="wb-block-editor" data-testid="wb-block-editor" style="display: flex">
            <div class="wb-block-editor-fields">
              {#each blockFields as cfg (cfg.key)}
                <div class="wb-block-field" class:wb-block-field--nolabel={cfg.hideLabel} data-kind={cfg.kind} title={cfg.hideLabel ? cfg.tooltip : undefined}>
                  {#if !cfg.hideLabel}
                    <label class="wb-block-field-label" title={cfg.tooltip}>{cfg.label}</label>
                  {/if}
                  <div class="control-group wb-block-stepper">
                    <button type="button" class="control-btn" title={stepperTitle(cfg, -1)} onclick={(e) => stepperAdjust(cfg, -1, ((e.currentTarget as HTMLElement).parentElement!.querySelector('input') as HTMLInputElement))}>-</button>
                    <div class="control-value">
                      <input
                        class="settings-ftp-input wb-block-stepper-input"
                        type="number"
                        inputmode="numeric"
                        step={cfg.step ?? undefined}
                        data-testid="wb-field-{cfg.key}"
                        value={cfg.allowEmpty && cfg.value == null ? '' : (cfg.value ?? 0)}
                        onchange={(e) => stepperCommit(cfg, e.currentTarget as HTMLInputElement)}
                        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepperCommit(cfg, e.currentTarget as HTMLInputElement); } }}
                      />
                      {#if cfg.unit}<span class="settings-ftp-unit wb-block-unit">{cfg.unit}</span>{/if}
                    </div>
                    <button type="button" class="control-btn" title={stepperTitle(cfg, 1)} onclick={(e) => stepperAdjust(cfg, 1, ((e.currentTarget as HTMLElement).parentElement!.querySelector('input') as HTMLInputElement))}>+</button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Meta (name/source) + description -->
    <div class="wb-top-row">
      <div class="wb-card wb-top-card">
        <div class="wb-meta-fields">
          <div class="wb-field">
            <label class="wb-field-label">Name</label>
            <input class="wb-field-input" class:wb-input-error={nameError} type="text" data-testid="wb-name" bind:value={nameValue} oninput={onMetaInput} />
          </div>
          <div class="wb-field">
            <label class="wb-field-label">Author / Source</label>
            <input class="wb-field-input" class:wb-input-error={sourceError} type="text" data-testid="wb-source" bind:value={sourceValue} oninput={onMetaInput} />
          </div>
        </div>
      </div>
      <div class="wb-card wb-description-card">
        <div class="wb-field">
          <label class="wb-field-label">Description</label>
          <textarea
            class="wb-field-textarea"
            class:wb-input-error={descError}
            data-testid="wb-description"
            placeholder="Short description, goals, or cues (optional)"
            bind:this={descTextarea}
            bind:value={descValue}
            oninput={() => { onMetaInput(); autoGrow(); }}
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</div>
