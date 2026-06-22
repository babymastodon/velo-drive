<script lang="ts">
  // Compact workout switcher shown in the middle of the bottom bar when idle.
  // Zone + duration drop-UPs filter the library; the ‹ › carets step to the
  // prev/next matching workout ranked by kJ (right = higher kJ). Selecting loads
  // the workout immediately.
  import type { EngineViewModel, WorkoutEngine } from '../core/engine.js';
  import type { WebFileStore } from '../ports/web/WebFileStore.js';
  import type { CanonicalWorkout } from '../core/model.js';
  import {
    DEFAULT_FTP,
    getDurationBucket,
    DURATION_BUCKETS,
    inferZoneFromSegments,
    computeMetricsFromSegments,
  } from '../core/metrics.js';
  import { prepareLibraryItems, type LibraryItem } from '../core/library-items.js';

  let {
    vm,
    engine,
    fileStore,
    activeOverlay = 'none',
  }: {
    vm: EngineViewModel;
    engine: WorkoutEngine;
    fileStore: WebFileStore;
    activeOverlay?: string;
  } = $props();

  const ZONES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2Max', 'Anaerobic'];
  function zoneDotClass(zone: string): string {
    const z = (zone || '').toLowerCase();
    if (z.startsWith('recovery')) return 'picker-zone-dot-recovery';
    if (z.startsWith('endurance')) return 'picker-zone-dot-endurance';
    if (z.startsWith('tempo')) return 'picker-zone-dot-tempo';
    if (z.startsWith('threshold')) return 'picker-zone-dot-threshold';
    if (z.startsWith('vo2')) return 'picker-zone-dot-vo2';
    if (z.startsWith('anaerobic')) return 'picker-zone-dot-anaerobic';
    return 'picker-zone-dot-unknown';
  }

  function bucketLabel(value: string): string {
    return DURATION_BUCKETS.find((b) => b.value === value)?.label ?? value;
  }

  // Fresh-install default combo (no loaded workout, no persisted memory yet).
  const DEFAULT_ZONE = 'Tempo';
  const DEFAULT_DURATION = '46-60';

  const ftp = $derived(vm?.currentFtp || DEFAULT_FTP);
  const current = $derived(vm?.canonicalWorkout ?? null);
  function workoutKey(cw: CanonicalWorkout | null): string {
    return cw ? (cw.sourcePath ?? cw.workoutTitle) : '';
  }
  function comboKey(zone: string, dur: string): string {
    return `${zone}|${dur}`;
  }

  // The preloaded library → items with zone + metrics (memoized + boot-warmed, so
  // this is a cache hit). Re-fetch when ftp / the loaded workout changes.
  let library = $state<LibraryItem[]>([]);
  $effect(() => {
    const f = ftp;
    void current;
    void fileStore.getWorkouts().then((w) => {
      library = prepareLibraryItems(w, f);
    });
  });

  // Per-combo memory: the workout last loaded for each (zone, duration), persisted
  // so switching back to a combo restores its workout.
  let comboMap = $state<Record<string, string>>({});
  let comboLoaded = false;
  $effect(() => {
    if (comboLoaded) return;
    comboLoaded = true;
    void fileStore
      .getSetting<Record<string, string>>('quickComboWorkouts', {})
      .then((m) => (comboMap = m || {}));
  });
  function rememberCombo(zone: string, dur: string, key: string): void {
    comboMap[comboKey(zone, dur)] = key;
    void fileStore.putSetting('quickComboWorkouts', { ...comboMap }).catch(() => {});
  }

  // Zone + duration (both always specific on the main page), synced to the loaded
  // workout when it changes.
  let selZone = $state('');
  let selDuration = $state('');
  let lastSyncedKey = '';
  $effect(() => {
    const cw = current;
    const key = workoutKey(cw);
    if (cw && key && key !== lastSyncedKey) {
      // Match the loaded workout (computed straight from its cached segments so the
      // controls populate immediately — no wait for the library scan) and remember
      // it for the combo. Duration is FTP-independent, so a default FTP is exact.
      selZone = inferZoneFromSegments(cw.rawSegments) || 'Uncategorized';
      selDuration = getDurationBucket(computeMetricsFromSegments(cw.rawSegments, ftp).durationMin);
      lastSyncedKey = key;
      rememberCombo(selZone, selDuration, key);
    } else if (!cw && !selZone) {
      // Fresh install / nothing loaded → start at the default combo.
      selZone = DEFAULT_ZONE;
      selDuration = DEFAULT_DURATION;
    }
  });

  function candidatesFor(zone: string, dur: string): LibraryItem[] {
    return library
      .filter((it) => it.zone === zone && getDurationBucket(it.metrics.durationMin) === dur)
      .slice()
      .sort((a, b) => (a.metrics.kj ?? 0) - (b.metrics.kj ?? 0));
  }
  const candidates = $derived(candidatesFor(selZone, selDuration));

  function load(it: LibraryItem): void {
    rememberCombo(selZone, selDuration, workoutKey(it.canonical));
    void fileStore.putSetting('selectedWorkout', it.canonical).catch(() => {});
    engine.setWorkoutFromPicker(it.canonical);
  }

  // Switching combo loads its workout: the one last used (persisted), else the
  // middle-ranked (by kJ) eligible workout.
  function loadForCombo(): void {
    const cands = candidatesFor(selZone, selDuration);
    if (!cands.length) return;
    const savedKey = comboMap[comboKey(selZone, selDuration)];
    const saved = savedKey ? cands.find((c) => workoutKey(c.canonical) === savedKey) : undefined;
    load(saved ?? cands[Math.floor(cands.length / 2)]!);
  }

  function pickZone(z: string): void {
    zoneOpen = false;
    selZone = z;
    loadForCombo();
  }
  function pickDuration(d: string): void {
    durOpen = false;
    selDuration = d;
    loadForCombo();
  }

  function step(dir: 1 | -1): void {
    const cands = candidatesFor(selZone, selDuration);
    if (!cands.length) return;
    const key = workoutKey(current);
    let idx = cands.findIndex((it) => workoutKey(it.canonical) === key);
    if (idx < 0) idx = dir > 0 ? -1 : cands.length; // start just past an end
    load(cands[(idx + dir + cands.length) % cands.length]!);
  }

  let zoneOpen = $state(false);
  let durOpen = $state(false);

  // ←/→ step to the prev/next workout while the selector is showing (idle, no
  // overlay open, not typing). The component only mounts when no workout is
  // running, so this is inert during a ride.
  $effect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (activeOverlay !== 'none') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="quick-selector" data-testid="quick-selector">
  <button
    class="nav-icon-button"
    type="button"
    data-testid="quick-prev"
    title="Previous workout"
    aria-label="Previous workout"
    disabled={!candidates.length}
    onclick={() => step(-1)}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  </button>

  <div class="quick-drop">
    <button
      class="inline-clicktoggle"
      type="button"
      data-testid="quick-zone"
      title="Zone"
      aria-haspopup="menu"
      aria-expanded={zoneOpen}
      onclick={() => {
        zoneOpen = !zoneOpen;
        durOpen = false;
      }}
    >
      <span class="picker-zone-dot {zoneDotClass(selZone)}"></span>
      <span>{selZone || 'Zone'}</span>
    </button>
    {#if zoneOpen}
      <button class="quick-backdrop" type="button" aria-label="Close" onclick={() => (zoneOpen = false)}></button>
      <div class="quick-menu" role="menu">
        {#each ZONES as z}
          <button class="quick-item" type="button" onclick={() => pickZone(z)}>
            <span class="picker-zone-dot {zoneDotClass(z)}"></span><span>{z}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="quick-drop">
    <button
      class="inline-clicktoggle"
      type="button"
      data-testid="quick-duration"
      title="Duration"
      aria-haspopup="menu"
      aria-expanded={durOpen}
      onclick={() => {
        durOpen = !durOpen;
        zoneOpen = false;
      }}
    >
      <span>{selDuration ? bucketLabel(selDuration) : 'Duration'}</span>
    </button>
    {#if durOpen}
      <button class="quick-backdrop" type="button" aria-label="Close" onclick={() => (durOpen = false)}></button>
      <div class="quick-menu quick-menu-scroll" role="menu">
        {#each DURATION_BUCKETS as b}
          <button class="quick-item" type="button" onclick={() => pickDuration(b.value)}>{b.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <button
    class="nav-icon-button"
    type="button"
    data-testid="quick-next"
    title="Next workout"
    aria-label="Next workout"
    disabled={!candidates.length}
    onclick={() => step(1)}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  </button>
</div>

<style>
  .quick-selector {
    display: inline-flex;
    align-items: stretch;
    gap: 6px;
    height: var(--nav-control-height);
    /* The bottom-bar title wrapper sets pointer-events:none — re-enable here so
       the carets/drop-ups (and their menus) are clickable. */
    pointer-events: auto;
  }
  /* Carets reuse .nav-icon-button (the settings/planner icon style) and the
     drop-ups reuse .inline-clicktoggle (the workout-name button style) verbatim
     — only the disabled affordance is added here. */
  .quick-selector :global(button:disabled) {
    opacity: 0.35;
    cursor: default;
  }
  .quick-drop {
    position: relative;
    display: inline-flex;
  }
  .quick-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  .quick-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 41;
    min-width: 100%;
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 1px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
  }
  .quick-menu-scroll {
    max-height: 50vh;
    overflow-y: auto;
  }
  .quick-item {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    white-space: nowrap;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-main);
    font: inherit;
    cursor: pointer;
  }
  .quick-item:hover,
  .quick-item:focus-visible {
    background: var(--surface-muted);
    outline: none;
  }
</style>
