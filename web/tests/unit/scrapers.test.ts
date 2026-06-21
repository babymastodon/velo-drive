// Unit tests for the TrainerDay URL scraper (src/core/scrapers.ts). The
// scraper is pure except for the global `fetch`, which we stub here so the
// happy + error paths are deterministic (the e2e harness can't reach the real
// TrainerDay API).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTrainerDayUrl } from '../../src/core/scrapers.js';

const realFetch = globalThis.fetch;

function stubFetch(impl: (url: string, opts?: RequestInit) => Promise<Response> | Response): void {
  globalThis.fetch = vi.fn(impl as unknown as typeof fetch) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('parseTrainerDayUrl', () => {
  it('rejects empty / non-string input', async () => {
    const [cw, err] = await parseTrainerDayUrl('');
    expect(cw).toBeNull();
    expect(err).toMatch(/TrainerDay workout URL/i);
  });

  it('rejects a malformed URL', async () => {
    const [cw, err] = await parseTrainerDayUrl('not a url');
    expect(cw).toBeNull();
    expect(err).toMatch(/valid URL/i);
  });

  it('rejects a non-TrainerDay host', async () => {
    const [cw, err] = await parseTrainerDayUrl('https://example.com/workouts/foo');
    expect(cw).toBeNull();
    expect(err).toMatch(/TrainerDay workout URL/i);
  });

  it('rejects a TrainerDay URL that is not a workout page', async () => {
    const [cw, err] = await parseTrainerDayUrl('https://app.trainerday.com/');
    expect(cw).toBeNull();
    expect(err).toMatch(/does not look like a workout page/i);
  });

  it('parses a valid TrainerDay workout into a CanonicalWorkout', async () => {
    stubFetch((url) => {
      expect(url).toContain('/api/workouts/bySlug/vo2-max-1');
      return jsonResponse({
        title: 'VO2 Max 1',
        description: '<p>Hard intervals</p>',
        segments: [
          [5, 50, 60], // warmup ramp
          [4, 120, 120, 95], // effort + cadence
          [2, 50, 50],
        ],
      });
    });

    const [cw, err] = await parseTrainerDayUrl(
      'https://app.trainerday.com/workouts/vo2-max-1',
    );
    expect(err).toBeNull();
    expect(cw).not.toBeNull();
    expect(cw!.source).toBe('TrainerDay');
    expect(cw!.workoutTitle).toBe('VO2 Max 1');
    expect(cw!.description).toBe('Hard intervals');
    expect(cw!.rawSegments.length).toBe(3);
    expect(cw!.rawSegments[0]).toEqual([5, 50, 60]);
    // Cadence-carrying segment normalizes to [min, start, end, null, rpm].
    expect(cw!.rawSegments[1]).toEqual([4, 120, 120, null, 95]);
  });

  it('maps a 404 to a friendly error', async () => {
    stubFetch(() => jsonResponse({}, { ok: false, status: 404 }));
    const [cw, err] = await parseTrainerDayUrl('https://app.trainerday.com/workouts/missing');
    expect(cw).toBeNull();
    expect(err).toMatch(/404/);
  });

  it('rejects a workout with no usable segments', async () => {
    stubFetch(() => jsonResponse({ title: 'Empty', segments: [] }));
    const [cw, err] = await parseTrainerDayUrl('https://app.trainerday.com/workouts/empty');
    expect(cw).toBeNull();
    expect(err).toMatch(/doesn’t have any intervals/i);
  });
});
