// library-items.ts
//
// Per-workout display data for the picker (zone + IF/TSS/kJ/duration). Computing
// these runs a per-second loop per workout (computeMetricsFromSegments), which is
// noticeable across thousands of workouts — so the result is memoized by
// (workouts array, ftp). App boot pre-warms it in the background right after the
// library preload, so opening the picker is instant instead of re-deriving it.

import type { CanonicalWorkout } from './model.js';
import {
  computeMetricsFromSegments,
  inferZoneFromSegments,
  type SegmentMetrics,
} from './metrics.js';

export interface LibraryItem {
  canonical: CanonicalWorkout;
  zone: string;
  metrics: SegmentMetrics;
}

// Cache per workouts-array (WeakMap so it can't be clobbered by, e.g., the
// picker's transient empty-array render on mount — which a single-slot memo
// would overwrite, wasting the boot pre-warm). Entries GC with their array.
const cache = new WeakMap<CanonicalWorkout[], { ftp: number; items: LibraryItem[] }>();

/** Map workouts → display items (zone + metrics), memoized by (array ref, ftp). */
export function prepareLibraryItems(workouts: CanonicalWorkout[], ftp: number): LibraryItem[] {
  const hit = cache.get(workouts);
  if (hit && hit.ftp === ftp) return hit.items;
  const items = workouts.map((canonical) => ({
    canonical,
    zone: inferZoneFromSegments(canonical.rawSegments) || 'Uncategorized',
    metrics: computeMetricsFromSegments(canonical.rawSegments, ftp),
  }));
  cache.set(workouts, { ftp, items });
  return items;
}
