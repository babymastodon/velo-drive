import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Legacy ORACLE (do not modify docs/) — typed `any`: tests assert runtime equality.
import * as legacyZwoNs from '../../../docs/zwo.js';
const legacyZwo: any = legacyZwoNs;
// New port
import * as newZwo from '../../src/core/zwo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKOUTS_DIR = join(__dirname, '../../../docs/workouts');

function loadCorpus(): { name: string; xml: string }[] {
  const files = readdirSync(WORKOUTS_DIR).filter((f) => f.endsWith('.zwo'));
  return files.map((name) => ({
    name,
    xml: readFileSync(join(WORKOUTS_DIR, name), 'utf8'),
  }));
}

const corpus = loadCorpus();

describe('zwo parity: corpus loaded', () => {
  it('has 41 workout files', () => {
    expect(corpus.length).toBe(41);
  });
});

describe('zwo parity: parseZwoXmlToCanonicalWorkout', () => {
  for (const { name, xml } of corpus) {
    it(`parses ${name} identically`, () => {
      const legacy = legacyZwo.parseZwoXmlToCanonicalWorkout(xml);
      const ported = newZwo.parseZwoXmlToCanonicalWorkout(xml);
      expect(ported).toEqual(legacy);
    });
  }
});

describe('zwo parity: parseZwoSnippet', () => {
  for (const { name, xml } of corpus) {
    it(`parseZwoSnippet ${name} identically`, () => {
      // Extract the inner workout body the same way both parsers do.
      const m = xml.match(/<workout[^>]*>([\s\S]*?)<\/workout>/i);
      const inner = m?.[1] ?? '';
      const legacy = legacyZwo.parseZwoSnippet(inner);
      const ported = newZwo.parseZwoSnippet(inner);
      expect(ported).toEqual(legacy);
    });
  }
});

describe('zwo parity: canonicalWorkoutToZwoXml (serialize)', () => {
  for (const { name, xml } of corpus) {
    it(`serializes ${name} identically`, () => {
      const cw = legacyZwo.parseZwoXmlToCanonicalWorkout(xml);
      const legacyXml = legacyZwo.canonicalWorkoutToZwoXml(cw);
      const portedXml = newZwo.canonicalWorkoutToZwoXml(cw);
      expect(portedXml).toBe(legacyXml);
    });
  }
});

describe('zwo parity: segmentsToZwoSnippet', () => {
  for (const { name, xml } of corpus) {
    it(`segmentsToZwoSnippet ${name} identically`, () => {
      const cw = legacyZwo.parseZwoXmlToCanonicalWorkout(xml);
      const legacySnippet = legacyZwo.segmentsToZwoSnippet(
        cw.rawSegments,
        cw.textEvents,
      );
      const portedSnippet = newZwo.segmentsToZwoSnippet(
        cw.rawSegments,
        cw.textEvents,
      );
      expect(portedSnippet).toBe(legacySnippet);
    });
  }
});

describe('zwo: parse -> serialize -> parse fixpoint (new module)', () => {
  for (const { name, xml } of corpus) {
    it(`fixpoint for ${name}`, () => {
      const cw1 = newZwo.parseZwoXmlToCanonicalWorkout(xml);
      const xml2 = newZwo.canonicalWorkoutToZwoXml(cw1);
      const cw2 = newZwo.parseZwoXmlToCanonicalWorkout(xml2);
      const xml3 = newZwo.canonicalWorkoutToZwoXml(cw2);
      // Round-trip stabilizes: second serialization equals third.
      expect(xml3).toBe(xml2);
      // And the canonical form is stable too.
      expect(cw2).toEqual(cw1);
    });
  }
});
