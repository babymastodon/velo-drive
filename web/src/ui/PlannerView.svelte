<script lang="ts">
  // PlannerView — faithful re-host of the legacy workout planner (the
  // `.planner-only` half of #workoutPickerOverlay/#workoutPickerModal in
  // docs/index.html ~703-890 + docs/workout-planner.js). Reproduces the same
  // class names / IDs / data-attributes so the re-hosted workout-planner.css +
  // workout-picker.css apply unchanged. Implements: the infinite-ish week
  // calendar (the legacy initial 16-week window, offsets -8..+7 around today,
  // scrolled so today's week sits one row down), history cards on past days,
  // scheduled cards on future days, the ride detail view (stat chips + power
  // curve + planned-vs-actual chart), the 3/7/30-day totals footer, scheduling a
  // workout on a day, and deleting a ride to trash.
  //
  // SIMPLIFICATIONS vs legacy (documented):
  //  * Scrolling renders the fixed legacy initial 16-week window rather than
  //    recycling rows on scroll — the initial render + scroll position is
  //    pixel-identical to legacy; deep scroll just stops instead of paging.
  //  * The picker<->planner schedule handoff is a self-contained "schedule this
  //    day" prompt (a Dialog that picks the engine's current workout) which
  //    writes schedule.json directly, instead of re-opening the picker in a
  //    schedule mode.
  //  * Drag-and-drop reschedule + the `?`-held hotkey overlay are dropped.
  import OverlayModal from './OverlayModal.svelte';
  import type { WebFileStore, ScheduleEntry, HistoryPreview } from '../ports/web/WebFileStore.js';
  import type { UiStore } from '../state/ui.svelte.js';
  import type { EngineStore } from '../state/engine.svelte.js';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { DialogStore } from '../state/dialog.svelte.js';
  import type { CanonicalWorkout, RawSegment } from '../core/model.js';
  import {
    DEFAULT_FTP,
    computeMetricsFromSamples,
    computeScheduledMetrics,
    inferZoneFromSegments,
    formatDurationMinSec,
  } from '../core/metrics.js';
  import {
    buildPowerCurve,
    computeHrCadStats,
    POWER_CURVE_DURS,
    type PowerCurvePoint,
  } from '../core/planner-analysis.js';
  import { drawMiniHistoryChart, drawPowerCurveChart, drawWorkoutChart } from '../core/chart.js';

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
    fileStore: WebFileStore;
    ui: UiStore;
    dialogs: DialogStore;
    open?: boolean;
  } = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const VISIBLE_WEEKS = 16;

  const currentFtp = $derived(store.vm?.currentFtp || DEFAULT_FTP);

  // --------------------------- date helpers (verbatim from legacy) ---------------------------
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
  function formatKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
  function isSameDay(a: Date | null, b: Date | null): boolean {
    if (!a || !b) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
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
  let calendarBodyEl = $state<HTMLDivElement | null>(null);
  let modalEl = $state<HTMLDivElement | null>(null);

  // detail view
  interface DetailState {
    fileName: string;
    workoutTitle: string;
    durationSec: number;
    activeDurationSec: number;
    kj: number | null;
    ifValue: number | null;
    tss: number | null;
    avgPower?: number;
    normalizedPower?: number | null;
    vi: number | null;
    ef: number | null;
    ftp: number;
    rawSegments: RawSegment[];
    samples: { t?: number; power?: number | null; hr?: number | null; cadence?: number | null }[];
    powerCurve: PowerCurvePoint[];
    startedAt: Date | null;
    pausedSec: number;
    avgHr?: number | null;
    maxHr?: number | null;
    avgCadence?: number | null;
    maxCadence?: number | null;
    zone: string;
  }
  let detail = $state<DetailState | null>(null);
  const detailMode = $derived(detail != null);

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

  async function onOpen(): Promise<void> {
    detail = null;
    today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0);
    anchorStart = startOfWeek(selectedDate);
    loaded = false;
    await Promise.all([loadHistory(), loadSchedule()]);
    loaded = true;
    // Scroll so today's week sits one row below the top (legacy centerOnDate).
    requestAnimationFrame(() => scrollToToday());
  }

  function scrollToToday(): void {
    if (!calendarBodyEl) return;
    const rowEls = calendarBodyEl.querySelectorAll('.planner-week-row');
    const rowsBefore = Math.floor(VISIBLE_WEEKS / 2); // 8 → today's week is row index 8
    const targetRow = Math.max(0, rowsBefore - 1);
    // Match legacy centerOnDate exactly: scrollTop = targetRow * measuredRowHeight
    // (the first row's rendered height), NOT offsetTop (which accumulates the
    // inter-row borders and drifts a few px per row).
    const firstRow = rowEls[0] as HTMLElement | undefined;
    const rowHeight = firstRow ? firstRow.getBoundingClientRect().height : 0;
    calendarBodyEl.scrollTop = Math.max(0, targetRow * rowHeight);
  }

  async function loadHistory(): Promise<void> {
    // WebFileStore computes + caches previews by file name (stats cache), so a
    // repeat open of an unchanged history re-parses nothing.
    const previews = await fileStore.listHistoryPreviews();
    const map = new Map<string, HistoryPreview[]>();
    for (const preview of previews) {
      const dateKey = dateKeyFromHandleName(preview.fileName);
      if (!dateKey) continue;
      // Fall back to the file's day key when the FIT carried no startedAt
      // (mirrors legacy loadHistoryPreview's utcDateKeyToLocalDate fallback).
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
      fileStore.listWorkouts(),
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
  interface DayCell {
    date: Date;
    key: string;
    dayNum: number;
    monthLabel: string | null;
    isToday: boolean;
    classes: string;
  }
  const weeks = $derived.by<DayCell[][]>(() => {
    // recompute when these change
    void today;
    void anchorStart;
    void selectedDate;
    const rowsBefore = Math.floor(VISIBLE_WEEKS / 2);
    const firstIndex = -rowsBefore;
    const out: DayCell[][] = [];
    // Precompute month meta for boundary classes.
    const monthMeta = new Map<string, { firstDow: number; lastDow: number }>();
    const metaFor = (year: number, month: number) => {
      const k = `${year}-${month}`;
      let m = monthMeta.get(k);
      if (!m) {
        m = {
          firstDow: new Date(year, month, 1).getDay(),
          lastDow: new Date(year, month + 1, 0).getDay(),
        };
        monthMeta.set(k, m);
      }
      return m;
    };
    // Build raw cells first.
    const raw: { date: Date; key: string; month: number; year: number; dow: number; cell: DayCell }[][] = [];
    for (let w = 0; w < VISIBLE_WEEKS; w += 1) {
      const start = addDays(anchorStart, (firstIndex + w) * 7);
      const row: typeof raw[number] = [];
      for (let i = 0; i < 7; i += 1) {
        const date = addDays(start, i);
        const key = formatKey(date);
        const isFirstOfMonth = date.getDate() === 1;
        const isToday = isSameDay(date, today);
        let monthLabel: string | null = null;
        if (isFirstOfMonth || isToday) {
          monthLabel = isToday
            ? 'Today'
            : (() => {
                try {
                  return date.toLocaleString(undefined, { month: 'long' });
                } catch {
                  return String(date.getMonth() + 1);
                }
              })();
        }
        const cell: DayCell = {
          date,
          key,
          dayNum: date.getDate(),
          monthLabel,
          isToday,
          classes: '',
        };
        row.push({ date, key, month: date.getMonth(), year: date.getFullYear(), dow: date.getDay(), cell });
      }
      raw.push(row);
    }
    // Compute classes (selected/today/month-label + boundaries).
    raw.forEach((row, rowIdx) => {
      row.forEach((c, colIdx) => {
        const classes: string[] = ['planner-day'];
        if (c.cell.monthLabel != null) classes.push('has-month-label');
        if (c.cell.isToday) classes.push('is-today');
        if (selectedDate && isSameDay(c.date, selectedDate)) classes.push('is-selected');
        const meta = metaFor(c.year, c.month);
        if (colIdx > 0) {
          const prev = row[colIdx - 1];
          if (prev && prev.month !== c.month) classes.push('month-left-boundary');
        }
        if (rowIdx > 0) {
          const above = raw[rowIdx - 1]?.[colIdx];
          if (above && above.month !== c.month && c.dow >= meta.firstDow) {
            classes.push('month-top-boundary');
          }
        }
        if (rowIdx < raw.length - 1) {
          const below = raw[rowIdx + 1]?.[colIdx];
          if (below && below.month !== c.month && meta.lastDow !== 6 && c.dow <= meta.lastDow) {
            classes.push('month-bottom-boundary');
          }
        }
        c.cell.classes = classes.join(' ');
      });
    });
    raw.forEach((row) => out.push(row.map((c) => c.cell)));
    return out;
  });

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
  function historyChart(node: SVGSVGElement, p: HistoryPreview) {
    const render = () => {
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
    };
    requestAnimationFrame(render);
    return {};
  }
  function scheduledChart(node: SVGSVGElement, p: ScheduledPreview) {
    const render = () => {
      const rect = node.parentElement?.getBoundingClientRect();
      drawMiniHistoryChart({
        svg: node,
        width: rect?.width || 240,
        height: rect?.height || 36,
        ftp: currentFtp,
        rawSegments: p.rawSegments,
        durationSec: p.durationSec,
      });
    };
    requestAnimationFrame(render);
    return {};
  }
  function powerCurveChart(node: SVGSVGElement, d: DetailState) {
    requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      drawPowerCurveChart({
        svg: node,
        width: rect.width || 600,
        height: rect.height || 300,
        ftp: d.ftp || 0,
        points: d.powerCurve || [],
        maxDurationSec: d.durationSec || 0,
      });
    });
    return {};
  }
  function detailChart(node: SVGSVGElement, d: DetailState) {
    requestAnimationFrame(() => {
      const rect = node.parentElement?.getBoundingClientRect();
      drawWorkoutChart({
        svg: node,
        width: rect?.width || 1000,
        height: rect?.height || 320,
        ftp: d.ftp || 0,
        rawSegments: d.rawSegments || [],
        elapsedSec: d.activeDurationSec || d.durationSec || 0,
        liveSamples: d.samples || [],
        showProgress: false,
      });
    });
    return {};
  }

  // --------------------------- interactions ---------------------------
  function selectDay(key: string): void {
    selectedDate = keyToDate(key);
  }

  async function openDetail(p: HistoryPreview): Promise<void> {
    // Re-read the FIT for full samples/meta (matches legacy openDetailView).
    const entries = await fileStore.listHistory();
    const match = entries.find((e) => e.fileName === p.fileName) || null;
    if (!match) return;
    const parsed = match.parsed;
    const cw = parsed.canonicalWorkout || ({} as CanonicalWorkout);
    const meta = parsed.meta || {};
    const samples = parsed.samples || [];
    const ftp = meta.ftp || DEFAULT_FTP;
    const lastSample = samples.length ? samples[samples.length - 1] : null;
    const durationSecHint =
      meta.totalTimerSec != null
        ? Math.max(1, Math.round(meta.totalTimerSec))
        : meta.startedAt && meta.endedAt
          ? Math.max(1, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
          : Math.max(1, Math.round(lastSample?.t || 0));
    const metrics = computeMetricsFromSamples(samples, ftp, durationSecHint);
    const totalTimerSec = meta.totalTimerSec || metrics.durationSec || durationSecHint || 0;
    const totalElapsedSec =
      meta.totalElapsedSec ||
      (meta.startedAt && meta.endedAt
        ? Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
        : totalTimerSec);
    const pausedSec = Math.max(0, totalElapsedSec - totalTimerSec);
    const hrStats = computeHrCadStats(samples);
    const curvePoints = buildPowerCurve(metrics.perSecondPower || [], POWER_CURVE_DURS);
    const activeDurationSec =
      totalTimerSec || Math.max(0, (metrics.durationSec || durationSecHint || 0) - pausedSec);
    const vi =
      metrics.avgPower && metrics.avgPower > 0 && metrics.normalizedPower
        ? metrics.normalizedPower / metrics.avgPower
        : null;
    const ef = metrics.avgHr && metrics.avgHr > 0 ? (metrics.normalizedPower || 0) / metrics.avgHr : null;

    detail = {
      fileName: p.fileName,
      workoutTitle: cw.workoutTitle || p.workoutTitle,
      durationSec: metrics.durationSec || durationSecHint || 0,
      activeDurationSec,
      kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
      ifValue: metrics.ifValue,
      tss: metrics.tss,
      avgPower: metrics.avgPower,
      normalizedPower: metrics.normalizedPower,
      vi,
      ef,
      ftp,
      rawSegments: cw.rawSegments || [],
      samples,
      powerCurve: curvePoints,
      startedAt: meta.startedAt || p.startedAt || utcDateKeyToLocalDate(formatKey(today)),
      pausedSec,
      avgHr: hrStats.avgHr,
      maxHr: hrStats.maxHr,
      avgCadence: hrStats.avgCadence,
      maxCadence: hrStats.maxCadence,
      zone: p.zone || inferZoneFromSegments(cw.rawSegments || []),
    };
  }

  function exitDetail(): void {
    detail = null;
  }

  // Detail stat chips (label/value/tooltip), mirrors renderDetailStats order.
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
  async function onScheduleDay(): Promise<void> {
    if (!selectedDate) return;
    const dateKey = formatKey(selectedDate);
    if (isPastDate(dateKey)) return;
    const cw = store.vm?.canonicalWorkout;
    if (!cw || !cw.workoutTitle) {
      await dialogs.alert('Select a workout on the main screen first, then schedule it.', {
        title: 'Schedule workout',
      });
      return;
    }
    const ok = await dialogs.confirm(
      `Schedule "${cw.workoutTitle}" on ${formatSelectedLabel(selectedDate)}?`,
      { title: 'Schedule workout', okLabel: 'Schedule' },
    );
    if (!ok) return;
    const entries = await fileStore.loadSchedule();
    const next: ScheduleEntry[] = entries.filter(
      (e) => !(e.date === dateKey && e.workoutTitle === cw.workoutTitle),
    );
    next.push({ date: dateKey, workoutTitle: cw.workoutTitle });
    await fileStore.saveSchedule(next);
    await loadSchedule();
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

  // Load a scheduled workout into the engine + close the planner (legacy
  // onScheduledLoadRequested → saveSelectedWorkout + setWorkoutFromPicker +
  // planner.close). The full CanonicalWorkout was joined in loadSchedule.
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

  // Edit a scheduled entry (legacy onScheduledEditRequested re-opened the picker
  // in schedule mode). Minimal-but-real handoff: let the user re-pick the
  // engine's current workout for this day, or remove the entry. Writes
  // schedule.json directly (mirrors the simplified onScheduleDay flow).
  async function onEditScheduled(entry: ScheduledPreview): Promise<void> {
    const cw = store.vm?.canonicalWorkout;
    const newTitle = cw?.workoutTitle;
    // Use the dialog confirm for replace (if a different workout is selected),
    // otherwise go straight to a remove confirm.
    let action: 'replace' | 'remove' | null = null;
    if (newTitle && newTitle !== entry.workoutTitle) {
      const replace = await dialogs.confirm(
        `Replace "${entry.workoutTitle}" with the selected workout "${newTitle}" on ${entry.date}?`,
        { title: 'Edit scheduled workout', okLabel: 'Replace', cancelLabel: 'Remove instead' },
      );
      action = replace ? 'replace' : 'remove';
    } else {
      const remove = await dialogs.confirm(
        `Remove the scheduled workout "${entry.workoutTitle}" on ${entry.date}? (Select a different workout on the main screen first to change it.)`,
        { title: 'Edit scheduled workout', okLabel: 'Remove' },
      );
      if (!remove) return;
      action = 'remove';
    }
    const entries = await fileStore.loadSchedule();
    const next = entries.filter((e) => !(e.date === entry.date && e.workoutTitle === entry.workoutTitle));
    if (action === 'replace' && newTitle) {
      next.push({ date: entry.date, workoutTitle: newTitle });
    }
    await fileStore.saveSchedule(next);
    await loadSchedule();
  }

  // --------------------------- keyboard (legacy onKeyDown ~1285-1395) ---------------------------
  function isEditableTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

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
    // here. Mirrors legacy ignoring Escape in the non-detail branch.
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
  // the PickerView registration convention (Wave 1).
  $effect(() => {
    if (open) {
      ui.registerOverlayKeyHandler('planner', handlePlannerKey);
      return () => ui.registerOverlayKeyHandler('planner', null);
    }
    return undefined;
  });

  // Tell the ui store whether the detail sub-view is open so Escape/Backspace
  // pop the detail back to the calendar (instead of closing the whole planner),
  // matching legacy. Cleared on close.
  $effect(() => {
    ui.plannerDetailOpen = open && detailMode;
  });
</script>

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
        <div class="planner-calendar-body" id="plannerCalendarBody" bind:this={calendarBodyEl} data-testid="planner-calendar-body">
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
                        onclick={(e) => { e.stopPropagation(); if (!p.missing) void onLoadScheduled(p); }}
                        onkeydown={() => {}}
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
          <span id="plannerHotkeyPrompt">Press <strong>?</strong> for shortcuts</span>
        </div>
        <div class="planner-footer-right">
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
