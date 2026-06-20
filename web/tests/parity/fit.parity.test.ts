import { describe, it, expect } from 'vitest';

import * as legacyFitNs from '../../../legacy/fit-file.js';
const legacyFit: any = legacyFitNs;
import * as newFit from '../../src/core/fit.js';

const canonicalWorkout = {
  source: 'TrainerRoad',
  sourceURL: 'https://example.com/workout/123',
  workoutTitle: 'Parity Test Workout',
  description: 'A deterministic workout used for FIT byte-parity testing.',
  rawSegments: [
    [5, 50, 70], // warmup ramp
    [10, 85, 85], // steady
    [2, 50, 50, 'freeride'], // freeride
    [10, 100, 100], // steady
    [5, 60, 40], // cooldown ramp
  ] as any,
  textEvents: [],
};

// Deterministic timestamps so the build is byte-stable.
const startedAt = new Date('2026-01-15T08:00:00.000Z');
const endedAt = new Date('2026-01-15T08:32:00.000Z');

function makeSamples(): any[] {
  const out: any[] = [];
  for (let i = 1; i <= 120; i++) {
    out.push({
      t: i,
      power: 150 + Math.round(40 * Math.sin(i / 9)),
      hr: 110 + (i % 25),
      cadence: 85 + (i % 8),
      targetPower: 160 + (i % 10),
    });
  }
  return out;
}

const buildOpts = {
  canonicalWorkout,
  samples: makeSamples(),
  ftp: 250,
  startedAt,
  endedAt,
  pauseEvents: [
    { at: new Date('2026-01-15T08:10:00.000Z'), type: 'stop' },
    { at: new Date('2026-01-15T08:11:00.000Z'), type: 'start' },
  ],
  totalElapsedSec: 1920,
};

describe('fit parity: buildFitFile byte-equality', () => {
  it('produces byte-identical FIT files', () => {
    const legacyBytes = legacyFit.buildFitFile(buildOpts);
    const portedBytes = newFit.buildFitFile(buildOpts);
    expect(portedBytes.length).toBe(legacyBytes.length);
    expect(Array.from(portedBytes)).toEqual(Array.from(legacyBytes));
  });

  it('byte-identical with minimal inputs (no samples/pauses)', () => {
    const minimal = {
      canonicalWorkout,
      samples: [],
      ftp: 200,
      startedAt,
      endedAt,
    };
    const legacyBytes = legacyFit.buildFitFile(minimal);
    const portedBytes = newFit.buildFitFile(minimal);
    expect(Array.from(portedBytes)).toEqual(Array.from(legacyBytes));
  });
});

describe('fit parity: parseFitFile round-trip', () => {
  it('legacy-built FIT parses identically with both parsers', () => {
    const bytes = legacyFit.buildFitFile(buildOpts);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const legacyParsed = legacyFit.parseFitFile(ab);
    const portedParsed = newFit.parseFitFile(ab as ArrayBuffer);
    expect(portedParsed).toEqual(legacyParsed);
  });

  it('new-built FIT parses identically with both parsers', () => {
    const bytes = newFit.buildFitFile(buildOpts);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const legacyParsed = legacyFit.parseFitFile(ab);
    const portedParsed = newFit.parseFitFile(ab as ArrayBuffer);
    expect(portedParsed).toEqual(legacyParsed);
  });

  it('round-trip preserves canonical workout', () => {
    const bytes = newFit.buildFitFile(buildOpts);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const parsed = newFit.parseFitFile(ab as ArrayBuffer);
    expect(parsed.canonicalWorkout).toEqual(canonicalWorkout);
  });
});
