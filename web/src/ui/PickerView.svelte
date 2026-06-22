<script lang="ts">
  // PickerView — the #workoutPickerOverlay / #workoutPickerModal. Implements
  // browse / list / search (grammar 30-45 / <40 / >60 / 45) / zone+duration
  // filters / sort / expand (stats + mini chart) / select-to-ride / delete
  // (->trash) / clone. The in-picker workout BUILDER is fully shipped: the
  // "Create workout" / Edit buttons open the embedded BuilderView (see
  // onCreateWorkout / onEdit).
  import OverlayModal from './OverlayModal.svelte';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { FileStore } from '../ports/FileStore.js';
  import {
    scheduleWorkoutForDay as scheduleWorkoutForDayRule,
    unscheduleEntry,
    type ScheduleEntry,
  } from '../core/schedule.js';
  import { parseSearchQuery, matchesSearchQuery } from '../core/calendar.js';
  import type { UiStore } from '../state/ui.svelte.js';
  import type { EngineStore } from '../state/engine.svelte.js';
  import type { DialogStore } from '../state/dialog.svelte.js';
  import type { CanonicalWorkout } from '../core/model.js';
  import {
    computeMetricsFromSegments,
    inferZoneFromSegments,
    getDurationBucket,
    formatDurationMinSec,
    type SegmentMetrics,
  } from '../core/metrics.js';
  import { renderMiniWorkoutGraph } from '../core/chart.js';
  import { themeAutoVersion } from '../state/theme.svelte.js';
  import { DEFAULT_FTP } from '../core/metrics.js';
  import BuilderView, { type BuilderApi } from './BuilderView.svelte';
  import { parseWorkoutUrl } from '../core/scrapers.js';
  import { fetchTrainerDayPopular, fetchWhatsOnZwiftAll } from '../core/importers.js';
  import { openExternal } from '../app/compat.js';

  const TRAINERDAY_SEARCH_URL = 'https://app.trainerday.com/search?sortBy=popularity';
  const WHATSONZWIFT_BROWSE_URL = 'https://whatsonzwift.com/workouts';
  import { parseFitFile } from '../core/fit.js';
  import { parseZwoXmlToCanonicalWorkout } from '../core/zwo.js';
  import { isEditableTarget } from './dom-utils.js';

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

  type SortKey = 'kjAdj' | 'if' | 'tss' | 'duration' | 'name';
  interface PickerItem {
    canonical: CanonicalWorkout;
    zone: string;
    metrics: SegmentMetrics;
  }

  const currentFtp = $derived(store.vm?.currentFtp || DEFAULT_FTP);

  let workouts = $state<CanonicalWorkout[]>([]);
  let searchTerm = $state('');
  let zoneValue = $state('');
  let durationValue = $state('');
  let sortKey = $state<SortKey>('kjAdj');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let expandedId = $state<string | null>(null);

  // pickerState persistence (search + zone + duration + sort) across opens.
  // We suppress the auto-save effect while restoring so the restore itself
  // doesn't immediately re-persist defaults.
  const PICKER_STATE_KEY = 'pickerState';
  interface PickerState {
    searchTerm?: string;
    zone?: string;
    duration?: string;
    sortKey?: SortKey;
    sortDir?: 'asc' | 'desc';
  }
  const VALID_DURATIONS = new Set([
    '', '1-30', '31-45', '46-60', '61-75', '76-90', '91-120', '121-180', '181-240', '>240',
  ]);
  let pickerStateReady = $state(false);

  async function restorePickerState(): Promise<void> {
    pickerStateReady = false;
    const saved = await fileStore.getSetting<PickerState | null>(PICKER_STATE_KEY, null);
    if (saved) {
      searchTerm = saved.searchTerm || '';
      zoneValue = saved.zone || '';
      durationValue = VALID_DURATIONS.has(saved.duration || '') ? saved.duration || '' : '';
      if (saved.sortKey) sortKey = saved.sortKey;
      if (saved.sortDir === 'asc' || saved.sortDir === 'desc') sortDir = saved.sortDir;
    }
    pickerStateReady = true;
  }

  function persistPickerState(): void {
    void fileStore.putSetting(PICKER_STATE_KEY, {
      searchTerm,
      zone: zoneValue,
      duration: durationValue,
      sortKey,
      sortDir,
    } satisfies PickerState);
  }

  // Persist on every filter/sort change once the picker is open + restored.
  $effect(() => {
    // Track the persisted fields reactively.
    void searchTerm;
    void zoneValue;
    void durationValue;
    void sortKey;
    void sortDir;
    if (open && pickerStateReady && !builderMode) persistPickerState();
  });

  // Rescan the library whenever the picker is opened.
  $effect(() => {
    if (open) {
      // Pre-expand the targeted entry in schedule EDIT mode; otherwise start
      // collapsed.
      expandedId = null;
      builderMode = false;
      const scheduledTitle = ui.pickerScheduleContext?.entry?.workoutTitle ?? null;
      void (async () => {
        await restorePickerState();
        await rescan();
        if (scheduledTitle) expandedId = idForTitle(scheduledTitle);
      })();
    }
  });

  // When a row expands (click, keyboard, or post-action), bring it into view —
  // mirrors the legacy picker: scrollIntoView({ block: 'nearest', smooth }) on
  // the rendered expanded row, deferred a frame so layout (incl. the mini chart)
  // has settled.
  let tbodyEl = $state<HTMLTableSectionElement | null>(null);
  $effect(() => {
    if (!expandedId) return;
    requestAnimationFrame(() => {
      tbodyEl?.querySelector('.picker-expanded-row')?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  });

  async function rescan(): Promise<void> {
    workouts = await fileStore.listWorkouts();
  }

  function getZone(cw: CanonicalWorkout): string {
    return inferZoneFromSegments(cw.rawSegments) || 'Uncategorized';
  }

  // Name shown in the library navigator: the workout's folder path (from its
  // sourcePath) + its title. Workouts at the root just show the title. Used only
  // for display here — everywhere else (selected workout, HUD, schedule) uses the
  // plain workoutTitle.
  function libraryName(cw: CanonicalWorkout): string {
    const path = cw.sourcePath || '';
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const name = cw.workoutTitle || 'Untitled';
    return dir ? `${dir.replace(/\//g, ' / ')} / ${name}` : name;
  }

  // Stable identity for expand/selection — the unique file path, so workouts
  // that share a title in different folders don't expand together.
  function workoutId(cw: CanonicalWorkout): string {
    return cw.sourcePath ?? cw.workoutTitle;
  }
  // Resolve a (possibly ambiguous) title to a listed workout's id — used after
  // save/clone/schedule where we only know the title.
  function idForTitle(title: string | null | undefined): string | null {
    if (!title) return null;
    const match = allItems.find((it) => it.canonical.workoutTitle === title);
    return match ? workoutId(match.canonical) : title;
  }

  // --------------------------- visible (search / filter / sort) ---------------------------
  const allItems = $derived.by<PickerItem[]>(() => {
    const ftp = currentFtp;
    return workouts.map((canonical) => ({
      canonical,
      zone: getZone(canonical),
      metrics: computeMetricsFromSegments(canonical.rawSegments, ftp),
    }));
  });

  const visibleItems = $derived.by<PickerItem[]>(() => {
    let items = allItems;

    if (zoneValue) items = items.filter((it) => it.zone === zoneValue);

    if (durationValue) {
      items = items.filter(
        (it) => getDurationBucket(it.metrics.durationMin) === durationValue,
      );
    }

    const term = searchTerm.toLowerCase();
    if (term) {
      // Search grammar (tokens + duration range) is parsed/matched by the pure
      // core/calendar helper.
      const query = parseSearchQuery(term);
      items = items.filter((it) => {
        const haystack = [
          it.canonical.workoutTitle,
          it.zone,
          it.canonical.source || '',
          it.canonical.sourcePath || '',
        ]
          .join(' ')
          .toLowerCase();
        return matchesSearchQuery(query, haystack, it.metrics.durationMin);
      });
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    const num = (v: number | null | undefined) => (Number.isFinite(v) ? (v as number) : -Infinity);
    return items.slice().sort((a, b) => {
      if (sortKey === 'kjAdj') return (num(a.metrics.kj) - num(b.metrics.kj)) * dir;
      if (sortKey === 'if') return (num(a.metrics.ifValue) - num(b.metrics.ifValue)) * dir;
      if (sortKey === 'tss') return (num(a.metrics.tss) - num(b.metrics.tss)) * dir;
      if (sortKey === 'duration')
        return (num(a.metrics.durationMin) - num(b.metrics.durationMin)) * dir;
      if (sortKey === 'name')
        return a.canonical.workoutTitle.localeCompare(b.canonical.workoutTitle) * dir;
      return 0;
    });
  });

  // --------------------------- folder navigation ---------------------------
  let currentFolder = $state('');
  let showAllFolders = $state(false);

  // Browse by folder by default; "show all" flattens to one list. Search/filter
  // keep the folder layout but only show folders that contain matches (the
  // folder counts then reflect the number of matches).
  const flatMode = $derived(showAllFolders);

  type NavFolder = { kind: 'folder'; name: string; path: string; count: number };
  type NavWorkout = { kind: 'workout'; item: PickerItem; label: string };
  type NavEntry = NavFolder | NavWorkout;

  const navEntries = $derived.by<NavEntry[]>(() => {
    if (flatMode) {
      // Flat: every matching workout, labelled with its full folder path.
      return visibleItems.map((item) => ({
        kind: 'workout' as const,
        item,
        label: libraryName(item.canonical),
      }));
    }
    // Folder mode: subfolders of `currentFolder` + the workouts directly in it.
    const prefix = currentFolder ? currentFolder + '/' : '';
    const folderCounts = new Map<string, number>();
    const workoutsHere: NavEntry[] = [];
    for (const item of visibleItems) {
      const path = item.canonical.sourcePath || `${item.canonical.workoutTitle}.zwo`;
      if (prefix && !path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) {
        const sub = rest.slice(0, slash);
        folderCounts.set(sub, (folderCounts.get(sub) || 0) + 1);
      } else {
        workoutsHere.push({
          kind: 'workout',
          item,
          label: item.canonical.workoutTitle || 'Untitled',
        });
      }
    }
    const folders: NavEntry[] = [...folderCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ kind: 'folder', name, path: prefix + name, count }));
    return [...folders, ...workoutsHere];
  });

  // The workout rows actually shown right now (current folder, or all in flat
  // mode) — keyboard expansion + select/edit cycle through these, not every
  // filtered workout.
  const shownWorkoutItems = $derived(
    navEntries.filter((e): e is NavWorkout => e.kind === 'workout').map((e) => e.item),
  );

  const breadcrumbSegments = $derived.by<{ name: string; path: string }[]>(() => {
    if (!currentFolder) return [];
    const segs = currentFolder.split('/');
    return segs.map((name, i) => ({ name, path: segs.slice(0, i + 1).join('/') }));
  });

  function navEntryKey(e: NavEntry): string {
    return e.kind === 'folder'
      ? 'f:' + e.path
      : 'w:' + (e.item.canonical.sourcePath ?? e.item.canonical.workoutTitle);
  }

  function enterFolder(path: string): void {
    currentFolder = path;
    expandedId = null;
  }

  function folderParent(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i) : '';
  }

  const summaryText = $derived(
    workouts.length === 0
      ? 'No .zwo files found in this folder yet.'
      : `${visibleItems.length} of ${workouts.length} workouts shown`,
  );
  const showEmptyState = $derived(workouts.length === 0);

  // --------------------------- display helpers ---------------------------
  function formatPickerDuration(m: SegmentMetrics): string {
    if (!m) return '';
    if (Number.isFinite(m.totalSec) && m.totalSec > 0) return formatDurationMinSec(m.totalSec);
    if (Number.isFinite(m.durationMin) && m.durationMin > 0)
      return formatDurationMinSec(m.durationMin * 60);
    return '';
  }
  function zoneDotClass(zoneLabel: string): string {
    const z = (zoneLabel || '').toLowerCase();
    if (z.startsWith('recovery')) return 'picker-zone-dot-recovery';
    if (z.startsWith('endurance')) return 'picker-zone-dot-endurance';
    if (z.startsWith('tempo')) return 'picker-zone-dot-tempo';
    if (z.startsWith('threshold')) return 'picker-zone-dot-threshold';
    if (z.startsWith('vo2')) return 'picker-zone-dot-vo2';
    if (z.startsWith('anaerobic')) return 'picker-zone-dot-anaerobic';
    return 'picker-zone-dot-unknown';
  }
  function ifText(m: SegmentMetrics): string {
    return m.ifValue != null ? m.ifValue.toFixed(2) : '';
  }
  function tssText(m: SegmentMetrics): string {
    return m.tss != null ? String(Math.round(m.tss)) : '';
  }
  function kjText(m: SegmentMetrics): string {
    return m.kj != null ? `${Math.round(m.kj)} kJ` : '';
  }

  // --------------------------- interactions ---------------------------
  function onSort(key: SortKey): void {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = key === 'kjAdj' ? 'asc' : 'desc';
    }
  }
  function sortClass(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc';
  }

  function toggleExpand(id: string): void {
    expandedId = expandedId === id ? null : id;
  }

  // --------------------------- schedule mode ---------------------------
  // When opened from the planner (ui.openPickerForSchedule), the picker becomes
  // the workout LIBRARY in "Schedule Workout" / "Edit Schedule" mode: the row
  // CTA is relabeled, Create-workout is hidden, Back-to-calendar (+ Unschedule
  // in edit mode) appear, and selecting SCHEDULES the workout for the day (writes
  // schedule.json) then returns to the planner — it does NOT load onto the HUD.
  const scheduleCtx = $derived(ui.pickerScheduleContext);
  const scheduleMode = $derived(scheduleCtx != null);
  const scheduleEditMode = $derived(scheduleCtx?.editMode === true);

  function doSelect(canonical: CanonicalWorkout): void {
    if (scheduleCtx) {
      void scheduleWorkoutForDay(canonical, scheduleCtx);
      return;
    }
    // Persist so the selection survives a reload (WebFileStore de-proxies the
    // $state value). Surface failures instead of swallowing them with `void`.
    fileStore
      .putSetting('selectedWorkout', canonical)
      .catch((e) => console.error('[velo] persist selectedWorkout failed', e));
    engine.setWorkoutFromPicker(canonical);
    ui.close();
  }

  // Schedule the picked workout on the context's day (replace in edit mode),
  // persist schedule.json, then return to the planner calendar (which reloads
  // the schedule on re-open).
  async function scheduleWorkoutForDay(
    canonical: CanonicalWorkout,
    ctx: { dateKey: string; entry: ScheduleEntry | null; editMode: boolean },
  ): Promise<void> {
    const title = canonical.workoutTitle;
    if (!title) return;
    const entries = await fileStore.loadSchedule();
    const next = scheduleWorkoutForDayRule(entries, ctx.dateKey, title, ctx.entry);
    await fileStore.saveSchedule(next);
    ui.returnToPlannerFromSchedule();
  }

  // Unschedule (edit mode): remove the targeted entry, persist, return to planner.
  async function onScheduleUnschedule(): Promise<void> {
    const ctx = scheduleCtx;
    if (!ctx?.entry) return;
    const entries = await fileStore.loadSchedule();
    const next = unscheduleEntry(entries, ctx.entry);
    await fileStore.saveSchedule(next);
    ui.returnToPlannerFromSchedule();
  }

  // Back to calendar (+ Escape/Backspace in schedule mode): cancel, return to the
  // planner WITHOUT scheduling.
  function onBackToCalendar(): void {
    ui.returnToPlannerFromSchedule();
  }

  async function onDelete(canonical: CanonicalWorkout): Promise<void> {
    const fileName = encodeURIComponent(canonical.workoutTitle || 'workout') + '.zwo';
    const ok = await dialogs.confirm(`Move workout file "${fileName}" to the trash folder?`, {
      title: 'Delete workout',
      okLabel: 'Delete',
    });
    if (!ok) return;
    const moved = await fileStore.deleteWorkoutToTrash(canonical);
    if (!moved) return;
    if (expandedId === workoutId(canonical)) expandedId = null;
    await rescan();
  }

  function buildCopyTitle(originalTitle: string): string {
    const base = `${originalTitle} Copy`;
    const existing = new Set(workouts.map((w) => w.workoutTitle || ''));
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base} (${i})`)) i += 1;
    return `${base} (${i})`;
  }

  function cloneCanonical(cw: CanonicalWorkout): CanonicalWorkout {
    return {
      ...cw,
      workoutTitle: cw.workoutTitle || '',
      source: cw.source || '',
      sourceURL: cw.sourceURL || '',
      description: cw.description || '',
      textEvents: Array.isArray(cw.textEvents) ? cw.textEvents.map((e) => ({ ...e })) : [],
      rawSegments: Array.isArray(cw.rawSegments)
        ? cw.rawSegments.map((seg) => (Array.isArray(seg) ? ([...seg] as typeof seg) : seg))
        : [],
    };
  }

  async function onClone(canonical: CanonicalWorkout): Promise<void> {
    const copy = cloneCanonical(canonical);
    copy.workoutTitle = buildCopyTitle(canonical.workoutTitle || 'Workout');
    const saved = await fileStore.saveWorkout(copy);
    if (!saved) return;
    await rescan();
    expandedId = idForTitle(copy.workoutTitle);
  }

  // --------------------------- builder host ---------------------------
  // The in-picker workout builder. "Create workout" opens a fresh default
  // workout; per-row "Edit" loads the workout into the builder. "Back" returns
  // to the library; "Save" validates + writes the .zwo + reopens the library.
  let builderMode = $state(false);
  let builderTitle = $state('New Workout');
  let builderStatusText = $state('');
  let builderStatusTone = $state('neutral');
  let builderHasSelection = $state(false);
  let builderOriginalTitle = $state<string | null>(null);
  let builderApi = $state<BuilderApi | undefined>(undefined);

  // --------------------------- builder dirty-tracking + draft ---------------------------
  // Baseline = the canonical workout the builder was loaded with; the builder is
  // "dirty" when getState() no longer equals it. The in-progress draft is
  // persisted so an accidental close can be recovered on the next builder open.
  const BUILDER_STATE_KEY = 'workoutBuilderState';
  let builderBaseline = $state<CanonicalWorkout | null>(null);
  let hasUnsavedBuilderChanges = $state(false);
  let suppressBuilderDirty = false;

  function canonicalEquals(a: CanonicalWorkout | null, b: CanonicalWorkout | null): boolean {
    if (!a || !b) return false;
    if (
      (a.workoutTitle || '') !== (b.workoutTitle || '') ||
      (a.source || '') !== (b.source || '') ||
      (a.sourceURL || '') !== (b.sourceURL || '') ||
      (a.description || '') !== (b.description || '')
    ) {
      return false;
    }
    const arrA = Array.isArray(a.rawSegments) ? a.rawSegments : [];
    const arrB = Array.isArray(b.rawSegments) ? b.rawSegments : [];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i += 1) {
      const segA = (arrA[i] || []) as unknown[];
      const segB = (arrB[i] || []) as unknown[];
      if (segA.length !== segB.length) return false;
      for (let j = 0; j < segA.length; j += 1) {
        const aVal = segA[j];
        const bVal = segB[j];
        if (typeof aVal === 'string' || typeof bVal === 'string') {
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
      const aEvt = eventsA[i] || ({} as { offsetSec?: number; durationSec?: number; text?: string });
      const bEvt = eventsB[i] || ({} as { offsetSec?: number; durationSec?: number; text?: string });
      if (Number(aEvt.offsetSec) !== Number(bEvt.offsetSec)) return false;
      if (Number(aEvt.durationSec) !== Number(bEvt.durationSec)) return false;
      if (String(aEvt.text || '') !== String(bEvt.text || '')) return false;
    }
    return true;
  }

  function setBuilderBaselineFromCurrent(): void {
    if (!builderApi) return;
    builderBaseline = builderApi.getState();
    hasUnsavedBuilderChanges = false;
  }

  // Fired by BuilderView after every model mutation. Recompute dirty + persist
  // the draft so an accidental close can be recovered.
  function onBuilderChange(): void {
    if (!builderApi || suppressBuilderDirty || !builderMode) return;
    const current = builderApi.getState();
    hasUnsavedBuilderChanges = !builderBaseline || !canonicalEquals(current, builderBaseline);
    void fileStore.putSetting(BUILDER_STATE_KEY, current);
  }

  async function clearPersistedBuilderState(): Promise<void> {
    await fileStore.putSetting(BUILDER_STATE_KEY, null);
  }

  // Confirm-on-leave when the builder has unsaved edits. Returns true if it's
  // safe to leave.
  async function maybeHandleUnsavedBeforeLeave(): Promise<boolean> {
    if (!builderMode || !hasUnsavedBuilderChanges) return true;
    const ok = await dialogs.confirm('Discard unsaved changes?', {
      title: 'Unsaved changes',
      okLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (!ok) return false;
    await clearPersistedBuilderState();
    hasUnsavedBuilderChanges = false;
    return true;
  }

  // Mirror builderMode into the ui store so the App's global key router knows
  // the builder owns the keymap (suppresses global hotkeys + close-on-Escape).
  // Cleared whenever the picker is closed (open=false) so a stale flag never
  // leaks into the HUD.
  $effect(() => {
    ui.pickerBuilderMode = open && builderMode;
    return () => {
      ui.pickerBuilderMode = false;
    };
  });

  // When entering builder mode, mount the BuilderView; defer init to it.
  function enterBuilderMode(title: string): void {
    builderMode = true;
    builderTitle = title;
    builderStatusText = '';
    builderStatusTone = 'neutral';
  }
  function exitBuilderMode(): void {
    builderMode = false;
    builderOriginalTitle = null;
    builderTitle = 'New Workout';
    builderBaseline = null;
    hasUnsavedBuilderChanges = false;
  }

  function onCreateWorkout(): void {
    enterBuilderMode('New Workout');
    builderOriginalTitle = null;
    // BuilderView mounts with a default workout already initialized. Try to
    // restore an in-progress draft, else baseline against the default.
    requestAnimationFrame(() => {
      void restoreBuilderDraftOrDefault();
    });
  }
  function onEdit(canonical: CanonicalWorkout): void {
    enterBuilderMode(canonical.workoutTitle || 'Edit workout');
    builderOriginalTitle = canonical.workoutTitle || null;
    // Load after the BuilderView mounts.
    requestAnimationFrame(() => {
      suppressBuilderDirty = true;
      builderApi?.loadCanonicalWorkout(canonical);
      builderApi?.refreshLayout();
      setBuilderBaselineFromCurrent();
      suppressBuilderDirty = false;
    });
  }

  // Restore a persisted draft if present (and non-trivial), else take the
  // default-workout baseline.
  async function restoreBuilderDraftOrDefault(): Promise<void> {
    const draft = await fileStore.getSetting<CanonicalWorkout | null>(BUILDER_STATE_KEY, null);
    suppressBuilderDirty = true;
    try {
      if (draft && Array.isArray(draft.rawSegments) && draft.rawSegments.length) {
        builderApi?.loadCanonicalWorkout(draft);
        builderApi?.refreshLayout();
        builderTitle = draft.workoutTitle || 'New Workout';
      }
      setBuilderBaselineFromCurrent();
    } finally {
      suppressBuilderDirty = false;
    }
  }

  // Load a scraped/uploaded workout into the builder (TrainerDay / file upload).
  function loadIntoBuilder(canonical: CanonicalWorkout, fallbackTitle: string): void {
    suppressBuilderDirty = true;
    try {
      builderApi?.loadCanonicalWorkout(canonical);
      builderApi?.refreshLayout();
      builderOriginalTitle = null;
      builderBaseline = canonical;
      hasUnsavedBuilderChanges = true;
      builderTitle = canonical.workoutTitle || fallbackTitle;
      void fileStore.putSetting(BUILDER_STATE_KEY, canonical);
    } finally {
      suppressBuilderDirty = false;
    }
  }

  // --------------------------- import: workout URL ---------------------------
  async function onImportUrl(): Promise<void> {
    if (!builderApi) return;
    const url = await dialogs.prompt(
      'Open a workout on TrainerDay or WhatsOnZwift, copy its URL from your browser, and paste it here.',
      {
        title: 'Import from URL',
        okLabel: 'Import',
        placeholder: 'https://…',
        example: 'https://whatsonzwift.com/workouts/zwift-academy/finale-workout',
      },
    );
    if (!url) return;
    const [canonical, error] = await parseWorkoutUrl(url.trim());
    if (!canonical) {
      if (error) await dialogs.alert(error, { title: 'Import failed' });
      return;
    }
    loadIntoBuilder(canonical, canonical.workoutTitle || 'Imported Workout');
  }

  // --------------------------- import: workout packs (zip → library) ---------------------------
  const ZWIFT_PACK_URL =
    'https://forums.zwift.com/uploads/short-url/kfwBnOg1iFvfNh65haAupeMIuav.zip';
  const ZWIFT_FORUM_URL = 'https://forums.zwift.com/t/workout-refresh-october-2023/609799';

  let importMenuOpen = $state(false);
  async function pickImport(kind: 'url' | 'upload'): Promise<void> {
    importMenuOpen = false;
    if (kind === 'url') await onImportUrl();
    else onUploadFileClick();
  }

  // ---- library bulk importers (each opens a modal from the Import dropdown) ----
  type ImportModal = 'zwift' | 'trainerday' | 'whatsonzwift';
  let importLibMenuOpen = $state(false);
  let importModal = $state<ImportModal | null>(null);
  let importBusy = $state(false);
  let importProgress = $state('');
  let trainerdayLimit = $state(1000);

  function openImportModal(which: ImportModal): void {
    importLibMenuOpen = false;
    importProgress = '';
    importModal = which;
  }

  function onImportModalStart(): Promise<void> {
    if (importModal === 'zwift') return runZwiftImport();
    if (importModal === 'trainerday') return runTrainerDayImport();
    return runWhatsOnZwiftImport();
  }

  async function runZwiftImport(): Promise<void> {
    importBusy = true;
    importProgress = 'Downloading the Zwift collection…';
    const { added, error } = await fileStore.importZwoZip(ZWIFT_PACK_URL, 'Zwift');
    importBusy = false;
    if (error) {
      await dialogs.alert(error, { title: 'Import failed' });
      return;
    }
    importModal = null;
    await rescan();
    await dialogs.alert(`Imported ${added} workouts into “Zwift”.`, { title: 'Import complete' });
  }

  async function runBatchImport(
    fetcher: () => Promise<import('../core/model.js').CanonicalWorkout[]>,
    folderLabel: string,
    reachErr: string,
  ): Promise<void> {
    importBusy = true;
    let canonicals;
    try {
      canonicals = await fetcher();
    } catch {
      importBusy = false;
      await dialogs.alert(reachErr, { title: 'Import failed' });
      return;
    }
    if (!canonicals.length) {
      importBusy = false;
      await dialogs.alert('No workouts were returned.', { title: 'Import failed' });
      return;
    }
    importProgress = `Saving ${canonicals.length} workouts…`;
    const { added, error } = await fileStore.importWorkoutBatch(
      canonicals,
      (d, t) => (importProgress = `Saved ${d}/${t}…`),
    );
    importBusy = false;
    if (error) {
      await dialogs.alert(error, { title: 'Import failed' });
      return;
    }
    importModal = null;
    await rescan();
    await dialogs.alert(`Imported ${added} workouts into “${folderLabel}”.`, {
      title: 'Import complete',
    });
  }

  function runTrainerDayImport(): Promise<void> {
    const limit = Math.max(1, Math.min(40000, Math.round(trainerdayLimit) || 1000));
    importProgress = `Fetching the top ${limit} workouts from TrainerDay…`;
    return runBatchImport(
      () => fetchTrainerDayPopular(limit, (m) => (importProgress = m)),
      'TrainerDay',
      'Could not reach TrainerDay. Check your connection (the desktop app avoids browser CORS limits).',
    );
  }

  function runWhatsOnZwiftImport(): Promise<void> {
    importProgress = 'Scanning WhatsOnZwift…';
    return runBatchImport(
      () => fetchWhatsOnZwiftAll((m) => (importProgress = m)),
      'WhatsOnZwift',
      'Could not crawl WhatsOnZwift — it blocks cross-origin requests in the browser. Use the desktop app for this import.',
    );
  }

  // --------------------------- import: file upload (.zwo/.fit) ---------------------------
  let uploadInputEl = $state<HTMLInputElement | null>(null);

  function onUploadFileClick(): void {
    if (!builderApi) return;
    uploadInputEl?.click();
  }

  async function onUploadFileChange(): Promise<void> {
    if (!builderApi || !uploadInputEl) return;
    const file = uploadInputEl.files && uploadInputEl.files[0];
    uploadInputEl.value = '';
    if (!file) return;
    const name = file.name || '';
    const ext = (name.toLowerCase().split('.').pop() || '');
    let canonical: CanonicalWorkout | null = null;
    try {
      if (ext === 'fit') {
        const buf = await file.arrayBuffer();
        const parsed = parseFitFile(buf);
        canonical = parsed?.canonicalWorkout || null;
      } else {
        const text = await file.text();
        canonical = parseZwoXmlToCanonicalWorkout(text);
      }
    } catch (err) {
      console.warn('[PickerView] Upload parse failed:', err);
      canonical = null;
    }
    if (!canonical || !Array.isArray(canonical.rawSegments) || !canonical.rawSegments.length) {
      await dialogs.alert('Unable to load workout file.', { title: 'Upload failed' });
      return;
    }
    loadIntoBuilder(normalizeUploadedWorkout(canonical, name), 'Uploaded Workout');
  }

  // Default title/source/description for an uploaded file.
  function normalizeUploadedWorkout(canonical: CanonicalWorkout, fileName: string): CanonicalWorkout {
    const next: CanonicalWorkout = {
      ...canonical,
      rawSegments: Array.isArray(canonical.rawSegments) ? canonical.rawSegments : [],
      textEvents: Array.isArray(canonical.textEvents) ? canonical.textEvents : [],
    };
    const baseName = String(fileName || '').replace(/\.[^/.]+$/, '');
    if (!next.workoutTitle || !String(next.workoutTitle).trim()) {
      next.workoutTitle = baseName || 'Uploaded Workout';
    }
    if (!next.source || !String(next.source).trim()) {
      next.source = baseName ? `Uploaded ${baseName}` : 'Uploaded file';
    }
    if (!next.description || !String(next.description).trim()) {
      next.description = buildSegmentDescription(next.rawSegments);
    }
    return next;
  }

  function buildSegmentDescription(rawSegments: CanonicalWorkout['rawSegments']): string {
    if (!Array.isArray(rawSegments) || !rawSegments.length) return 'Workout loaded from file.';
    let totalSec = 0;
    let rampCount = 0;
    let steadyCount = 0;
    let freeRideCount = 0;
    rawSegments.forEach((seg) => {
      if (!Array.isArray(seg)) return;
      const minutes = Number(seg[0]) || 0;
      totalSec += Math.max(1, Math.round(minutes * 60));
      if (seg[3] === 'freeride') {
        freeRideCount += 1;
        return;
      }
      const start = Number(seg[1]) || 0;
      const end = seg[2] != null ? Number(seg[2]) : start;
      if (Math.abs(start - end) > 1e-6) rampCount += 1;
      else steadyCount += 1;
    });
    const parts = [`${formatDurationMinSec(totalSec)} workout`];
    const detail: string[] = [];
    if (steadyCount) detail.push(`${steadyCount} steady`);
    if (rampCount) detail.push(`${rampCount} ramp${rampCount === 1 ? '' : 's'}`);
    if (freeRideCount) detail.push(`${freeRideCount} freeride`);
    if (detail.length) parts.push(`with ${detail.join(', ')}`);
    return parts.join(' ') + '.';
  }

  function onBuilderStatusChange(p: { text: string; tone: string }): void {
    builderStatusText = p.text;
    builderStatusTone = p.tone;
  }
  function onBuilderUiStateChange(p: { hasSelection: boolean }): void {
    builderHasSelection = p.hasSelection;
  }

  async function onBuilderBack(): Promise<void> {
    const safe = await maybeHandleUnsavedBeforeLeave();
    if (!safe) return;
    await clearPersistedBuilderState();
    exitBuilderMode();
  }

  async function onBuilderSave(): Promise<void> {
    if (!builderApi) return;
    const validation = builderApi.validateForSave();
    if (!validation.ok) return;
    const canonical = builderApi.getState();
    if (!canonical || !Array.isArray(canonical.rawSegments) || !canonical.rawSegments.length) {
      return;
    }
    // Title rename: move the old file to trash first.
    const originalTitle = builderOriginalTitle && builderOriginalTitle.trim()
      ? builderOriginalTitle.trim()
      : null;
    const nextTitle = (canonical.workoutTitle || '').trim();
    if (originalTitle && nextTitle && originalTitle !== nextTitle) {
      await fileStore.deleteWorkoutToTrash({ ...canonical, workoutTitle: originalTitle });
    }
    const saved = await fileStore.saveWorkout(canonical);
    if (!saved) return;
    await clearPersistedBuilderState();
    hasUnsavedBuilderChanges = false;
    exitBuilderMode();
    await rescan();
    expandedId = idForTitle(canonical.workoutTitle);
  }

  function onClose(): void {
    if (builderMode) {
      void onBuilderBack();
      return;
    }
    ui.close();
  }

  // --------------------------- keyboard (browse subset) ---------------------------
  function movePickerExpansion(delta: number): void {
    const items = shownWorkoutItems;
    if (!items.length) return;
    let idx = items.findIndex((it) => workoutId(it.canonical) === expandedId);
    if (idx === -1) idx = delta > 0 ? 0 : items.length - 1;
    else idx = (idx + delta + items.length) % items.length;
    expandedId = workoutId(items[idx]!.canonical);
  }

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let zoneSelectEl = $state<HTMLSelectElement | null>(null);
  let durationSelectEl = $state<HTMLSelectElement | null>(null);
  let selectBtnEl = $state<HTMLButtonElement | null>(null);

  // Focus a filter <select> and open its native dropdown if the browser allows
  // it (via el.showPicker()). showPicker() requires a user gesture and can throw
  // / steal focus when called outside one, so it's best-effort and deferred so
  // it never clobbers the focus() we just set.
  function focusAndOpenSelect(el: HTMLSelectElement | null): void {
    if (!el) return;
    el.focus();
    const sp = (el as unknown as { showPicker?: () => void }).showPicker;
    if (typeof sp === 'function') {
      requestAnimationFrame(() => {
        try { sp.call(el); } catch { /* not user-gesture; ignore */ }
      });
    }
  }

  // When a filter <select> is FOCUSED, j/k + ArrowUp/ArrowDown navigate its
  // options (clamped) and apply the new value. A focused native <select>
  // swallows letter keydowns (Chromium typeahead) so they never reach the
  // window-routed handlePickerKey — hence this is bound directly on each
  // <select>'s keydown. We set the bound state directly so Svelte's bind:value
  // stays in sync (no synthetic change needed).
  function onSelectNavKeydown(e: KeyboardEvent, which: 'zone' | 'duration'): void {
    const key = (e.key || '').toLowerCase();
    if (key !== 'j' && key !== 'k' && key !== 'arrowdown' && key !== 'arrowup') return;
    const sel = e.currentTarget as HTMLSelectElement;
    const opts = Array.from(sel.options || []);
    if (!opts.length) return;
    const delta = key === 'k' || key === 'arrowup' ? -1 : 1;
    const cur = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
    const nextIdx = Math.min(Math.max(0, cur + delta), opts.length - 1);
    const nextVal = opts[nextIdx]?.value ?? '';
    if (which === 'zone') zoneValue = nextVal;
    else durationValue = nextVal;
    e.preventDefault();
    e.stopPropagation();
  }

  // The picker keymap. Routed here by the App overlay-key hook while the picker
  // overlay is open (registered below). Returns true if it consumed the key.
  function handlePickerKey(e: KeyboardEvent): boolean {
    if (!open) return false;
    // In builder mode the BuilderView owns the keymap (insert/edit/undo/etc).
    if (builderMode) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const key = (e.key || '').toLowerCase();
    const target = e.target as HTMLElement | null;

    if (key === '/' && searchInputEl) {
      e.preventDefault();
      searchInputEl.focus();
      searchInputEl.select();
      return true;
    }
    if (target === searchInputEl) {
      if (key === 'enter') {
        e.preventDefault();
        searchInputEl?.blur();
        const results = shownWorkoutItems;
        if (results.length) expandedId = workoutId(results[0]!.canonical);
        // Focus the Select button so a second Enter rides the workout.
        requestAnimationFrame(() => selectBtnEl?.focus());
        return true;
      }
      if (key === 'escape') {
        // Escape in the focused search ALWAYS consumes (clear if non-empty +
        // blur) and NEVER falls through to close the picker — even when the
        // search is empty.
        e.preventDefault();
        if (searchTerm) searchTerm = '';
        searchInputEl?.blur();
        return true;
      }
      return false;
    }

    // z / d → focus + open the zone / duration filter. Allow these even when
    // another SELECT is focused (so you can hop between them).
    if (key === 'z') {
      e.preventDefault();
      focusAndOpenSelect(zoneSelectEl);
      return true;
    }
    if (key === 'd') {
      e.preventDefault();
      focusAndOpenSelect(durationSelectEl);
      return true;
    }

    if (isEditableTarget(target)) return false;

    // Schedule mode: Escape/Backspace return to the planner calendar WITHOUT
    // scheduling.
    if (scheduleMode && (key === 'escape' || key === 'backspace')) {
      e.preventDefault();
      onBackToCalendar();
      return true;
    }

    if (key === 'escape') {
      // Not handled here → App closes the overlay.
      return false;
    }

    // e → open the expanded workout in the builder. Disabled in schedule mode
    // (the builder/edit affordances are hidden there).
    if (key === 'e' && !scheduleMode) {
      const expanded = shownWorkoutItems.find((it) => workoutId(it.canonical) === expandedId);
      if (expanded) {
        e.preventDefault();
        onEdit(expanded.canonical);
        return true;
      }
      return false;
    }

    if (key === 'enter') {
      const expanded = shownWorkoutItems.find((it) => workoutId(it.canonical) === expandedId);
      if (expanded) {
        e.preventDefault();
        doSelect(expanded.canonical);
        return true;
      }
      return false;
    }
    if (key === 'arrowdown' || key === 'j') {
      e.preventDefault();
      movePickerExpansion(1);
      return true;
    }
    if (key === 'arrowup' || key === 'k') {
      e.preventDefault();
      movePickerExpansion(-1);
      return true;
    }
    return false;
  }

  // Register the picker keymap with the App overlay-key router whenever the
  // picker overlay is the active one (the App suppresses global hotkeys and
  // routes keys here).
  $effect(() => {
    if (open) {
      ui.registerOverlayKeyHandler('picker', handlePickerKey);
      return () => ui.registerOverlayKeyHandler('picker', null);
    }
    return undefined;
  });

  // Keep the modal-scoped keydown too, so keys typed while focus is inside an
  // input/select (which the window handler also sees) still reach the keymap.
  // The App routes window keydowns; this catches the same event harmlessly
  // (handler is idempotent + guards on `open`). We forward to the same handler.
  function onModalKeydown(e: KeyboardEvent): void {
    // Escape inside the search box ALWAYS consumes here (clear if non-empty +
    // blur) and stops the event reaching the App router, so it never closes the
    // picker — even when the search is empty. handlePickerKey enforces the same
    // for the window-routed path.
    if ((e.key || '').toLowerCase() === 'escape' && e.target === searchInputEl) {
      e.preventDefault();
      e.stopPropagation();
      if (searchTerm) searchTerm = '';
      searchInputEl?.blur();
    }
  }

  // Imperative mini-chart render for the expanded row (SVG built in core/chart).
  // Each mounted chart registers its render closure so a theme change can re-run
  // it (charts read CSS-var colors at draw time). Mirrors PlannerView's
  // registerChart pattern.
  const chartRenderers = new Set<() => void>();
  function miniChart(node: HTMLElement, canonical: CanonicalWorkout) {
    let cw = canonical;
    const render = () => renderMiniWorkoutGraph(node, cw, currentFtp);
    chartRenderers.add(render);
    requestAnimationFrame(render);
    return {
      update(next: CanonicalWorkout) {
        cw = next;
        requestAnimationFrame(render);
      },
      destroy() {
        chartRenderers.delete(render);
      },
    };
  }

  // Re-run every mounted picker mini-chart on an Auto-mode OS light/dark flip
  // (stale-color fix). Uses themeAutoVersion (NOT the full themeVersion): the
  // picker redraws on the matchMedia path ONLY — a manual data-theme toggle does
  // not redraw it.
  $effect(() => {
    void themeAutoVersion();
    for (const render of chartRenderers) render();
  });
</script>

<OverlayModal
  {open}
  overlayId="workoutPickerOverlay"
  overlayClass="workout-picker-overlay picker-mode"
  ariaLabel="Workout library"
  {onClose}
>
  <div
    id="workoutPickerModal"
    class="workout-picker-modal"
    class:workout-picker-modal--builder={builderMode}
    data-testid="picker-modal"
    role="document"
    onkeydown={onModalKeydown}
  >
    <header class="workout-picker-header picker-only">
      <div class="workout-picker-header-actions">
        <button
          id="pickerBackToPlannerBtn"
          class="wb-code-insert-btn picker-back-btn"
          type="button"
          data-testid="picker-back-to-calendar"
          style:display={scheduleMode && !builderMode ? 'inline-flex' : 'none'}
          onclick={onBackToCalendar}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width: 16px; height: 16px; display: block; stroke-width: 1.6;" class="wb-code-icon">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Back to calendar</span>
        </button>
        <button
          id="workoutBuilderBackBtn"
          class="wb-code-insert-btn picker-back-btn"
          type="button"
          data-testid="builder-back"
          style:display={builderMode ? 'inline-flex' : 'none'}
          onclick={() => void onBuilderBack()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width: 16px; height: 16px; display: block; stroke-width: 1.6;" class="wb-code-icon">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Back To Library</span>
        </button>
      </div>

      <div class="workout-picker-header-main">
        <div class="workout-picker-title" id="workoutPickerTitle" data-testid="picker-title">
          {builderMode
            ? builderTitle
            : scheduleMode
              ? scheduleEditMode
                ? 'Edit Schedule'
                : 'Schedule Workout'
              : 'Workout library'}
        </div>
      </div>

      <div class="workout-picker-controls">
        <div
          class="picker-search-wrap"
          class:picker-search-active={!!searchTerm.trim()}
          style:display={builderMode ? 'none' : ''}
        >
          <svg viewBox="0 0 24 24" class="picker-search-icon" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="pickerSearchInput"
            data-testid="picker-search"
            type="search"
            placeholder="eg. tempo 60-90 min"
            bind:this={searchInputEl}
            bind:value={searchTerm}
          />
          <button
            type="button"
            class="picker-search-clear"
            class:visible={!!searchTerm.trim()}
            aria-label="Clear search"
            title="Clear search"
            onclick={() => { searchTerm = ''; searchInputEl?.focus(); }}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2L2 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <select
          id="pickerZoneFilter"
          data-testid="picker-zone-filter"
          class:picker-filter-active={!!zoneValue}
          style:display={builderMode ? 'none' : ''}
          bind:this={zoneSelectEl}
          bind:value={zoneValue}
          onkeydown={(e) => onSelectNavKeydown(e, 'zone')}
        >
          <option value="">All zones</option>
          <option value="Recovery">Recovery</option>
          <option value="Endurance">Endurance</option>
          <option value="Tempo">Tempo</option>
          <option value="Threshold">Threshold</option>
          <option value="VO2Max">VO2Max</option>
          <option value="Anaerobic">Anaerobic</option>
        </select>
        <select
          id="pickerDurationFilter"
          data-testid="picker-duration-filter"
          class:picker-filter-active={!!durationValue}
          style:display={builderMode ? 'none' : ''}
          bind:this={durationSelectEl}
          bind:value={durationValue}
          onkeydown={(e) => onSelectNavKeydown(e, 'duration')}
        >
          <option value="">All durations</option>
          <option value="1-30">1–30 min</option>
          <option value="31-45">31–45 min</option>
          <option value="46-60">46–60 min</option>
          <option value="61-75">61–75 min</option>
          <option value="76-90">76–90 min</option>
          <option value="91-120">91–120 min</option>
          <option value="121-180">121–180 min</option>
          <option value="181-240">181–240 min</option>
          <option value=">240">&gt; 4 hours</option>
        </select>

        <button
          type="button"
          class="picker-toggle-btn"
          class:is-on={showAllFolders}
          data-testid="picker-showall"
          aria-pressed={showAllFolders}
          title="Show every workout from all subfolders in one flat list, instead of browsing folders"
          style:display={builderMode ? 'none' : 'inline-flex'}
          onclick={() => (showAllFolders = !showAllFolders)}
        >
          <svg viewBox="0 0 24 24" class="wb-code-icon" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>Show all</span>
        </button>

        <button
          id="pickerAddWorkoutBtn"
          data-testid="picker-add-workout"
          class="picker-add-btn"
          type="button"
          style:display={builderMode || scheduleMode ? 'none' : 'inline-flex'}
          onclick={onCreateWorkout}
        >
          <svg viewBox="0 0 24 24" class="wb-code-icon" aria-hidden="true">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>Create workout</span>
        </button>

        <!-- Library bulk-import dropdown → each option opens a details modal. -->
        <div class="wb-import" style:display={builderMode || scheduleMode ? 'none' : 'inline-flex'}>
          <button
            class="picker-add-btn picker-import-btn"
            type="button"
            data-testid="picker-import"
            title="Import a collection of workouts"
            aria-haspopup="menu"
            aria-expanded={importLibMenuOpen}
            onclick={() => (importLibMenuOpen = !importLibMenuOpen)}
          >
            <svg viewBox="0 0 24 24" class="wb-code-icon" aria-hidden="true">
              <path d="M12 3v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <span>Import ▾</span>
          </button>
          {#if importLibMenuOpen}
            <button
              class="wb-import-backdrop"
              type="button"
              aria-label="Close import menu"
              onclick={() => (importLibMenuOpen = false)}
            ></button>
            <div class="wb-import-menu" role="menu">
              <button class="wb-import-item" type="button" role="menuitem" data-testid="import-zwift" onclick={() => openImportModal('zwift')}>
                <span>Zwift collection</span><small>the built-in workouts from the original app</small>
              </button>
              <button class="wb-import-item" type="button" role="menuitem" data-testid="import-trainerday" onclick={() => openImportModal('trainerday')}>
                <span>TrainerDay</span><small>the most popular from trainerday.com</small>
              </button>
              <button class="wb-import-item" type="button" role="menuitem" data-testid="import-whatsonzwift" onclick={() => openImportModal('whatsonzwift')}>
                <span>WhatsOnZwift</span><small>the full catalog at whatsonzwift.com</small>
              </button>
            </div>
          {/if}
        </div>

        <button
          id="pickerScheduleUnscheduleBtn"
          class="picker-add-btn delete-workout-btn"
          type="button"
          data-testid="picker-unschedule"
          title="Remove the scheduled workout for this day."
          style:display={scheduleEditMode && !builderMode ? 'inline-flex' : 'none'}
          onclick={() => void onScheduleUnschedule()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M8 16l8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Unschedule</span>
        </button>

        <div
          id="workoutBuilderStatus"
          class="builder-status builder-status--{builderStatusTone}"
          data-tone={builderStatusTone}
          data-testid="builder-status"
          style:display={builderMode ? 'inline-flex' : 'none'}
        >{builderStatusText}</div>

        <input
          bind:this={uploadInputEl}
          type="file"
          accept=".zwo,.fit"
          data-testid="builder-upload-input"
          style="display: none"
          onchange={() => void onUploadFileChange()}
        />

        <!-- All import sources under one menu, instead of a row of buttons. -->
        <div class="wb-import" style:display={builderMode ? 'inline-flex' : 'none'}>
          <button
            id="workoutBuilderImportBtn"
            class="wb-code-insert-btn"
            type="button"
            data-testid="builder-import"
            title="Import workouts"
            aria-haspopup="menu"
            aria-expanded={importMenuOpen}
            onclick={() => (importMenuOpen = !importMenuOpen)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" class="wb-code-icon">
              <path d="M12 3v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <span>Import ▾</span>
          </button>
          {#if importMenuOpen}
            <button
              class="wb-import-backdrop"
              type="button"
              aria-label="Close import menu"
              onclick={() => (importMenuOpen = false)}
            ></button>
            <div class="wb-import-menu" role="menu">
              <button
                class="wb-import-item"
                type="button"
                role="menuitem"
                data-testid="builder-import-url"
                onclick={() => void pickImport('url')}
              >
                <span>From a URL…</span><small>paste a TrainerDay or WhatsOnZwift link</small>
              </button>
              <div class="wb-import-browse">
                New here? Browse
                <button type="button" class="wb-import-link" onclick={() => void openExternal(TRAINERDAY_SEARCH_URL)}>TrainerDay</button>
                or
                <button type="button" class="wb-import-link" onclick={() => void openExternal(WHATSONZWIFT_BROWSE_URL)}>WhatsOnZwift</button>,
                open a workout, copy its URL, then choose “From a URL…”.
              </div>
              <button
                class="wb-import-item"
                type="button"
                role="menuitem"
                data-testid="builder-upload"
                onclick={() => pickImport('upload')}
              >
                <span>Upload a file…</span><small>.zwo or .fit</small>
              </button>
              <div class="wb-import-sep"></div>
              <p class="wb-import-hint">
                Tip: you can also drop <code>.zwo</code> files (in folders too)
                straight into your VeloDrive <strong>workouts</strong> folder — they
                appear here next time you open the library.
              </p>
            </div>
          {/if}
        </div>

        <button
          id="workoutBuilderSaveBtn"
          class="picker-add-btn picker-save-btn"
          type="button"
          title="Save workout to library"
          data-testid="builder-save"
          style:display={builderMode ? 'inline-flex' : 'none'}
          onclick={() => void onBuilderSave()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width: 16px; height: 16px; display: block" class="wb-code-icon">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 3h13l3 3v15H4z" />
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M8 3v6h8V3" />
            <rect x="7" y="15" width="10" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <span>Save</span>
        </button>

        <button
          id="workoutPickerCloseBtn"
          data-testid="picker-close"
          class="picker-close-btn"
          title="Close"
          onclick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>

    <div
      id="workoutBuilderRoot"
      class="workout-builder-root picker-only"
      style:display={builderMode ? 'block' : 'none'}
    >
      {#if builderMode}
        <BuilderView
          getCurrentFtp={() => currentFtp}
          onRequestBack={() => void onBuilderBack()}
          onStatusChange={onBuilderStatusChange}
          onUiStateChange={onBuilderUiStateChange}
          onChange={onBuilderChange}
          bind:api={builderApi}
        />
      {/if}
    </div>

    <div class="workout-picker-table-wrapper picker-only">
      {#if showEmptyState}
        <div id="pickerEmptyState" class="picker-empty-state" style="display: flex">
          <div class="picker-empty-message">No workouts found. Add your first workout.</div>
          <button id="pickerEmptyAddBtn" type="button" class="picker-empty-add-btn" onclick={onCreateWorkout}>
            + Add workout
          </button>
        </div>
      {/if}

      {#if !flatMode && currentFolder}
        <nav class="picker-navbar picker-breadcrumb" aria-label="Folder path">
          <button
            type="button"
            class="picker-crumb picker-crumb-home"
            title="Workouts root"
            aria-label="Workouts root"
            onclick={() => enterFolder('')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 11l8-7 8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          {#each breadcrumbSegments as seg, i}
            <span class="picker-crumb-sep">/</span>
            <button
              type="button"
              class="picker-crumb"
              class:picker-crumb-current={i === breadcrumbSegments.length - 1}
              onclick={() => enterFolder(seg.path)}
            >{seg.name}</button>
          {/each}
        </nav>
      {/if}

      <table class="workout-picker-table">
        <thead>
          <tr>
            <th data-sort-key="name" class={sortClass('name')} title="Workout name" onclick={() => onSort('name')}>Name</th>
            <th title="Primary intensity focus (same colors as workout history)">Zone</th>
            <th title="Where the workout came from (file name, scraper, or source)">Source</th>
            <th data-sort-key="if" class={sortClass('if')} title="Intensity Factor: normalized power divided by FTP; 1.0 means riding steadily at FTP" onclick={() => onSort('if')}>IF</th>
            <th data-sort-key="tss" class={sortClass('tss')} title="Training Stress Score: 100 equals 1 hour at FTP; typical weeks are ~300-700" onclick={() => onSort('tss')}>TSS</th>
            <th data-sort-key="duration" class={sortClass('duration')} title="Planned moving time; paused time is not counted" onclick={() => onSort('duration')}>Duration</th>
            <th data-sort-key="kjAdj" class={sortClass('kjAdj')} title="Estimated work (kJ) at your FTP; roughly equals Calories if power is accurate" onclick={() => onSort('kjAdj')}>kJ</th>
          </tr>
        </thead>
        <tbody id="pickerWorkoutTbody" data-testid="picker-tbody" bind:this={tbodyEl}>
          {#if !flatMode && currentFolder}
            <tr
              class="picker-folder-row picker-folder-up"
              data-testid="picker-folder-up"
              onclick={() => enterFolder(folderParent(currentFolder))}
            >
              <td colspan="7">
                <span class="picker-folder-cell">
                  <svg viewBox="0 0 24 24" class="picker-folder-icon" aria-hidden="true">
                    <path d="M5 12l7-7 7 7M12 5v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <span class="picker-folder-name">..</span>
                </span>
              </td>
            </tr>
          {/if}
          {#each navEntries as entry (navEntryKey(entry))}
            {#if entry.kind === 'folder'}
              <tr
                class="picker-folder-row"
                data-testid="picker-folder"
                onclick={() => enterFolder(entry.path)}
              >
                <td colspan="7">
                  <span class="picker-folder-cell">
                    <svg viewBox="0 0 24 24" class="picker-folder-icon" aria-hidden="true">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                    </svg>
                    <span class="picker-folder-name">{entry.name}</span>
                    <span class="picker-folder-count">{entry.count}</span>
                    <svg viewBox="0 0 24 24" class="picker-folder-chevron" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                </td>
              </tr>
            {:else}
              {@const item = entry.item}
              {@const id = workoutId(item.canonical)}
              {@const title = item.canonical.workoutTitle}
              {@const displayName = entry.label}
              {@const zone = item.zone}
              {@const m = item.metrics}
              {#if expandedId !== id}
              <tr class="picker-row" data-title={title} onclick={() => toggleExpand(id)}>
                <td title={displayName}>{displayName}</td>
                <td>
                  <div class="picker-zone-cell">
                    <span class="picker-zone-dot {zoneDotClass(zone)}"></span>
                    <span>{zone || 'Uncategorized'}</span>
                  </div>
                </td>
                <td>{item.canonical.source || ''}</td>
                <td>{ifText(m)}</td>
                <td>{tssText(m)}</td>
                <td>{formatPickerDuration(m)}</td>
                <td>{kjText(m)}</td>
              </tr>
            {:else}
              <tr class="picker-expanded-row" data-title={title}>
                <td colspan="7">
                  <div class="picker-expanded picker-expanded-layout">
                    <div
                      class="picker-expanded-collapse-hit"
                      title="Collapse details"
                      onclick={(e) => { e.stopPropagation(); expandedId = null; }}
                      role="button"
                      tabindex="-1"
                      onkeydown={() => {}}
                    ></div>

                    <div class="picker-expanded-header">
                      <div class="picker-expanded-title">{displayName}</div>
                      <div class="picker-expanded-actions">
                        {#if !scheduleMode}
                        {#if item.canonical.sourceURL}
                          <button
                            type="button"
                            class="wb-code-insert-btn visit-website-btn"
                            title="Open the workout's website in a new tab."
                            onclick={(e) => { e.stopPropagation(); void openExternal(item.canonical.sourceURL); }}
                          >
                            <svg viewBox="0 0 24 24" class="wb-code-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M18 3h3v3" /><path d="M21 3l-9 9" />
                              <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            </svg>
                            <span>Visit website</span>
                          </button>
                        {/if}
                        <button
                          type="button"
                          class="wb-code-insert-btn delete-workout-btn"
                          data-testid="picker-delete"
                          title="Delete this workout file from your library."
                          onclick={(e) => { e.stopPropagation(); void onDelete(item.canonical); }}
                        >
                          <svg viewBox="0 0 24 24" class="wb-code-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6" /><path d="M14 11v6" />
                          </svg>
                          <span>Delete</span>
                        </button>
                        <button
                          type="button"
                          class="wb-code-insert-btn clone-workout-btn"
                          data-testid="picker-clone"
                          title="Clone this workout."
                          onclick={(e) => { e.stopPropagation(); void onClone(item.canonical); }}
                        >
                          <svg viewBox="0 0 24 24" class="wb-code-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="8" y="7" width="10" height="10" rx="2" /><rect x="5" y="4" width="10" height="10" rx="2" />
                          </svg>
                          <span>Clone</span>
                        </button>
                        <button
                          type="button"
                          class="wb-code-insert-btn edit-workout-btn"
                          data-testid="picker-edit"
                          title="Open this workout in the builder."
                          onclick={(e) => { e.stopPropagation(); onEdit(item.canonical); }}
                        >
                          <svg viewBox="0 0 24 24" class="wb-code-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5l4 4-11 11H5.5v-4.5l11-11z" />
                          </svg>
                          <span>Edit</span>
                        </button>
                        {/if}
                        <button
                          type="button"
                          class="select-workout-btn"
                          data-testid="picker-select"
                          title={scheduleMode ? 'Schedule this workout on the selected day.' : 'Use this workout on the workout page.'}
                          bind:this={selectBtnEl}
                          onclick={(e) => { e.stopPropagation(); doSelect(item.canonical); }}
                        >
                          {scheduleMode ? 'Schedule Workout' : 'Select workout'}
                        </button>
                      </div>
                    </div>

                    <div class="picker-expanded-main">
                      <div class="picker-expanded-main-left">
                        <div class="wb-stats-row">
                          <div class="wb-stat-chip" title="">
                            <div class="wb-stat-label">Zone</div>
                            <div class="wb-stat-value">
                              <span class="picker-zone-dot {zoneDotClass(zone)}" style="margin-right: 8px"></span>{zone || 'Uncategorized'}
                            </div>
                          </div>
                          {#if item.canonical.source}
                            <div class="wb-stat-chip">
                              <div class="wb-stat-label">Source</div>
                              <div class="wb-stat-value">{item.canonical.source}</div>
                            </div>
                          {/if}
                          {#if m.ifValue != null}
                            <div class="wb-stat-chip" title="Intensity Factor: normalized power divided by FTP; 1.0 means riding steadily at FTP.">
                              <div class="wb-stat-label">IF</div>
                              <div class="wb-stat-value">{m.ifValue.toFixed(2)}</div>
                            </div>
                          {/if}
                          {#if m.tss != null}
                            <div class="wb-stat-chip" title="Training Stress Score: 100 equals 1 hour at FTP; typical weekly totals: ~300–500 for maintenance, 500–700 for building, 700+ for heavy training.">
                              <div class="wb-stat-label">TSS</div>
                              <div class="wb-stat-value">{Math.round(m.tss)}</div>
                            </div>
                          {/if}
                          {#if m.durationMin != null || m.totalSec != null}
                            <div class="wb-stat-chip">
                              <div class="wb-stat-label">Duration</div>
                              <div class="wb-stat-value">{formatPickerDuration(m)}</div>
                            </div>
                          {/if}
                          {#if m.kj != null}
                            <div class="wb-stat-chip" title="Estimated work (kJ) at your configured FTP; roughly equals Calories if power is accurate.">
                              <div class="wb-stat-label">kJ</div>
                              <div class="wb-stat-value">{Math.round(m.kj)}</div>
                            </div>
                          {/if}
                        </div>
                      </div>
                      {#if item.canonical.description && item.canonical.description.trim()}
                        <div class="picker-expanded-main-right" style="font-size: var(--font-size-base); line-height: 1.6">
                          {@html item.canonical.description.replace(/\n/g, '<br>')}
                        </div>
                      {:else}
                        <div class="picker-expanded-main-right picker-detail-empty" style="font-size: var(--font-size-base); line-height: 1.6">(No description)</div>
                      {/if}
                    </div>

                    <div class="picker-expanded-chart">
                      <div class="picker-graph" data-testid="picker-mini-chart" use:miniChart={item.canonical}></div>
                    </div>
                  </div>
                </td>
              </tr>
              {/if}
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <div class="picker-footer picker-only picker-footer-library">
      <span>
        <strong>j k</strong> or <strong>↑ ↓</strong> to move &bull;
        <strong>Enter</strong> to select workout &bull;
        <strong>/</strong> to search
      </span>
      <span id="pickerSummary" class="workout-picker-summary" data-testid="picker-summary">{summaryText}</span>
    </div>

    <div id="builderFooter" class="picker-footer picker-only picker-footer-builder">
      {#if builderHasSelection}
        <span id="builderShortcuts">
          <strong>h l</strong> <strong>← →</strong> adjust duration &bull;
          <strong>(Shift)</strong> <strong>j k</strong> <strong>↓ ↑</strong> adjust power &bull;
          <strong>Shift+Click</strong> or <strong>Shift+H/L/←/→</strong> multi-select &bull;
          <strong>Enter</strong> deselect &bull;
          <strong>Space</strong> switch side
        </span>
      {:else}
        <span id="builderShortcuts">
          <strong>h l</strong> <strong>← →</strong> to move &bull;
          <strong>Enter</strong> to select &bull;
          <strong>Backspace</strong> delete &bull;
          <strong>R E T S V A W C I X</strong> insert block
        </span>
      {/if}
    </div>
  </div>

  {#if importModal}
    <div class="import-modal-overlay" role="dialog" aria-modal="true" data-testid="import-modal">
      <div class="import-modal">
        {#if importModal === 'zwift'}
          <h2 class="import-modal-title">Import the Zwift collection</h2>
          <p>
            Download the original Zwift workout collection — 1,300+ <code>.zwo</code>
            workouts organized by training plan — into a <strong>Zwift</strong> folder
            in your library.
          </p>
          <p class="import-modal-note">
            From the Zwift forums’ October 2023 workout refresh.
            <button type="button" class="wb-import-link" onclick={() => void openExternal(ZWIFT_FORUM_URL)}>
              Learn more on the forum →
            </button>
          </p>
        {:else if importModal === 'trainerday'}
          <h2 class="import-modal-title">Import from TrainerDay</h2>
          <p>
            Download the most popular workouts from TrainerDay into a
            <strong>TrainerDay</strong> folder, ordered by popularity.
          </p>
          <label class="import-modal-field">
            <span>How many workouts?</span>
            <input
              type="number"
              min="1"
              max="40000"
              data-testid="trainerday-limit"
              bind:value={trainerdayLimit}
              disabled={importBusy}
            />
          </label>
          <p class="import-modal-note">
            TrainerDay has 40,000+ workouts.
            <button type="button" class="wb-import-link" onclick={() => void openExternal(TRAINERDAY_SEARCH_URL)}>
              Browse TrainerDay →
            </button>
          </p>
        {:else}
          <h2 class="import-modal-title">Import from WhatsOnZwift</h2>
          <p>
            Download <strong>every</strong> workout on WhatsOnZwift (~3,000),
            organized into folders by collection under a <strong>WhatsOnZwift</strong>
            folder.
          </p>
          <p class="import-modal-note">
            Only works in the desktop app.
            <button type="button" class="wb-import-link" onclick={() => void openExternal(WHATSONZWIFT_BROWSE_URL)}>
              Browse WhatsOnZwift →
            </button>
          </p>
        {/if}

        {#if importBusy}
          <div class="import-modal-progress" data-testid="import-progress">
            {importProgress || 'Working…'}
          </div>
        {/if}

        <div class="import-modal-actions">
          <button
            type="button"
            class="wb-code-insert-btn picker-back-btn"
            disabled={importBusy}
            onclick={() => (importModal = null)}
          >Cancel</button>
          <button
            type="button"
            class="picker-add-btn"
            data-testid="import-modal-start"
            disabled={importBusy}
            onclick={() => void onImportModalStart()}
          >{importBusy ? 'Importing…' : 'Import'}</button>
        </div>
      </div>
    </div>
  {/if}
</OverlayModal>
