<script lang="ts">
  // PickerView — faithful re-host of the legacy #workoutPickerOverlay /
  // #workoutPickerModal (docs/index.html ~347-700 + docs/workout-picker.js browse
  // logic). Same classes + IDs so the re-hosted workout-picker.css applies
  // unchanged; data-testids added for behavior assertions. Implements browse /
  // list / search (grammar 30-45 / <40 / >60 / 45) / zone+duration filters /
  // sort / expand (stats + mini chart) / select-to-ride / delete (->trash) /
  // clone. The in-picker workout BUILDER is DEFERRED: the "Create workout" / Edit
  // buttons are rendered but no-op (see onCreateWorkout / onEdit).
  import OverlayModal from './OverlayModal.svelte';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { WebFileStore } from '../ports/web/WebFileStore.js';
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
  import { DEFAULT_FTP } from '../core/metrics.js';

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
  let expandedTitle = $state<string | null>(null);

  // Rescan the library whenever the picker is opened.
  $effect(() => {
    if (open) {
      expandedTitle = null;
      void rescan();
    }
  });

  async function rescan(): Promise<void> {
    workouts = await fileStore.listWorkouts();
  }

  function getZone(cw: CanonicalWorkout): string {
    return inferZoneFromSegments(cw.rawSegments) || 'Uncategorized';
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
      const rawTokens = term
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      let rangeMin: number | null = null;
      let rangeMax: number | null = null;
      const tokens: string[] = [];
      rawTokens.forEach((tok) => {
        const compactRange = tok.match(/^(\d+)\s*[-–]\s*(\d+)\s*(m|min)?$/i);
        if (compactRange) {
          rangeMin = Number(compactRange[1]);
          rangeMax = Number(compactRange[2]);
          return;
        }
        const lt = tok.match(/^<\s*(\d+)/);
        const gt = tok.match(/^>\s*(\d+)/);
        if (lt) {
          rangeMax = Number(lt[1]);
          return;
        }
        if (gt) {
          rangeMin = Number(gt[1]);
          return;
        }
        const approx = tok.match(/^(\d+)\s*(m|min)?$/i);
        if (approx) {
          const val = Number(approx[1]);
          if (Number.isFinite(val)) {
            rangeMin = rangeMin == null ? val - 5 : rangeMin;
            rangeMax = rangeMax == null ? val + 5 : rangeMax;
            return;
          }
        }
        tokens.push(tok);
      });
      if (rangeMin != null && rangeMax != null && rangeMin > rangeMax) {
        const tmp = rangeMin;
        rangeMin = rangeMax;
        rangeMax = tmp;
      }
      items = items.filter((it) => {
        const haystack = [it.canonical.workoutTitle, it.zone, it.canonical.source || '']
          .join(' ')
          .toLowerCase();
        const tokensMatch = tokens.every((t) => haystack.includes(t));
        if (!tokensMatch) return false;
        if (rangeMin != null || rangeMax != null) {
          const dur = it.metrics.durationMin;
          if (rangeMin != null && !(dur >= rangeMin)) return false;
          if (rangeMax != null && !(dur <= rangeMax)) return false;
        }
        return true;
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

  function toggleExpand(title: string): void {
    expandedTitle = expandedTitle === title ? null : title;
  }

  function doSelect(canonical: CanonicalWorkout): void {
    void fileStore.putSetting('selectedWorkout', canonical);
    engine.setWorkoutFromPicker(canonical);
    ui.close();
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
    if (expandedTitle === canonical.workoutTitle) expandedTitle = null;
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
    expandedTitle = copy.workoutTitle || null;
  }

  // DEFERRED (builder host milestone): these render but do nothing yet.
  function onCreateWorkout(): void {
    /* deferred: opens the in-picker workout builder */
  }
  function onEdit(_canonical: CanonicalWorkout): void {
    /* deferred: opens the workout in the builder */
  }

  function onClose(): void {
    ui.close();
  }

  // --------------------------- keyboard (browse subset) ---------------------------
  function movePickerExpansion(delta: number): void {
    const items = visibleItems;
    if (!items.length) return;
    let idx = items.findIndex((it) => it.canonical.workoutTitle === expandedTitle);
    if (idx === -1) idx = delta > 0 ? 0 : items.length - 1;
    else idx = (idx + delta + items.length) % items.length;
    expandedTitle = items[idx]!.canonical.workoutTitle;
  }

  let searchInputEl = $state<HTMLInputElement | null>(null);

  function onModalKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.key || '').toLowerCase();
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;

    if (key === '/' && searchInputEl) {
      e.preventDefault();
      searchInputEl.focus();
      searchInputEl.select();
      return;
    }
    if (target === searchInputEl) {
      if (key === 'enter') {
        e.preventDefault();
        searchInputEl?.blur();
        const results = visibleItems;
        if (results.length) expandedTitle = results[0]!.canonical.workoutTitle;
      } else if (key === 'escape') {
        e.preventDefault();
        searchTerm = '';
        searchInputEl?.blur();
      }
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (key === 'enter') {
      const expanded = visibleItems.find((it) => it.canonical.workoutTitle === expandedTitle);
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        doSelect(expanded.canonical);
      }
      return;
    }
    if (key === 'arrowdown' || key === 'j') {
      e.preventDefault();
      movePickerExpansion(1);
      return;
    }
    if (key === 'arrowup' || key === 'k') {
      e.preventDefault();
      movePickerExpansion(-1);
      return;
    }
  }

  // Imperative mini-chart render for the expanded row (SVG built in core/chart).
  function miniChart(node: HTMLElement, canonical: CanonicalWorkout) {
    const render = () => renderMiniWorkoutGraph(node, canonical, currentFtp);
    requestAnimationFrame(render);
    return {
      update(next: CanonicalWorkout) {
        requestAnimationFrame(() => renderMiniWorkoutGraph(node, next, currentFtp));
      },
    };
  }
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
    data-testid="picker-modal"
    role="document"
    onkeydown={onModalKeydown}
  >
    <header class="workout-picker-header picker-only">
      <div class="workout-picker-header-actions"></div>

      <div class="workout-picker-header-main">
        <div class="workout-picker-title" id="workoutPickerTitle" data-testid="picker-title">
          Workout library
        </div>
      </div>

      <div class="workout-picker-controls">
        <div class="picker-search-wrap" class:picker-search-active={!!searchTerm.trim()}>
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
          bind:value={zoneValue}
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
          bind:value={durationValue}
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
          id="pickerAddWorkoutBtn"
          data-testid="picker-add-workout"
          class="picker-add-btn"
          type="button"
          onclick={onCreateWorkout}
        >
          <svg viewBox="0 0 24 24" class="wb-code-icon" aria-hidden="true">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>Create workout</span>
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

    <div class="workout-picker-table-wrapper picker-only">
      {#if showEmptyState}
        <div id="pickerEmptyState" class="picker-empty-state" style="display: flex">
          <div class="picker-empty-message">No workouts found. Add your first workout.</div>
          <button id="pickerEmptyAddBtn" type="button" class="picker-empty-add-btn" onclick={onCreateWorkout}>
            + Add workout
          </button>
        </div>
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
        <tbody id="pickerWorkoutTbody" data-testid="picker-tbody">
          {#each visibleItems as item (item.canonical.workoutTitle)}
            {@const title = item.canonical.workoutTitle}
            {@const zone = item.zone}
            {@const m = item.metrics}
            {#if expandedTitle !== title}
              <tr class="picker-row" data-title={title} onclick={() => toggleExpand(title)}>
                <td title={title}>{title}</td>
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
                      onclick={(e) => { e.stopPropagation(); expandedTitle = null; }}
                      role="button"
                      tabindex="-1"
                      onkeydown={() => {}}
                    ></div>

                    <div class="picker-expanded-header">
                      <div class="picker-expanded-title">{title}</div>
                      <div class="picker-expanded-actions">
                        {#if item.canonical.sourceURL}
                          <button
                            type="button"
                            class="wb-code-insert-btn visit-website-btn"
                            title="Open the workout's website in a new tab."
                            onclick={(e) => { e.stopPropagation(); window.open(item.canonical.sourceURL, '_blank'); }}
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
                        <button
                          type="button"
                          class="select-workout-btn"
                          data-testid="picker-select"
                          title="Use this workout on the workout page."
                          onclick={(e) => { e.stopPropagation(); doSelect(item.canonical); }}
                        >
                          Select workout
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
  </div>
</OverlayModal>
