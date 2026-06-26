# Workout browser performance on Tauri (WebKitGTK) — analysis & options

**Status:** analysis only, no code changed (as of 2026-06-25).
**Symptom:** opening a folder of 3000+ workouts is smooth in Chrome (the PWA) but
slows to a crawl in the Tauri native build (WebKitGTK webview). Scrolling and
the workout selector lag.

This doc records the root-cause analysis and the top mitigation options so we
don't have to re-derive it.

---

## TL;DR

The picker renders **every** workout into a single HTML `<table>` with **no
virtualization** — ~27–30k DOM nodes for 3000 workouts. Chrome's layout/paint
engine shrugs this off; WebKitGTK does not, and two Tauri-specific factors make
it worse:

1. **No windowing** — all rows are in the DOM at once (`PickerView.svelte:1689`).
2. **One monolithic auto-layout `<table>`** (`PickerView.svelte:1660`) — table
   column sizing is a *global* pass over all cells, which is superlinear and a
   known WebKit weak spot.
3. **GPU compositing is disabled** — the flatpak sets
   `WEBKIT_DISABLE_DMABUF_RENDERER=1` (in `flatpak/bike.velodrive.VeloDrive.yml`)
   to work around a Wayland/GPU rendering bug, forcing **software compositing**,
   which slows every repaint.

The per-workout **metrics computation is *not* the bottleneck** — it's memoized
and pre-warmed at boot. The cost is DOM node count + table layout + software
paint.

---

## How the picker renders today (code references)

All paths are under `web/src/`.

### No virtualization — the whole library is in the DOM
- `ui/PickerView.svelte:1660` — `<table class="workout-picker-table">` with a
  `<thead>` of 7 sortable columns (Name / Zone / Source / IF / TSS / Duration / kJ).
- `ui/PickerView.svelte:1689` — `{#each navEntries as entry (navEntryKey(entry))}`
  is a plain Svelte loop over **all** filtered items. No virtual-list library, no
  IntersectionObserver windowing, no `content-visibility`.
- Each collapsed workout is one `<tr class="picker-row">` with 7 `<td>` cells
  (`ui/PickerView.svelte:1718-1730`) — ~9 nodes/row, **no SVG when collapsed**.
- **Node-count estimate for 3000 workouts:** ~3000 rows × ~9 nodes ≈ **27k nodes**
  inside one table, before any expansion.

### The team already knew and band-aided it
- `ui/PickerView.svelte:239-242` — on open, scroll-into-view is deferred with a
  double `requestAnimationFrame`, with the comment that the un-virtualized list
  otherwise "stalls ~1s on huge libraries." This treats the symptom (let it paint
  before the layout-forcing scroll jump), not the cause.

### Per-row cost
- **Collapsed:** ~9 HTML nodes, no SVG.
- **Expanded** (`ui/PickerView.svelte:1733-1869`): header + action buttons + stat
  chips + description + an inline SVG profile chart. The mini-chart
  (`core/chart.ts`, `renderMiniWorkoutGraph` / `renderSegmentPolygon`) emits one
  `<svg>` + background `<rect>` + **one `<polygon>` per segment** + hover
  `<circle>`s — ~50–60 SVG nodes for a typical workout, more for long ones. So an
  expanded row adds ~85–100 nodes. Only a handful are expanded at a time, so this
  is a secondary cost.

### Metrics compute is precomputed + memoized (NOT the hot path)
- `core/library-items.ts` (`prepareLibraryItems`) memoizes by `(workouts, ftp)`
  via a WeakMap; an FTP change is a cheap rescale, not a recompute.
- `app/app.ts:125` pre-warms the library metrics in the background at boot, so by
  the time the picker opens it's a cache hit.
- The underlying compute (`core/metrics.ts`, per-second loops with `** 4`
  exponentiation for normalized power) is heavy in aggregate (~tens of millions of
  ops for 3000 long workouts) but only runs **once** (boot/first open) and off the
  open path thereafter. Don't optimize this first.

### Filtering / folder grouping
- `ui/PickerView.svelte:301-343` — `visibleItems` is a `$derived.by` that filters
  the full array by zone / duration / search and sorts. O(n) per keystroke over
  3000 items is cheap on CPU, but each change **rebuilds the row set and forces a
  full table relayout**, which is the expensive part on WebKitGTK.

### Scrolling
- Native scroll on the tall container. No scroll listeners / no
  `getBoundingClientRect` reads during scroll (good — no layout thrash from JS).
  The cost is the engine laying out + painting a 27k-node software-composited table.

### Cost hotspots, ranked
1. **[critical]** ~27–30k DOM nodes rendered at once (no windowing).
2. **[high]** single auto-layout `<table>` → global column-sizing relayout on every
   filter/sort/expand.
3. **[high, Tauri-only]** software compositing (`WEBKIT_DISABLE_DMABUF_RENDERER=1`)
   slows every repaint.
4. **[medium]** SVG mini-chart per expanded row.
5. **[low]** metrics compute — already memoized/pre-warmed.

