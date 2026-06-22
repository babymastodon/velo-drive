<script lang="ts">
  // Compact workout switcher shown in the middle of the bottom bar when idle.
  // Zone + duration drop-UPs filter the library; the ‹ › carets step to the
  // prev/next matching workout ranked by kJ (right = higher kJ). Selecting loads
  // the workout immediately.
  import type { EngineViewModel, WorkoutEngine } from '../core/engine.js';
  import type { WebFileStore } from '../ports/web/WebFileStore.js';
  import type { CanonicalWorkout } from '../core/model.js';
  import { DEFAULT_FTP, getDurationBucket, DURATION_BUCKETS } from '../core/metrics.js';
  import { prepareLibraryItems, type LibraryItem } from '../core/library-items.js';

  let {
    vm,
    engine,
    fileStore,
  }: {
    vm: EngineViewModel;
    engine: WorkoutEngine;
    fileStore: WebFileStore;
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

  const ftp = $derived(vm?.currentFtp || DEFAULT_FTP);
  const current = $derived(vm?.canonicalWorkout ?? null);
  function workoutKey(cw: CanonicalWorkout | null): string {
    return cw ? (cw.sourcePath ?? cw.workoutTitle) : '';
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

  // Zone (always a specific zone on the main page) + duration filters, synced to
  // the loaded workout when it changes (a manual change persists until then).
  let selZone = $state('');
  let selDuration = $state('');
  let lastSyncedKey = '';
  $effect(() => {
    const cw = current;
    const key = workoutKey(cw);
    if (cw && key && key !== lastSyncedKey) {
      lastSyncedKey = key;
      const item = library.find((it) => workoutKey(it.canonical) === key);
      if (item) {
        selZone = item.zone;
        selDuration = getDurationBucket(item.metrics.durationMin);
      }
    } else if (!selZone && library.length) {
      // No loaded workout yet — default to the first library item's zone so the
      // zone (and its color swatch) is always populated.
      selZone = library[0]!.zone;
      selDuration = getDurationBucket(library[0]!.metrics.durationMin);
    }
  });

  // Candidates: matching zone + duration, ranked by kJ ascending.
  const candidates = $derived(
    library
      .filter(
        (it) =>
          (!selZone || it.zone === selZone) &&
          (!selDuration || getDurationBucket(it.metrics.durationMin) === selDuration),
      )
      .slice()
      .sort((a, b) => (a.metrics.kj ?? 0) - (b.metrics.kj ?? 0)),
  );

  function load(it: LibraryItem): void {
    void fileStore.putSetting('selectedWorkout', it.canonical).catch(() => {});
    engine.setWorkoutFromPicker(it.canonical);
  }

  function step(dir: 1 | -1): void {
    if (!candidates.length) return;
    const key = workoutKey(current);
    let idx = candidates.findIndex((it) => workoutKey(it.canonical) === key);
    if (idx < 0) idx = dir > 0 ? -1 : candidates.length; // start just past an end
    load(candidates[(idx + dir + candidates.length) % candidates.length]!);
  }

  let zoneOpen = $state(false);
  let durOpen = $state(false);
</script>

<div class="quick-selector" data-testid="quick-selector">
  <button
    class="inline-clicktoggle quick-caret"
    type="button"
    data-testid="quick-prev"
    title="Previous workout (lower kJ)"
    aria-label="Previous workout"
    disabled={!candidates.length}
    onclick={() => step(-1)}
  >‹</button>

  <div class="quick-drop">
    <button
      class="inline-clicktoggle"
      type="button"
      data-testid="quick-zone"
      title="Filter by training zone"
      aria-haspopup="menu"
      aria-expanded={zoneOpen}
      onclick={() => {
        zoneOpen = !zoneOpen;
        durOpen = false;
      }}
    >
      <span class="picker-zone-dot {zoneDotClass(selZone)}"></span>
      <span>{selZone || 'Zone'}</span>
      <span class="quick-chevron">▴</span>
    </button>
    {#if zoneOpen}
      <button class="quick-backdrop" type="button" aria-label="Close" onclick={() => (zoneOpen = false)}></button>
      <div class="quick-menu" role="menu">
        {#each ZONES as z}
          <button class="quick-item" type="button" onclick={() => { selZone = z; zoneOpen = false; }}>
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
      title="Filter by duration"
      aria-haspopup="menu"
      aria-expanded={durOpen}
      onclick={() => {
        durOpen = !durOpen;
        zoneOpen = false;
      }}
    >
      <span>{selDuration ? bucketLabel(selDuration) : 'Any duration'}</span>
      <span class="quick-chevron">▴</span>
    </button>
    {#if durOpen}
      <button class="quick-backdrop" type="button" aria-label="Close" onclick={() => (durOpen = false)}></button>
      <div class="quick-menu quick-menu-scroll" role="menu">
        <button class="quick-item" type="button" onclick={() => { selDuration = ''; durOpen = false; }}>Any duration</button>
        {#each DURATION_BUCKETS as b}
          <button class="quick-item" type="button" onclick={() => { selDuration = b.value; durOpen = false; }}>{b.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <button
    class="inline-clicktoggle quick-caret"
    type="button"
    data-testid="quick-next"
    title="Next workout (higher kJ)"
    aria-label="Next workout"
    disabled={!candidates.length}
    onclick={() => step(1)}
  >›</button>
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
  /* Carets + drop-up buttons reuse the global .inline-clicktoggle (borderless,
     transparent, same hover/active as the rest of the bottom bar). These only
     add the caret glyph size + the disabled state. */
  .quick-caret {
    font-size: 1.2rem;
    line-height: 1;
  }
  .quick-caret:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .quick-drop {
    position: relative;
    display: inline-flex;
  }
  .quick-chevron {
    font-size: 0.7em;
    color: var(--text-muted);
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
