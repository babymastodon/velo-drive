// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildWhatsOnZwiftCanonical } from '../../src/core/scrapers.js';

// A WhatsOnZwift workout page is server-rendered: each ".textbar" carries the
// duration/cadence text plus relative-power spans. Cover the three shapes the
// parser handles: a steady bar (with cadence), an interval set ("Nx …"), and a
// ramp (two power spans).
const HTML = `<!doctype html><html><body>
  <header class="my-8"><h1>Test WoZ Workout</h1></header>
  <p>A nice description.</p>
  <ul class="items-baseline"><li>x</li></ul>
  <div class="order-2">
    <div class="textbar"><span data-unit="relpow" data-value="50">50</span>% FTP 5min @ 85rpm</div>
    <div class="textbar">5x 1min @ <span data-unit="relpow" data-value="105">105</span>% FTP, 2min @ <span data-unit="relpow" data-value="50">50</span>% FTP</div>
    <div class="textbar"><span data-unit="relpow" data-value="40">40</span>% FTP to <span data-unit="relpow" data-value="60">60</span>% FTP 5min</div>
  </div>
</body></html>`;

describe('WhatsOnZwift scraper', () => {
  it('parses title + steady/interval-set/ramp segments with cadence', () => {
    const doc = new DOMParser().parseFromString(HTML, 'text/html');
    const [workout, err] = buildWhatsOnZwiftCanonical(doc, 'https://whatsonzwift.com/workouts/x/y');

    expect(err).toBeNull();
    expect(workout).not.toBeNull();
    expect(workout!.workoutTitle).toBe('Test WoZ Workout');
    expect(workout!.source).toBe('WhatsOnZwift');

    // steady (1) + 5×(on,off) (10) + ramp (1) = 12 segments.
    expect(workout!.rawSegments).toHaveLength(12);
    expect(workout!.rawSegments[0]).toEqual([5, 50, 50, null, 85]); // steady + cadence
    expect(workout!.rawSegments[1]).toEqual([1, 105, 105]); // interval on
    expect(workout!.rawSegments[2]).toEqual([2, 50, 50]); // interval off
    expect(workout!.rawSegments[11]).toEqual([5, 40, 60]); // ramp 40 -> 60
  });

  it('returns an error tuple when there are no intervals', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    const [workout, err] = buildWhatsOnZwiftCanonical(doc, 'https://whatsonzwift.com/workouts/x/y');
    expect(workout).toBeNull();
    expect(err).toMatch(/intervals/i);
  });
});
