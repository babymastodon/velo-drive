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
  import { isFreeRideSegment } from '../core/segments.js';

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

  // "Freeride" is a synthetic zone (above Recovery) holding the 100%-free-ride
  // workouts; every other zone excludes them.
  const FREERIDE_ZONE = 'Freeride';
  const ZONES = [FREERIDE_ZONE, 'Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2Max', 'Anaerobic'];
  function allFreeRide(segs: CanonicalWorkout['rawSegments']): boolean {
    return segs.length > 0 && segs.every((s) => isFreeRideSegment(s));
  }
  function zoneDotClass(zone: string): string {
    const z = (zone || '').toLowerCase();
    if (z.startsWith('freeride')) return 'picker-zone-dot-freeride';
    if (z.startsWith('recovery')) return 'picker-zone-dot-recovery';
    if (z.startsWith('endurance')) return 'picker-zone-dot-endurance';
    if (z.startsWith('tempo')) return 'picker-zone-dot-tempo';
    if (z.startsWith('threshold')) return 'picker-zone-dot-threshold';
    if (z.startsWith('vo2')) return 'picker-zone-dot-vo2';
    if (z.startsWith('anaerobic')) return 'picker-zone-dot-anaerobic';
    return 'picker-zone-dot-unknown';
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
      const mins = computeMetricsFromSegments(cw.rawSegments, ftp).durationMin;
      if (allFreeRide(cw.rawSegments)) {
        // Freeride is keyed by exact length, not a bucket.
        selZone = FREERIDE_ZONE;
        selDuration = String(Math.round(mins));
      } else {
        selZone = inferZoneFromSegments(cw.rawSegments) || 'Uncategorized';
        selDuration = getDurationBucket(mins);
      }
      lastSyncedKey = key;
      rememberCombo(selZone, selDuration, key);
    } else if (!cw && !selZone) {
      // Fresh install / nothing loaded → start at the default combo.
      selZone = DEFAULT_ZONE;
      selDuration = DEFAULT_DURATION;
    }
  });

  const isAllFreeRide = (it: LibraryItem): boolean => allFreeRide(it.canonical.rawSegments);
  const exactMin = (it: LibraryItem): number => Math.round(it.metrics.durationMin);

  // Free-ride workouts deduped by their ACTUAL duration (one per exact length),
  // ascending — keyed by that length in minutes.
  function freerideOptions(): { item: LibraryItem; value: string; label: string }[] {
    const seen = new Set<string>();
    const out: { item: LibraryItem; value: string; label: string }[] = [];
    for (const it of library
      .filter(isAllFreeRide)
      .slice()
      .sort((a, b) => a.metrics.durationMin - b.metrics.durationMin)) {
      const value = String(exactMin(it));
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ item: it, value, label: `${value} min` });
    }
    return out;
  }

  function candidatesFor(zone: string, dur: string): LibraryItem[] {
    if (zone === FREERIDE_ZONE) {
      const o = freerideOptions().find((x) => x.value === dur);
      return o ? [o.item] : [];
    }
    return library
      .filter(
        (it) =>
          it.zone === zone &&
          getDurationBucket(it.metrics.durationMin) === dur &&
          !isAllFreeRide(it),
      )
      .slice()
      .sort((a, b) => (a.metrics.kj ?? 0) - (b.metrics.kj ?? 0));
  }
  const candidates = $derived(candidatesFor(selZone, selDuration));

  // Duration drop options: Freeride lists each actual free-ride length; every other
  // zone lists the standard buckets.
  function durationOptionsFor(zone: string): { value: string; label: string }[] {
    return zone === FREERIDE_ZONE
      ? freerideOptions().map((o) => ({ value: o.value, label: o.label }))
      : DURATION_BUCKETS.map((b) => ({ value: b.value, label: b.label }));
  }
  const durationOptions = $derived(durationOptionsFor(selZone));
  function durationLabel(value: string): string {
    return durationOptions.find((o) => o.value === value)?.label ?? value;
  }

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
    // Keep the duration valid for the new zone (Freeride lists exact lengths).
    const avail = durationOptionsFor(z);
    if (avail.length && !avail.some((b) => b.value === selDuration)) selDuration = avail[0]!.value;
    loadForCombo();
  }
  function pickDuration(d: string): void {
    durOpen = false;
    selDuration = d;
    loadForCombo();
  }

  function step(dir: 1 | -1): void {
    // Freeride has one workout per duration, so the carets step through durations.
    if (selZone === FREERIDE_ZONE) {
      const opts = durationOptionsFor(FREERIDE_ZONE);
      if (!opts.length) return;
      let i = opts.findIndex((b) => b.value === selDuration);
      if (i < 0) i = dir > 0 ? -1 : opts.length;
      selDuration = opts[(i + dir + opts.length) % opts.length]!.value;
      loadForCombo();
      return;
    }
    const cands = candidatesFor(selZone, selDuration);
    if (!cands.length) return;
    const key = workoutKey(current);
    let idx = cands.findIndex((it) => workoutKey(it.canonical) === key);
    if (idx < 0) idx = dir > 0 ? -1 : cands.length; // start just past an end
    load(cands[(idx + dir + cands.length) % cands.length]!);
  }

  let zoneOpen = $state(false);
  let durOpen = $state(false);
  let zoneDropEl = $state<HTMLElement | null>(null);
  let durDropEl = $state<HTMLElement | null>(null);

  // Close an open drop-up when clicking anywhere outside it (a document-level
  // listener is more reliable here than an overlay, since the bottom bar sits in
  // its own stacking context).
  $effect(() => {
    if (!zoneOpen && !durOpen) return;
    function onDown(e: Event): void {
      const t = e.target as Node;
      if (zoneOpen && zoneDropEl && !zoneDropEl.contains(t)) zoneOpen = false;
      if (durOpen && durDropEl && !durDropEl.contains(t)) durOpen = false;
    }
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  // ←/→ step to the prev/next workout while the selector is showing (idle, no
  // overlay open, not typing); Esc closes an open drop-up. The component only
  // mounts when no workout is running, so this is inert during a ride.
  $effect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (zoneOpen || durOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          zoneOpen = false;
          durOpen = false;
        }
        return;
      }
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
    title="Previous workout (←)"
    aria-label="Previous workout"
    disabled={!candidates.length}
    onclick={() => step(-1)}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  </button>

  <div class="quick-drop" bind:this={zoneDropEl}>
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
      <div class="quick-menu" role="menu">
        {#each ZONES as z}
          <button class="quick-item" type="button" onclick={() => pickZone(z)}>
            <span class="picker-zone-dot {zoneDotClass(z)}"></span><span>{z}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="quick-drop" bind:this={durDropEl}>
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
      <span>{selDuration ? durationLabel(selDuration) : 'Duration'}</span>
    </button>
    {#if durOpen}
      <div class="quick-menu quick-menu-scroll" role="menu">
        {#each durationOptions as b}
          <button class="quick-item" type="button" onclick={() => pickDuration(b.value)}>{b.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <button
    class="nav-icon-button"
    type="button"
    data-testid="quick-next"
    title="Next workout (→)"
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
    /* Same hover shade as the bottom-nav buttons (rgba .06 light / .1 dark). */
    background: var(--hover-strong);
    outline: none;
  }
</style>
