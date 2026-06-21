// Unit tests for the bulk importers' pure logic. The fetch seam (core/net.ts)
// is stubbed so pagination + mapping are deterministic (no network).
import { afterEach, describe, expect, it } from 'vitest';
import { fetchTrainerDayPopular } from '../../src/core/importers.js';
import { setHttpImpl } from '../../src/core/net.js';

afterEach(() => {
  // Restore the default browser-fetch path for any other test in this file.
  setHttpImpl(async (url) => {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
  });
});

describe('fetchTrainerDayPopular', () => {
  it('paginates until hasMore=false and maps segments + folder path', async () => {
    const page0 = {
      items: [
        {
          id: 1,
          slug: 'alpha',
          title: 'Alpha',
          description: '<p>hi</p>',
          _segmentsBackup: [
            [5, 50, 50, null, null, null],
            [2, 100, 100, null, null, null],
          ],
        },
      ],
      hasMore: true,
    };
    const page1 = {
      items: [{ id: 2, slug: 'beta', title: 'Beta', _segmentsBackup: [[10, 60, 60]] }],
      hasMore: false,
    };
    setHttpImpl(async (url) => ({
      ok: true,
      status: 200,
      text: JSON.stringify(url.includes('pageNumber=0') ? page0 : page1),
    }));

    const out = await fetchTrainerDayPopular(1000);
    expect(out).toHaveLength(2);
    expect(out[0]!.source).toBe('TrainerDay');
    expect(out[0]!.workoutTitle).toBe('Alpha');
    expect(out[0]!.description).toBe('hi');
    expect(out[0]!.sourcePath).toBe('TrainerDay/Alpha.zwo');
    expect(out[0]!.rawSegments).toEqual([
      [5, 50, 50],
      [2, 100, 100],
    ]);
    expect(out[1]!.sourcePath).toBe('TrainerDay/Beta.zwo');
  });

  it('honors the limit and dedupes repeated ids', async () => {
    const item = { id: 7, slug: 'x', title: 'X', _segmentsBackup: [[1, 50, 50]] };
    // Always returns the same item with hasMore=true — limit + dedupe must stop it.
    setHttpImpl(async () => ({ ok: true, status: 200, text: JSON.stringify({ items: [item], hasMore: true }) }));
    const out = await fetchTrainerDayPopular(5);
    expect(out).toHaveLength(1); // same id deduped, so only one survives
  });
});
