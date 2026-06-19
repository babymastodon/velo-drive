// Unit tests for the builder clipboard codec (src/core/builder-backend.ts
// encodeClipboard / encodeTextEventClipboard / parseClipboard). The codec owns
// the wire format the legacy builder used: ZWO XML for block selections and a
// `VELO_TEXT_EVENTS:{json}` string for a lone text-event. These functions are
// pure (no navigator.clipboard) so copy->paste can be asserted deterministically
// here; the e2e harness mocks navigator.clipboard separately.

import { describe, expect, it } from 'vitest';
import {
  encodeClipboard,
  encodeTextEventClipboard,
  parseClipboard,
} from '../../src/core/builder-backend.js';
import type { RawSegment, TextEvent } from '../../src/core/model.js';

describe('builder clipboard codec', () => {
  it('round-trips a block selection through ZWO XML', () => {
    // buildRawSegmentsFromBlocks emits power as a percentage (xFTP*100).
    // 5 min steady at 90% FTP, then a 10 min ramp 50%->75%.
    const rawSegments: RawSegment[] = [
      [5, 90, 90],
      [10, 50, 75],
    ];
    const xml = encodeClipboard(rawSegments, []);
    expect(xml).toContain('<workout_file>');
    expect(xml).toContain('<SteadyState');

    const parsed = parseClipboard(xml);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('blocks');
    if (parsed!.kind !== 'blocks') throw new Error('expected blocks');
    expect(parsed!.canonical.rawSegments.length).toBe(rawSegments.length);
    // Durations (minutes) and powers survive the round-trip.
    expect(parsed!.canonical.rawSegments[0]![0]).toBeCloseTo(5, 5);
    expect(parsed!.canonical.rawSegments[0]![1]).toBeCloseTo(90, 5);
    expect(parsed!.canonical.rawSegments[1]![1]).toBeCloseTo(50, 5);
    expect(parsed!.canonical.rawSegments[1]![2]).toBeCloseTo(75, 5);
  });

  it('carries text events alongside a block selection', () => {
    const rawSegments: RawSegment[] = [[5, 90, 90]];
    const textEvents: TextEvent[] = [
      { offsetSec: 30, durationSec: 8, text: 'Push!' },
    ];
    const xml = encodeClipboard(rawSegments, textEvents);
    const parsed = parseClipboard(xml);
    if (!parsed || parsed.kind !== 'blocks') throw new Error('expected blocks');
    const events = parsed.canonical.textEvents || [];
    expect(events.length).toBe(1);
    expect(events[0]!.text).toBe('Push!');
    expect(events[0]!.offsetSec).toBe(30);
  });

  it('encodes a lone text event as the VELO_TEXT_EVENTS string', () => {
    const text = encodeTextEventClipboard([
      { offsetSec: 999, durationSec: 12, text: 'Recover' },
    ]);
    expect(text.startsWith('VELO_TEXT_EVENTS:')).toBe(true);

    const parsed = parseClipboard(text);
    if (!parsed || parsed.kind !== 'textEvents') throw new Error('expected textEvents');
    expect(parsed.textEvents.length).toBe(1);
    // Offset is reset to 0 so paste lands at the insertion cursor.
    expect(parsed.textEvents[0]!.offsetSec).toBe(0);
    expect(parsed.textEvents[0]!.durationSec).toBe(12);
    expect(parsed.textEvents[0]!.text).toBe('Recover');
  });

  it('returns null for empty / unrecognized clipboard text', () => {
    expect(parseClipboard('')).toBeNull();
    expect(parseClipboard('just some text')).toBeNull();
    expect(parseClipboard('VELO_TEXT_EVENTS:{not json')).toBeNull();
    expect(parseClipboard('VELO_TEXT_EVENTS:{"textEvents":[]}')).toBeNull();
  });
});
