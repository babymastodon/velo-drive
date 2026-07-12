<script lang="ts">
  // PlannerView — the workout planner (the `.planner-only` half of
  // #workoutPickerOverlay/#workoutPickerModal). Implements: the infinite-ish week
  // calendar (an initial 16-week window, offsets -8..+7 around today, scrolled so
  // today's week sits one row down), history cards on past days, scheduled cards
  // on future days, the ride detail view (stat chips + power curve +
  // planned-vs-actual chart), the 3/7/30-day totals footer, scheduling a workout
  // on a day, and deleting a ride to trash.
  //
  // Scheduling a workout on a day re-opens the workout LIBRARY in schedule mode
  // (ui.openPickerForSchedule → PickerView): the user browses + picks ANY workout
  // for the day, the picker writes schedule.json and returns to this planner
  // overlay. See onScheduleDay / onEditScheduled below.
  //
  // Drag-and-drop reschedule, the `?`-held hotkey overlay, and keyboard-nav
  // scroll-into-view are all below.
  //
  // SIMPLIFICATION:
  //  * Scrolling renders the fixed initial 16-week window rather than recycling
  //    rows on scroll — deep scroll just stops instead of paging. Keyboard
  //    day-nav stays within this window and scrolls the selected cell into view
  //    (scrollSelectedIntoView).
  import { tick } from 'svelte';
  import OverlayModal from './OverlayModal.svelte';
  import type { FileStore } from '../ports/FileStore.js';
  import type { UiStore } from '../state/ui.svelte.js';
  import type { EngineStore } from '../state/engine.svelte.js';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { DialogStore } from '../state/dialog.svelte.js';
  import type { CanonicalWorkout, RawSegment } from '../core/model.js';
  import {
    DEFAULT_FTP,
    computeScheduledMetrics,
    formatDurationMinSec,
  } from '../core/metrics.js';
  import {
    buildRideDetail,
    type HistoryPreview,
    type RideDetail,
  } from '../core/history.js';
  import { buildCalendarWeeks, type DayCell } from '../core/calendar.js';
  import { drawMiniHistoryChart, drawPowerCurveChart, drawWorkoutChart } from '../core/chart.js';
  import { formatDateKey as formatKey } from '../core/date-keys.js';
  import { isEditableTarget } from './dom-utils.js';
  import { themeVersion } from '../state/theme.svelte.js';

  let {
    store,
    engine,
    fileStore,
    ui,
    dialogs,
    open = false,
  }: {
    store: EngineStore;
    engine: WorkoutEngine;
    fileStore: FileStore;
    ui: UiStore;
    dialogs: DialogStore;
    open?: boolean;
  } = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const VISIBLE_WEEKS = 16;

  const currentFtp = $derived(store.vm?.currentFtp || DEFAULT_FTP);

  // --------------------------- date helpers ---------------------------
  function startOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
  function keyToDate(key: string): Date {
    const [y, m, d] = key.split('-').map((n) => Number(n));
    return new Date(y as number, (m || 1) - 1, d || 1);
  }
  function utcDateKeyToLocalDate(key: string): Date | null {
    if (!key) return null;
    const [y, m, d] = key.split('-').map((n) => Number(n));
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }
  function formatSelectedLabel(date: Date | null): string {
    if (!date) return '';
    try {
      return date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return date.toDateString();
    }
  }
  // FIT filenames are UTC ISO strings; derive the local day key.
  function dateKeyFromHandleName(name: string): string | null {
    const isoPart = (name.split(' ')[0] || '');
    const m = isoPart.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/);
    if (m) {
      const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
      if (!Number.isNaN(d.getTime())) return formatKey(d);
    }
    const datePart = isoPart.split('T')[0];
    if (!datePart || datePart.length < 10) return null;
    const asDate = utcDateKeyToLocalDate(datePart);
    return asDate ? formatKey(asDate) : null;
  }

  // --------------------------- planner state ---------------------------
  // HistoryPreview is owned by WebFileStore (which computes + caches it).
  interface ScheduledPreview {
    date: string;
    workoutTitle: string;
    canonical: CanonicalWorkout | null;
    rawSegments: RawSegment[];
    durationSec: number;
    kj: number | null;
    ifValue: number | null;
    tss: number | null;
    zone: string;
    missing: boolean;
  }

  let today = $state(new Date());
  let selectedDate = $state<Date | null>(null);
  let anchorStart = $state(new Date());
  let historyMap = $state<Map<string, HistoryPreview[]>>(new Map());
  let scheduledMap = $state<Map<string, ScheduledPreview[]>>(new Map());
  let loaded = $state(false);
  // The calendar body stays invisible until its initial scroll-to-today is
  // applied, so it never flashes scrolled to the top before jumping.
  let scrollReady = $state(false);
  let calendarBodyEl = $state<HTMLDivElement | null>(null);
  let modalEl = $state<HTMLDivElement | null>(null);

  // detail view — the ride-detail model is built by core/history.buildRideDetail.
  type DetailState = RideDetail;
  let detail = $state<DetailState | null>(null);
  const detailMode = $derived(detail != null);

  // `?`-held hotkey overlay: while held, hide the footer aggregates and show the
  // hotkey list. questionHeld guards key-repeat.
  let showHotkeys = $state(false);
  let questionHeld = false;

  function todayMidnight(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function isPastDate(key: string): boolean {
    return keyToDate(key).getTime() < todayMidnight().getTime();
  }
  function isPastOrTodayDate(key: string): boolean {
    return keyToDate(key).getTime() <= todayMidnight().getTime();
  }

  // --------------------------- open: load + reset ---------------------------
  // Track ONLY `open` (the transition false->true). Loading reads reactive
  // state (currentFtp) which must not re-trigger this effect, so run onOpen via
  // an untracked microtask once per open.
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      wasOpen = true;
      queueMicrotask(() => void onOpen());
    } else if (!isOpen) {
      wasOpen = false;
    }
  });

  // When we hand off to the schedule-mode picker we save the selected day so the
  // re-opened planner restores it (instead of snapping back to today).
  let pendingScheduleReturnDate: Date | null = null;

  async function onOpen(): Promise<void> {
    detail = null;
    showHotkeys = false;
    questionHeld = false;
    today = new Date();
    today.setHours(0, 0, 0, 0);
    if (pendingScheduleReturnDate) {
      selectedDate = pendingScheduleReturnDate;
      pendingScheduleReturnDate = null;
    } else {
      selectedDate = new Date();
      selectedDate.setHours(0, 0, 0, 0);
    }
    anchorStart = startOfWeek(selectedDate);
    loaded = false;
    scrollReady = false;

    // The week grid renders WITHOUT the history/schedule data, so for a normal
    // open scroll to today + reveal IMMEDIATELY — don't make the user watch the
    // top of the window for the 1-2s the (cold-cache) history load can take.
    // Cards + a re-anchor follow once loaded; the post-ride flow goes to detail.
    const pending = ui.pendingHistoryFile;
    if (!pending) {
      await tick();
      scrollToToday();
      scrollReady = true;
    }

    await Promise.all([loadHistory(), loadSchedule()]);
    loaded = true;

    // Post-ride flow: if the shell opened the planner with a just-saved ride,
    // auto-open that ride's DETAIL view. Consume + clear the pending file so a
    // later manual open shows the calendar.
    if (pending) {
      ui.pendingHistoryFile = null;
      // Open the detail FIRST, while the calendar grid is still hidden
      // (scrollReady === false → visibility:hidden). detailMode then display:none's
      // the calendar, so it never flashes on screen during the async detail load.
      // Only after detail is up do we mark the calendar ready — invisible behind
      // the detail now, and correctly revealed when the rider presses Back.
      await openDetailByFile(pending.fileName, pending.date);
      scrollReady = true;
      return;
    }

    // Cards may have grown some rows — re-anchor today now they're laid out.
    await tick();
    scrollToToday();
  }

  // Open the ride detail for a specific history file (post-ride follow-up).
  // Selects the ride's day, finds its preview, and opens the detail.
  async function openDetailByFile(fileName: string, startedAt: Date | null): Promise<void> {
    if (!fileName) return;
    const dateKey = startedAt ? formatKey(startedAt) : dateKeyFromHandleName(fileName);
    if (!dateKey) return;
    selectedDate = keyToDate(dateKey);
    const previews = historyMap.get(dateKey) || [];
    const match = previews.find((p) => p.fileName === fileName) || previews[0];
    if (!match) return;
    await openDetail(match);
  }

  function scrollToToday(): void {
    if (!calendarBodyEl) return;
    const rowEls = calendarBodyEl.querySelectorAll<HTMLElement>('.planner-week-row');
    const rowsBefore = Math.floor(VISIBLE_WEEKS / 2); // 8 → today's week is row index 8
    const targetRow = Math.max(0, rowsBefore - 1);
    // Align the target row's top with the body's top so today's week sits one
    // row below. Measure the row's actual position (rows grow with cards, so a
    // uniform rowHeight × index estimate drifts) — mirrors scrollSelectedIntoView.
    const targetEl = rowEls[targetRow];
    if (!targetEl) return;
    const bodyRect = calendarBodyEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    calendarBodyEl.scrollTop += targetRect.top - bodyRect.top;
  }

  async function loadHistory(): Promise<void> {
    // WebFileStore computes + caches previews by file name (stats cache), so a
    // repeat open of an unchanged history re-parses nothing.
    const previews = await fileStore.listHistoryPreviews();
    const map = new Map<string, HistoryPreview[]>();
    for (const preview of previews) {
      const dateKey = dateKeyFromHandleName(preview.fileName);
      if (!dateKey) continue;
      // Fall back to the file's day key when the FIT carried no startedAt.
      const withStart: HistoryPreview =
        preview.startedAt != null
          ? preview
          : { ...preview, startedAt: utcDateKeyToLocalDate(dateKey) };
      const arr = map.get(dateKey) || [];
      arr.push(withStart);
      map.set(dateKey, arr);
    }
    // newest-first within a day (filenames are ISO timestamps)
    map.forEach((arr) => arr.sort((a, b) => (a.fileName < b.fileName ? 1 : -1)));
    historyMap = map;
  }

  async function loadSchedule(): Promise<void> {
    const [entries, workouts] = await Promise.all([
      fileStore.loadSchedule(),
      fileStore.getWorkouts(),
    ]);
    const byTitle = new Map<string, CanonicalWorkout>();
    for (const w of workouts) byTitle.set(w.workoutTitle || '', w);
    const ftp = currentFtp;
    const map = new Map<string, ScheduledPreview[]>();
    for (const e of entries) {
      if (!e || !e.date || !e.workoutTitle) continue;
      const cw = byTitle.get(e.workoutTitle);
      const rawSegments = cw?.rawSegments || [];
      const metrics = computeScheduledMetrics({ rawSegments }, ftp);
      const preview: ScheduledPreview = {
        date: e.date,
        workoutTitle: e.workoutTitle,
        canonical: cw || null,
        rawSegments,
        durationSec: metrics?.durationSec || 0,
        kj: metrics?.kj ?? null,
        ifValue: metrics?.ifValue ?? null,
        tss: metrics?.tss ?? null,
        zone: metrics?.zone || '',
        missing: !cw,
      };
      const arr = map.get(e.date) || [];
      arr.push(preview);
      map.set(e.date, arr);
    }
    scheduledMap = map;
  }

  // --------------------------- weeks model ---------------------------
  // The calendar grid (geometry + month-boundary classes) is built by the pure
  // core/calendar.buildCalendarWeeks; this derivation just wires the reactive
  // anchor/today/selection in.
  const weeks = $derived.by<DayCell[][]>(() =>
    buildCalendarWeeks(anchorStart, today, selectedDate, VISIBLE_WEEKS),
  );

  // --------------------------- aggregates ---------------------------
  const agg = $derived.by(() => {
    void historyMap;
    void scheduledMap;
    void selectedDate;
    const totals = {
      3: { sec: 0, kj: 0, tss: 0 },
      7: { sec: 0, kj: 0, tss: 0 },
      30: { sec: 0, kj: 0, tss: 0 },
    };
    const base = selectedDate ? new Date(selectedDate) : new Date();
    base.setHours(0, 0, 0, 0);
    const baseEndMs = base.getTime() + DAY_MS;
    const cutoff = { 3: baseEndMs - 3 * DAY_MS, 7: baseEndMs - 7 * DAY_MS, 30: baseEndMs - 30 * DAY_MS };
    historyMap.forEach((items) => {
      items.forEach((item) => {
        const start = item.startedAt ? item.startedAt.getTime() : null;
        if (start == null) return;
        ([3, 7, 30] as const).forEach((win) => {
          if (start < baseEndMs && start >= cutoff[win]) {
            totals[win].sec += item.durationSec || 0;
            totals[win].kj += item.kj || 0;
            totals[win].tss += item.tss || 0;
          }
        });
      });
    });
    const todayMs = todayMidnight().getTime();
    scheduledMap.forEach((items, key) => {
      const d = keyToDate(key);
      d.setHours(0, 0, 0, 0);
      const start = d.getTime();
      if (start < todayMs) return;
      items.forEach((entry) => {
        ([3, 7, 30] as const).forEach((win) => {
          if (start < baseEndMs && start >= cutoff[win]) {
            totals[win].sec += entry.durationSec || 0;
            totals[win].kj += entry.kj || 0;
            totals[win].tss += entry.tss || 0;
          }
        });
      });
    });
    const fmt = (t: { sec: number; kj: number; tss: number }) =>
      `${Math.round(t.sec / 60)} min, ${Math.round(t.kj)} kJ, TSS ${Math.round(t.tss)}`;
    return {
      d3: fmt(totals[3]),
      d7: fmt(totals[7]),
      d30: fmt(totals[30]),
    };
  });

  // --------------------------- card stat parts ---------------------------
  function cardStatParts(p: { durationSec: number; zone: string; kj: number | null; tss: number | null; ifValue: number | null; missing?: boolean }): string[] {
    const parts: string[] = [];
    if (p.durationSec) parts.push(formatDurationMinSec(p.durationSec));
    if (p.zone) parts.push(p.zone);
    if (Number.isFinite(p.kj as number)) parts.push(`${Math.round(p.kj as number)} kJ`);
    if (Number.isFinite(p.tss as number)) parts.push(`TSS ${Math.round(p.tss as number)}`);
    if (Number.isFinite(p.ifValue as number)) parts.push(`IF ${(p.ifValue as number).toFixed(2)}`);
    if (p.missing) parts.push('File missing');
    return parts;
  }

  // --------------------------- charts (imperative use: actions) ---------------------------
  //
  // Each chart action registers its render closure so it can be re-run on a
  // theme change (charts read CSS-var colors at draw time).
  const chartRenderers = new Set<() => void>();
  function registerChart(node: SVGSVGElement, render: () => void) {
    chartRenderers.add(render);
    requestAnimationFrame(render);
    return {
      destroy() {
        chartRenderers.delete(render);
      },
    };
  }

  function historyChart(node: SVGSVGElement, p: HistoryPreview) {
    return registerChart(node, () => {
      const rect = node.parentElement?.getBoundingClientRect();
      drawMiniHistoryChart({
        svg: node,
        width: rect?.width || 240,
        height: rect?.height || 36,
        ftp: currentFtp,
        rawSegments: p.rawSegments,
        actualLineSegments: p.powerSegments,
        actualPowerMax: p.powerMax,
        durationSec: p.durationSec,
      });
    });
  }
  function scheduledChart(node: SVGSVGElement, p: ScheduledPreview) {
    return registerChart(node, () => {
      const rect = node.parentElement?.getBoundingClientRect();
      drawMiniHistoryChart({
        svg: node,
        width: rect?.width || 240,
        height: rect?.height || 36,
        ftp: currentFtp,
        rawSegments: p.rawSegments,
        durationSec: p.durationSec,
      });
    });
  }
  function powerCurveChart(node: SVGSVGElement, d: DetailState) {
    return registerChart(node, () => {
      const rect = node.getBoundingClientRect();
      const panel = node.parentElement as HTMLElement | null;
      const tooltipEl = panel?.querySelector<HTMLElement>('#plannerPowerCurveTooltip') || null;
      drawPowerCurveChart({
        svg: node,
        width: rect.width || 600,
        height: rect.height || 300,
        ftp: d.ftp || 0,
        points: d.powerCurve || [],
        maxDurationSec: d.durationSec || 0,
        panel,
        tooltipEl,
      });
    });
  }
  function detailChart(node: SVGSVGElement, d: DetailState) {
    return registerChart(node, () => {
      const panel = node.parentElement as HTMLElement | null;
      const rect = panel?.getBoundingClientRect();
      const tooltipEl = panel?.querySelector<HTMLElement>('#plannerDetailChartTooltip') || null;
      drawWorkoutChart({
        svg: node,
        width: rect?.width || 1000,
        height: rect?.height || 320,
        ftp: d.ftp || 0,
        rawSegments: d.rawSegments || [],
        elapsedSec: d.activeDurationSec || d.durationSec || 0,
        liveSamples: d.samples || [],
        showProgress: false,
        panel,
        tooltipEl,
      });
    });
  }

  // Re-run every mounted planner chart on a theme change (stale-color fix).
  $effect(() => {
    void themeVersion();
    for (const render of chartRenderers) render();
  });

  // --------------------------- interactions ---------------------------
  function selectDay(key: string): void {
    selectedDate = keyToDate(key);
  }

  async function openDetail(p: HistoryPreview): Promise<void> {
    // Re-read the FIT for full samples/meta, then delegate the VI/EF/paused/
    // HR-cad ride-detail math to core/history.
    const entries = await fileStore.listHistory();
    const match = entries.find((e) => e.fileName === p.fileName) || null;
    if (!match) return;
    detail = buildRideDetail(p.fileName, match.parsed, {
      workoutTitle: p.workoutTitle,
      startedAt: p.startedAt,
      startedAtFallback: utcDateKeyToLocalDate(formatKey(today)),
      zone: p.zone,
    });
  }

  function exitDetail(): void {
    detail = null;
  }

  // Detail stat chips (label/value/tooltip).
  const STAT_TOOLTIPS: Record<string, string> = {
    Duration: 'Moving time — Time the timer was running; paused time is excluded (elapsed minus pauses).',
    Paused: 'Paused time — Total time the ride timer was stopped; not counted in duration or averages.',
    Work: 'Work (kJ) — Total energy recorded by the power meter in kilojoules; roughly equals Calories burned if the meter is accurate.',
    NP: 'Normalized Power — Turns your up-and-down pacing into an equivalent steady wattage so you can compare spiky and steady rides on the same scale.',
    IF: 'Intensity Factor — Normalized power divided by FTP; 1.0 means riding steadily at FTP.',
    TSS: 'Training Stress Score — 100 equals 1 hour at FTP; typical weekly totals: ~300–500 for maintenance, 500–700 for building, 700+ for heavy training.',
    VI: 'Variability Index — Normalized power divided by average power; higher values mean more surges and less steady pacing.',
    EF: 'Efficiency Factor — Normalized power divided by average HR to track aerobic efficiency over time.',
  };
  const detailStats = $derived.by<{ label: string; value: string; title?: string }[]>(() => {
    if (!detail) return [];
    const out: { label: string; value: string; title?: string }[] = [];
    const push = (label: string, value: string | null) => {
      if (value == null || value === '') return;
      out.push({ label, value, title: STAT_TOOLTIPS[label] });
    };
    const d = detail;
    push('Duration', formatDurationMinSec(d.activeDurationSec || d.durationSec));
    if (Number.isFinite(d.pausedSec) && d.pausedSec > 0) push('Paused', formatDurationMinSec(d.pausedSec));
    if (d.zone) push('Zone', d.zone);
    if (Number.isFinite(d.avgPower as number)) push('Avg Power', `${Math.round(d.avgPower as number)} W`);
    if (Number.isFinite(d.normalizedPower as number)) push('NP', `${Math.round(d.normalizedPower as number)} W`);
    if (Number.isFinite(d.kj as number)) push('Work', `${Math.round(d.kj as number)} kJ`);
    if (Number.isFinite(d.ifValue as number)) push('IF', (d.ifValue as number).toFixed(2));
    if (Number.isFinite(d.tss as number)) push('TSS', String(Math.round(d.tss as number)));
    if (Number.isFinite(d.vi as number)) push('VI', (d.vi as number).toFixed(2));
    if (Number.isFinite(d.ef as number)) push('EF', (d.ef as number).toFixed(2));
    if (Number.isFinite(d.avgHr as number)) push('Avg HR', `${Math.round(d.avgHr as number)} bpm`);
    if (Number.isFinite(d.maxHr as number)) push('Max HR', `${Math.round(d.maxHr as number)} bpm`);
    if (Number.isFinite(d.avgCadence as number)) push('Avg Cadence', `${Math.round(d.avgCadence as number)} rpm`);
    if (Number.isFinite(d.maxCadence as number)) push('Max Cadence', `${Math.round(d.maxCadence as number)} rpm`);
    return out;
  });
  const detailDateLine = $derived.by(() => {
    if (!detail?.startedAt) return '';
    try {
      const datePart = formatSelectedLabel(detail.startedAt);
      const timePart = detail.startedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `${datePart} • ${timePart}`;
    } catch {
      return detail.startedAt.toString();
    }
  });

  const selectedLabelText = $derived(
    detail ? detail.workoutTitle || '' : formatSelectedLabel(selectedDate),
  );
  const showScheduleBtn = $derived(!detailMode && selectedDate != null && !isPastDate(formatKey(selectedDate)));

  // --------------------------- schedule / delete ---------------------------
  // Open the workout LIBRARY in schedule mode so the user browses + picks ANY
  // workout for the day. The picker writes schedule.json + returns to the planner
  // overlay (which reloads the schedule on re-open).
  function onScheduleDay(): void {
    if (!selectedDate) return;
    const dateKey = formatKey(selectedDate);
    if (isPastDate(dateKey)) return; // past-date scheduling rejected
    pendingScheduleReturnDate = selectedDate;
    ui.openPickerForSchedule(dateKey, null, false);
  }

  async function onDeleteScheduled(entry: ScheduledPreview): Promise<void> {
    const ok = await dialogs.confirm(
      `Remove the scheduled workout "${entry.workoutTitle}"?`,
      { title: 'Remove scheduled workout', okLabel: 'Remove' },
    );
    if (!ok) return;
    const entries = await fileStore.loadSchedule();
    const next = entries.filter((e) => !(e.date === entry.date && e.workoutTitle === entry.workoutTitle));
    await fileStore.saveSchedule(next);
    await loadSchedule();
  }

  async function onDeleteDetail(): Promise<void> {
    if (!detail) return;
    const ok = await dialogs.confirm(`Move this ride file to the trash folder?`, {
      title: 'Delete workout',
      okLabel: 'Delete',
    });
    if (!ok) return;
    const fileName = detail.fileName;
    const moved = await fileStore.deleteHistoryToTrash(fileName);
    if (!moved) return;
    await fileStore.invalidateHistoryStats(fileName);
    detail = null;
    await loadHistory();
  }

  function onClose(): void {
    if (detail) {
      detail = null;
      return;
    }
    ui.close();
  }

  // Load a scheduled workout into the engine + close the planner. The full
  // CanonicalWorkout was joined in loadSchedule.
  async function onLoadScheduled(entry: ScheduledPreview): Promise<void> {
    const canonical: CanonicalWorkout = entry.canonical || {
      source: 'scheduled',
      sourceURL: '',
      workoutTitle: entry.workoutTitle || 'Workout',
      rawSegments: entry.rawSegments || [],
      description: '',
    };
    await fileStore.putSetting('selectedWorkout', canonical);
    engine.setWorkoutFromPicker(canonical);
    ui.close();
  }

  // Edit a scheduled entry: re-open the workout LIBRARY in "Edit Schedule" mode
  // (the entry is pre-targeted; selecting a different workout REPLACES it, the
  // Unschedule button REMOVES it).
  function onEditScheduled(entry: ScheduledPreview): void {
    pendingScheduleReturnDate = keyToDate(entry.date);
    ui.openPickerForSchedule(entry.date, { date: entry.date, workoutTitle: entry.workoutTitle }, true);
  }

  // --------------------------- keyboard ---------------------------
  function handlePlannerKey(e: KeyboardEvent): boolean {
    const key = (e.key || '').toLowerCase();
    // Detail mode: d/Delete delete the shown ride; Backspace/Escape exit detail.
    if (detailMode) {
      if (isEditableTarget(e.target)) return false;
      if (key === 'delete' || key === 'd') {
        void onDeleteDetail();
        return true;
      }
      if (key === 'backspace' || key === 'escape') {
        exitDetail();
        return true;
      }
      return false;
    }
    // Escape on the calendar is handled by ui.handleEscape (closes planner); not
    // here.
    if (key === 'escape') return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (isEditableTarget(e.target)) return false;

    const dateKey = selectedDate ? formatKey(selectedDate) : null;

    if (key === 'enter') {
      if (!dateKey) return true;
      // Open the selected day's history detail if any…
      const hist = historyMap.get(dateKey);
      if (hist && hist.length) {
        void openDetail(hist[0]!);
        return true;
      }
      // …else load the day's scheduled workout…
      const sched = scheduledMap.get(dateKey);
      if (sched && sched.length) {
        void onLoadScheduled(sched[0]!);
        return true;
      }
      // …else (empty future day) request scheduling.
      if (!isPastDate(dateKey)) void onScheduleDay();
      return true;
    }

    if (key === 'e') {
      if (!dateKey) return true;
      const sched = scheduledMap.get(dateKey);
      if (sched && sched.length) {
        void onEditScheduled(sched[0]!);
        return true;
      }
      if (!isPastDate(dateKey)) void onScheduleDay();
      return true;
    }

    if (key === 'd' || key === 'delete') {
      if (!dateKey) return true;
      const sched = scheduledMap.get(dateKey);
      if (sched && sched.length) {
        void onDeleteScheduled(sched[0]!);
        return true;
      }
      const hist = historyMap.get(dateKey);
      if (hist && hist.length) {
        void onDeleteFirstHistory(hist[0]!);
        return true;
      }
      return true;
    }

    if (key === 'arrowdown' || key === 'j') {
      moveSelection(7);
      return true;
    }
    if (key === 'arrowup' || key === 'k') {
      moveSelection(-7);
      return true;
    }
    if (key === 'arrowleft' || key === 'h') {
      moveSelection(-1);
      return true;
    }
    if (key === 'arrowright' || key === 'l') {
      moveSelection(1);
      return true;
    }
    return false;
  }

  function moveSelection(daysDelta: number): void {
    const base = selectedDate ? new Date(selectedDate) : new Date();
    selectedDate = addDays(base, daysDelta);
    // Scroll the newly-selected day cell into view if it's outside the visible
    // calendar window (8px pad). The fixed 16-week window doesn't recycle, so we
    // only scroll; the cell is always rendered within the window.
    queueMicrotask(() => scrollSelectedIntoView());
  }

  // Scroll the selected day's cell into view inside the calendar body. 8px
  // padding top/bottom.
  function scrollSelectedIntoView(): void {
    if (!calendarBodyEl || !selectedDate) return;
    const key = formatKey(selectedDate);
    const cell = calendarBodyEl.querySelector<HTMLElement>(`.planner-day[data-date="${key}"]`);
    if (!cell) return;
    const containerRect = calendarBodyEl.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const padding = 8;
    if (cellRect.top < containerRect.top + padding) {
      calendarBodyEl.scrollTop -= containerRect.top - cellRect.top + padding;
    } else if (cellRect.bottom > containerRect.bottom - padding) {
      calendarBodyEl.scrollTop += cellRect.bottom - containerRect.bottom + padding;
    }
  }

  // --------------------------- `?`-held hotkey overlay ---------------------------
  // Hold `?` (Shift+/) or `/` to hide the footer aggregates and reveal the
  // hotkey list; release restores the footer. Only while the planner overlay is
  // active and not in detail mode (the footer is calendar-only).
  function isQuestionShowHotkey(e: KeyboardEvent): boolean {
    const key = e.key || '';
    return key === '?' || (key === '/' && e.shiftKey) || (e.code === 'Slash' && e.shiftKey);
  }
  function isQuestionReleaseKey(e: KeyboardEvent): boolean {
    const key = e.key || '';
    return key === '?' || key === '/' || e.code === 'Slash';
  }
  function onWindowKeyDown(e: KeyboardEvent): void {
    if (!open || detailMode) return;
    if (isEditableTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!isQuestionShowHotkey(e)) return;
    e.preventDefault();
    if (questionHeld) return;
    questionHeld = true;
    showHotkeys = true;
  }
  function onWindowKeyUp(e: KeyboardEvent): void {
    if (!isQuestionReleaseKey(e)) return;
    if (!questionHeld) return;
    questionHeld = false;
    showHotkeys = false;
  }

  // --------------------------- drag-and-drop reschedule ---------------------------
  // Drag a scheduled card onto a future-or-today day to move it. PAST days
  // reject; SAME-day is a no-op; live planner-drop-hover (hovered day) +
  // planner-dragging (dragged card) styling.
  function onCardDragStart(e: DragEvent, fromDate: string, workoutTitle: string): void {
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = 'move';
    dt.setData(
      'application/json',
      JSON.stringify({ kind: 'scheduled', date: fromDate, workoutTitle }),
    );
    (e.currentTarget as HTMLElement | null)?.classList.add('planner-dragging');
    document.body.classList.add('planner-dragging');
  }
  function onCardDragEnd(e: DragEvent): void {
    (e.currentTarget as HTMLElement | null)?.classList.remove('planner-dragging');
    document.body.classList.remove('planner-dragging');
  }
  function onDayDragOver(e: DragEvent, dateKey: string): void {
    if (!dateKey || isPastDate(dateKey)) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    if (!dt.types || !Array.from(dt.types).includes('application/json')) return;
    e.preventDefault();
    dt.dropEffect = 'move';
    (e.currentTarget as HTMLElement | null)?.classList.add('planner-drop-hover');
  }
  function onDayDragLeave(e: DragEvent): void {
    (e.currentTarget as HTMLElement | null)?.classList.remove('planner-drop-hover');
  }
  async function onDayDrop(e: DragEvent, dateKey: string): Promise<void> {
    (e.currentTarget as HTMLElement | null)?.classList.remove('planner-drop-hover');
    const dt = e.dataTransfer;
    if (!dt || !dateKey || isPastDate(dateKey)) return;
    e.preventDefault();
    let payload: { kind?: string; date?: string; workoutTitle?: string } | null = null;
    try {
      const raw = dt.getData('application/json');
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!payload || payload.kind !== 'scheduled') return;
    if (!payload.workoutTitle || !payload.date) return;
    const moved = await fileStore.moveScheduledEntry(payload.date, payload.workoutTitle, dateKey);
    if (moved) await loadSchedule();
  }

  async function onDeleteFirstHistory(p: HistoryPreview): Promise<void> {
    const ok = await dialogs.confirm(
      `Move workout "${p.workoutTitle || p.fileName}" to the trash folder?`,
      { title: 'Delete workout', okLabel: 'Delete' },
    );
    if (!ok) return;
    const moved = await fileStore.deleteHistoryToTrash(p.fileName);
    if (!moved) return;
    await fileStore.invalidateHistoryStats(p.fileName);
    await loadHistory();
  }

  // Register the planner keymap with the App overlay-key router while the planner
  // overlay is active (App suppresses global hotkeys + routes keys here). Mirrors
  // the PickerView registration convention.
  $effect(() => {
    if (open) {
      ui.registerOverlayKeyHandler('planner', handlePlannerKey);
      return () => ui.registerOverlayKeyHandler('planner', null);
    }
    return undefined;
  });

  // Tell the ui store whether the detail sub-view is open so Escape/Backspace
  // pop the detail back to the calendar (instead of closing the whole planner).
  // Cleared on close.
  $effect(() => {
    ui.plannerDetailOpen = open && detailMode;
  });
