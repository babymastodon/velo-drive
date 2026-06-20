import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as legacyZwoNs from '../../../legacy/zwo.js';
import * as legacyMetricsNs from '../../../legacy/workout-metrics.js';
const legacyZwo: any = legacyZwoNs;
const legacyMetrics: any = legacyMetricsNs;
import * as newMetrics from '../../src/core/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKOUTS_DIR = join(__dirname, '../../../legacy/workouts');

function loadCorpus(): { name: string; segments: any[] }[] {
  const files = readdirSync(WORKOUTS_DIR).filter((f) => f.endsWith('.zwo'));
  return files.map((name) => {
    const xml = readFileSync(join(WORKOUTS_DIR, name), 'utf8');
    const cw = legacyZwo.parseZwoXmlToCanonicalWorkout(xml);
    return { name, segments: cw.rawSegments };
  });
}

const corpus = loadCorpus();
const FTP = 250;

describe('metrics parity: constants', () => {
  it('DEFAULT_FTP matches', () => {
    expect(newMetrics.DEFAULT_FTP).toBe(legacyMetrics.DEFAULT_FTP);
  });
});

describe('metrics parity: computeMetricsFromSegments', () => {
  for (const { name, segments } of corpus) {
    it(`metrics ${name} identical`, () => {
      const legacy = legacyMetrics.computeMetricsFromSegments(segments, FTP);
      const ported = newMetrics.computeMetricsFromSegments(segments, FTP);
      expect(ported).toEqual(legacy);
    });
  }
});

describe('metrics parity: inferZoneFromSegments', () => {
  for (const { name, segments } of corpus) {
    it(`zone ${name} identical`, () => {
      expect(newMetrics.inferZoneFromSegments(segments)).toBe(
        legacyMetrics.inferZoneFromSegments(segments),
      );
    });
  }
});

describe('metrics parity: computeScheduledMetrics', () => {
  for (const { name, segments } of corpus) {
    it(`scheduled ${name} identical`, () => {
      const legacy = legacyMetrics.computeScheduledMetrics(
        { rawSegments: segments },
        FTP,
      );
      const ported = newMetrics.computeScheduledMetrics(
        { rawSegments: segments },
        FTP,
      );
      expect(ported).toEqual(legacy);
    });
  }
});

describe('metrics parity: getDurationBucket / formatDurationMinSec', () => {
  const mins = [
    -1, 0, 0.5, 5, 30, 30.1, 45, 46, 60, 61, 75, 76, 90, 91, 120, 121, 180,
    181, 240, 241, 1000, NaN, Infinity,
  ];
  for (const m of mins) {
    it(`getDurationBucket(${m})`, () => {
      expect(newMetrics.getDurationBucket(m)).toBe(
        legacyMetrics.getDurationBucket(m),
      );
    });
  }
  const secs = [-1, 0, 1, 59, 60, 61, 90, 3599, 3600, 3661, 12.7];
  for (const s of secs) {
    it(`formatDurationMinSec(${s})`, () => {
      expect(newMetrics.formatDurationMinSec(s)).toBe(
        legacyMetrics.formatDurationMinSec(s),
      );
    });
  }
});

describe('metrics parity: computeMetricsFromSamples', () => {
  function makeSamples(n: number): any[] {
    const out: any[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        t: i + 1,
        power: 100 + 50 * Math.sin(i / 7) + (i % 5) * 3,
        hr: i % 3 === 0 ? 120 + (i % 20) : null,
        cadence: 80 + (i % 10),
      });
    }
    return out;
  }
  const sizes = [0, 1, 5, 29, 30, 31, 90, 125];
  for (const n of sizes) {
    it(`samples n=${n} identical`, () => {
      const samples = makeSamples(n);
      const legacy = legacyMetrics.computeMetricsFromSamples(samples, FTP);
      const ported = newMetrics.computeMetricsFromSamples(samples, FTP);
      // perSecondPower is a Float32Array; compare via Array for clean equality.
      const norm = (m: any) => ({
        ...m,
        perSecondPower: m.perSecondPower
          ? Array.from(m.perSecondPower)
          : m.perSecondPower,
      });
      expect(norm(ported)).toEqual(norm(legacy));
    });
  }
});

describe('metrics: getAdjustedKjForPicker (INTENTIONAL fix vs legacy)', () => {
  it('matches legacy for the normal (baseFtp > 0) path', () => {
    expect(newMetrics.getAdjustedKjForPicker(100, 200, 250)).toBe(
      legacyMetrics.getAdjustedKjForPicker(100, 200, 250),
    );
  });

  it('matches legacy when args are nullish/non-finite', () => {
    expect(newMetrics.getAdjustedKjForPicker(null, 200, 250)).toBe(
      legacyMetrics.getAdjustedKjForPicker(null, 200, 250),
    );
    expect(newMetrics.getAdjustedKjForPicker(100, NaN, 250)).toBe(
      legacyMetrics.getAdjustedKjForPicker(100, NaN, 250),
    );
  });

  it('legacy THROWS on baseFtp <= 0 (undefined `workout` reference)', () => {
    expect(() => legacyMetrics.getAdjustedKjForPicker(100, 0, 250)).toThrow();
    expect(() =>
      legacyMetrics.getAdjustedKjForPicker(100, -5, 250),
    ).toThrow();
  });

  it('new port returns baseKj unchanged on baseFtp <= 0 (fixed)', () => {
    expect(newMetrics.getAdjustedKjForPicker(100, 0, 250)).toBe(100);
    expect(newMetrics.getAdjustedKjForPicker(100, -5, 250)).toBe(100);
    expect(newMetrics.getAdjustedKjForPicker(42, 0, 999)).toBe(42);
  });
});