---

## Why Tauri and not Chrome

- WebKitGTK on Linux is widely reported as under-optimized for large DOMs
  (Tauri #3988, wry #890, the HN thread below). Blink (Chrome) handles big trees
  far better.
- The runtime ships **WebKitGTK ≈ 2.50** (GNOME 49 runtime:
  `libwebkit2gtk-4.1.so.0.21.8` / `libwebkitgtk-6.0.so.4.16.8`), which **does**
  support `content-visibility: auto` (added ~WebKit 2.46 / Safari 18) and renders
  2D via Skia.
- We voluntarily disable the DMA-BUF GPU renderer, so we lose hardware compositing
  that Chrome uses by default.

---

## Top 3 options (ranked by speedup; all preserve native scroll)

> Note on the "insert blank rows, add detail only on-screen" idea: it won't help
> much here because the collapsed rows are *already* trivial (~9 nodes, no SVG).
> The cost is the **count** of rows + table layout, not per-row richness — so the
> win must come from rendering fewer nodes or skipping off-screen layout/paint.

### 1. Drop the `<table>` for CSS-grid rows + `content-visibility: auto` *(best effort/risk)*
Convert each row from `<tr>/<td>` to a block / `display:grid` row with fixed
column widths, then add `content-visibility:auto` + `contain-intrinsic-size:
<rowHeight>` per row.
- **Why fast:** removes the global table-layout pass entirely, and lets WebKit
  **skip layout + paint for off-screen rows** (engine-level "detail only on
  screen").
- **Scroll feel:** *perfect* — all rows stay in the DOM, so the real scrollbar,
  scroll position, `j/k` nav, and native Ctrl+F all keep working;
  `contain-intrinsic-size` prevents scrollbar jumpiness.
- **Caveat:** nodes are still *created* once on open, so the first-open build cost
  shrinks (no table layout) but doesn't vanish. `content-visibility` does not apply
  to `tr/td`, which is exactly why the table must go first.
- **Effort:** medium (markup/CSS refactor; re-create column alignment + sortable
  headers as a grid).

### 2. True virtualization / windowing *(max raw speedup, highest UX risk)*
Render only visible rows + a small overscan (~10) using a headless windowing lib
so we keep our markup.
- **Why fast:** DOM drops from ~27k to a few hundred nodes — the complete fix; also
  eliminates the first-open build stall and memory growth that option 1 leaves.
- **Scroll feel:** native scroll is *simulated*; good overscan + scroll anchoring
  feel normal, but this is the option most likely to feel "unnatural" if mistuned.
  Must handle **variable row heights** (expand/collapse), scroll-to-selected,
  `j/k`, sticky folder headers, and accept that native Ctrl+F won't find off-DOM
  rows (mitigated by the existing in-app search box).
- **Library:** [TanStack Virtual](https://github.com/TanStack/virtual) (headless,
  but [Svelte 5 rough edges](https://github.com/TanStack/virtual/issues/866)) or
  [virtua](https://github.com/inokawa/virtua) (cleaner Svelte 5 support).
- **Effort:** high.

### 3. Re-enable GPU compositing *(orthogonal, zero UX change, uncertain)*
Test removing/narrowing `WEBKIT_DISABLE_DMABUF_RENDERER=1` on the current
WebKitGTK 2.50 (Skia GPU path may have fixed the original bug).
- **Why fast:** software compositing penalizes *every* repaint app-wide; restoring
  hardware acceleration speeds the big list and everything else with no code/scroll
  change.
- **Risk:** may bring back the blank/garbled rendering the flag was added for; needs
  testing on the target GPU, possibly scoping the flag per-GPU.
- **Effort:** low to test, hardware-dependent outcome.

### Recommendation
- The options **stack**. Best end state is likely **1 + 3** (grid rows +
  `content-visibility`, with GPU back on): close to "Chrome-smooth" while keeping
  scroll 100% native, far less invasive than virtualization. Reach for **2** only
  if first-open build time is still unacceptable after 1.

### De-risk by measuring first (~10 min)
- Temporarily cap the list to ~200 rows → if instantly snappy, node count is
  confirmed dominant (favors 1/2).
- Toggle `WEBKIT_DISABLE_DMABUF_RENDERER` and compare scroll FPS → isolates the
  compositing share (option 3).

---

## Sources
- Tauri Linux perf: https://github.com/tauri-apps/tauri/issues/3988
- wry perf: https://github.com/tauri-apps/wry/issues/890
- HN — WebKitGTK perf: https://news.ycombinator.com/item?id=41565913
- Nvidia/DMABUF notes: https://github.com/tauri-apps/tauri/issues/9394
- content-visibility (web.dev): https://web.dev/articles/content-visibility
- content-visibility & scrollbars: https://www.bram.us/2020/12/21/content-visiblity-vs-jumpy-scrollbars-a-solution/
- TanStack Virtual: https://github.com/TanStack/virtual
- High-performance SVGs: https://css-tricks.com/high-performance-svgs/
