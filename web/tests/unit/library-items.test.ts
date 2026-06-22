import { describe, it, expect } from 'vitest';
import { prepareLibraryItems } from '../../src/core/library-items.js';
import type { CanonicalWorkout } from '../../src/core/model.js';

function wk(title: string): CanonicalWorkout {
  return {
    source: '',
    sourceURL: '',
    workoutTitle: title,
    rawSegments: [
      [10, 80, 80],
      [5, 110, 110],
    ],
    description: '',
  };
}

describe('prepareLibraryItems', () => {
  it('computes zone + metrics and memoizes by (array ref, ftp)', () => {
    const workouts = [wk('A'), wk('B')];
    const a = prepareLibraryItems(workouts, 200);
    expect(a).toHaveLength(2);
    expect(a[0]!.metrics.durationMin).toBeCloseTo(15);
    expect(a[0]!.zone).toBeTruthy();

    // Same array + ftp → memo hit (identical reference).
    expect(prepareLibraryItems(workouts, 200)).toBe(a);

    // Changed ftp → recompute (new reference).
    expect(prepareLibraryItems(workouts, 260)).not.toBe(a);

    // New array (e.g. after a refresh) → recompute.
    expect(prepareLibraryItems([...workouts], 200)).not.toBe(a);
  });
});