</script>

<svelte:window onkeydown={onWindowKeyDown} onkeyup={onWindowKeyUp} />

<OverlayModal
  {open}
  overlayId="workoutPickerOverlay"
  overlayClass="workout-picker-overlay planner-mode workout-planner-overlay"
  ariaLabel="Workout calendar"
  {onClose}
>
  <div
    bind:this={modalEl}
    id="workoutPickerModal"
    class="workout-picker-modal workout-planner-modal"
    class:planner-detail-mode={detailMode}
    data-testid="planner-modal"
    role="document"
  >
    <header class="workout-planner-header planner-only">
      <div class="workout-planner-left">
        <button
          id="plannerBackBtn"
          class="wb-code-insert-btn picker-back-btn planner-back-btn"
          type="button"
          data-testid="planner-back"
          style="display: {detailMode ? 'inline-flex' : 'none'}"
          onclick={exitDetail}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Back to calendar</span>
        </button>
        <div class="workout-planner-title">{detailMode ? '' : 'Calendar'}</div>
      </div>
      <div id="plannerSelectedDateLabel" class="workout-planner-selected" aria-live="polite" data-testid="planner-selected-label">
        {selectedLabelText}
      </div>
      <div class="workout-planner-actions workout-picker-controls">
        <button
          id="plannerDeleteBtn"
          class="wb-code-insert-btn delete-workout-btn"
          type="button"
          data-testid="planner-delete"
          style="display: {detailMode ? 'inline-flex' : 'none'}"
          title="Delete workout"
          onclick={() => void onDeleteDetail()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
            <path d="M21 6H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>Delete</span>
        </button>
        {#if showScheduleBtn}
          <button
            id="plannerScheduleBtn"
            class="picker-add-btn planner-schedule-btn"
            type="button"
            data-testid="planner-schedule"
            onclick={() => void onScheduleDay()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>Schedule workout</span>
          </button>
        {/if}
        <button
          id="workoutPlannerCloseBtn"
          class="picker-close-btn"
          title="Close calendar"
          data-testid="planner-close"
          onclick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>

    <div class="workout-planner-body planner-only">
      <div class="planner-calendar">
        <div class="planner-calendar-header" id="plannerCalendarHeader">
          <div class="planner-day-head">Sun</div>
          <div class="planner-day-head">Mon</div>
          <div class="planner-day-head">Tue</div>
          <div class="planner-day-head">Wed</div>
          <div class="planner-day-head">Thu</div>
          <div class="planner-day-head">Fri</div>
          <div class="planner-day-head">Sat</div>
        </div>
        <div class="planner-calendar-body" id="plannerCalendarBody" bind:this={calendarBodyEl} data-testid="planner-calendar-body" style:visibility={scrollReady ? 'visible' : 'hidden'}>
          {#each weeks as week, wi (wi)}
            <div class="planner-week-row" data-week-offset={wi}>
              {#each week as cell (cell.key)}
                {@const history = historyMap.get(cell.key) || []}
                {@const scheduled = scheduledMap.get(cell.key) || []}
                <div
                  class={cell.classes}
                  data-date={cell.key}
                  role="button"
                  tabindex="-1"
                  onclick={() => selectDay(cell.key)}
                  onkeydown={() => {}}
                  ondragover={(e) => onDayDragOver(e, cell.key)}
                  ondragleave={onDayDragLeave}
                  ondrop={(e) => void onDayDrop(e, cell.key)}
                >
                  <div class="planner-day-content" class:has-history={history.length || scheduled.length}>
                    {#if cell.monthLabel != null}
                      <div class="planner-month-label">{cell.monthLabel}</div>
                    {/if}
                    <div class="planner-day-number">{cell.dayNum}</div>

                    {#each history as p (p.fileName)}
                      <div
                        class="planner-workout-card"
                        title="View workout analysis"
                        data-file-name={p.fileName}
                        data-testid="planner-history-card"
                        role="button"
                        tabindex="-1"
                        onclick={(e) => { e.stopPropagation(); void openDetail(p); }}
                        onkeydown={() => {}}
                      >
                        <div class="planner-workout-header">
                          <div class="planner-workout-name">{p.workoutTitle || 'Workout'}</div>
                          <div class="planner-workout-stats">
                            {#each cardStatParts(p) as part, idx}
                              <span class="planner-workout-stat-chip">{part}</span>
                              {#if idx !== cardStatParts(p).length - 1}
                                <span class="planner-workout-stat-chip planner-workout-stat-sep">·</span>
                              {/if}
                            {/each}
                          </div>
                        </div>
                        <div class="planner-workout-chart">
                          <svg use:historyChart={p}></svg>
                        </div>
                      </div>
                    {/each}

                    {#each scheduled as p (p.workoutTitle)}
                      {@const past = isPastDate(cell.key)}
                      <div
                        class="planner-workout-card planner-scheduled-card"
                        class:planner-scheduled-missing={p.missing}
                        title={p.missing ? 'Workout file not found' : 'Start scheduled workout'}
                        data-testid="planner-scheduled-card"
                        role="button"
                        tabindex="-1"
                        draggable="true"
                        onclick={(e) => { e.stopPropagation(); if (!p.missing) void onLoadScheduled(p); }}
                        onkeydown={() => {}}
                        ondragstart={(e) => onCardDragStart(e, cell.key, p.workoutTitle)}
                        ondragend={onCardDragEnd}
                      >
                        <div class="planner-scheduled-top">
                          <div class="planner-scheduled-tag" class:planner-scheduled-tag-past={past}>Scheduled</div>
                          <button
                            type="button"
                            class="nav-icon-button planner-scheduled-edit-btn"
                            data-testid="planner-scheduled-edit"
                            title={past ? 'Delete scheduled workout' : 'Edit scheduled workout'}
                            onclick={(e) => { e.stopPropagation(); if (past) void onDeleteScheduled(p); else void onEditScheduled(p); }}
                          >
                            {#if past}
                              <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
                                <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                                <path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2" />
                                <path d="M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2" />
                              </svg>
                            {:else}
                              <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
                                <path d="M4 20h4l10-10-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                                <path d="M14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                                <path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                              </svg>
                            {/if}
                          </button>
                        </div>
                        <div class="planner-workout-header">
                          <div class="planner-workout-name">{p.workoutTitle || 'Workout'}</div>
                          <div class="planner-workout-stats">
                            {#each cardStatParts(p) as part, idx}
                              <span class="planner-workout-stat-chip">{part}</span>
                              {#if idx !== cardStatParts(p).length - 1}
                                <span class="planner-workout-stat-chip planner-workout-stat-sep">·</span>
                              {/if}
                            {/each}
                          </div>
                        </div>
                        <div class="planner-workout-chart">
                          <svg use:scheduledChart={p}></svg>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>

      {#if detail}
        <div class="planner-detail-view" id="plannerDetailView" style="display: flex" data-testid="planner-detail">
          <div class="planner-detail-top">
            <div class="planner-detail-stats" id="plannerDetailStats">
              {#if detailDateLine}
                <div class="planner-detail-date">{detailDateLine}</div>
              {/if}
              <div class="wb-stats-row">
                {#each detailStats as s (s.label)}
                  <div class="wb-stat-chip" title={s.title}>
                    <div class="wb-stat-label">{s.label}</div>
                    <div class="wb-stat-value">{s.value}</div>
                  </div>
                {/each}
              </div>
            </div>
            <div class="planner-detail-curve">
              <div class="planner-curve-title-row">
                <div class="planner-curve-title">Power curve</div>
                <div class="planner-curve-help" role="img" aria-label="What the power curve means"
                  title="Shows the strongest average power you held for every duration in this ride.">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"></circle>
                    <path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.9.3-1.2.8-1.2 1.6V14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
                    <circle cx="12" cy="17" r="1.2" fill="currentColor"></circle>
                  </svg>
                </div>
              </div>
              <svg id="plannerPowerCurveSvg" class="planner-power-curve" viewBox="0 0 600 300" data-testid="planner-power-curve" use:powerCurveChart={detail}></svg>
              <div id="plannerPowerCurveTooltip" class="chart-tooltip" data-testid="planner-power-curve-tooltip"></div>
            </div>
          </div>
          <div class="planner-detail-chart-panel" id="plannerDetailChartPanel">
            <svg id="plannerDetailChartSvg" class="planner-detail-chart" viewBox="0 0 1000 320" preserveAspectRatio="none" data-testid="planner-detail-chart" use:detailChart={detail}></svg>
            <div id="plannerDetailChartTooltip" class="chart-tooltip"></div>
          </div>
        </div>
      {/if}

      <div class="planner-footer" id="plannerFooter">
        <div class="planner-footer-left">
          <span id="plannerHotkeyPrompt" style="display: {showHotkeys ? 'none' : ''}">Press <strong>?</strong> for shortcuts</span>
          <span id="plannerHotkeyList" data-testid="planner-hotkey-list" style="display: {showHotkeys ? '' : 'none'}">
            <strong>↑↓←→</strong> or <strong>hjkl</strong> to move •
            <strong>Enter</strong> to open • <strong>e</strong> to edit •
            <strong>d</strong> or <strong>Delete</strong> to delete • drag
            and drop to reschedule
          </span>
        </div>
        <div class="planner-footer-right" style="display: {showHotkeys ? 'none' : ''}">
          <span id="plannerAgg3" data-testid="planner-agg-3"><strong>3 day sum:</strong> {agg.d3}</span>
          <span class="planner-footer-sep">·</span>
          <span id="plannerAgg7" data-testid="planner-agg-7"><strong>7 day sum:</strong> {agg.d7}</span>
          <span class="planner-footer-sep">·</span>
          <span id="plannerAgg30" data-testid="planner-agg-30"><strong>30 day sum:</strong> {agg.d30}</span>
        </div>
      </div>
    </div>
  </div>
</OverlayModal>
