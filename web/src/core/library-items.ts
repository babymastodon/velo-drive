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

let memoWorkouts: CanonicalWorkout[] | null = null;
let memoFtp = -1;
let memoItems: LibraryItem[] | null = null;

/** Map workouts → display items (zone + metrics), memoized by (array ref, ftp). */
export function prepareLibraryItems(workouts: CanonicalWorkout[], ftp: number): LibraryItem[] {
  if (memoItems && memoWorkouts === workouts && memoFtp === ftp) return memoItems;
  const items = workouts.map((canonical) => ({
    canonical,
    zone: inferZoneFromSegments(canonical.rawSegments) || 'Uncategorized',
    metrics: computeMetricsFromSegments(canonical.rawSegments, ftp),
  }));
  memoWorkouts = workouts;
  memoFtp = ftp;
  memoItems = items;
  return items;
}
