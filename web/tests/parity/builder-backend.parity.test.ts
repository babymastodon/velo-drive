// builder-backend.parity.test.ts
//
// Unit + differential tests for the DOM-free builder backend
// (src/core/builder-backend.ts):
//   - blocks <-> rawSegments round-trips (segmentsToBlocks -> buildRaw...).
//   - a built workout serializes (via core/zwo.ts) to a stable .zwo.
//   - DIFFERENTIAL parity vs the legacy docs/builder-backend.js + docs/zwo.js
//     for a few representative block sets (raw segments + the produced .zwo).
//   - mutation + undo/redo basics.

import { describe, it, expect } from 'vitest';

// Legacy ORACLEs (do not modify docs/).
import * as legacyBackendNs from '../../../legacy/builder-backend.js';
import * as legacyZwoNs from '../../../legacy/zwo.js';
const legacyBackend: any = legacyBackendNs;
const legacyZwo: any = legacyZwoNs;

// New ports.
import { createBuilderBackend } from '../../src/core/builder-backend.js';
import { canonicalWorkoutToZwoXml } from '../../src/core/zwo.js';
import type { RawSegment } from '../../src/core/model.js';

describe('builder-backend: blocks <-> rawSegments round-trip', () => {
  it('default new-workout blocks round-trip through rawSegments', () => {
    const be = createBuilderBackend();
    be.setDefaultBlocks();
    const blocks = be.getCurrentBlocks();
    expect(blocks.map((b) => b.kind)).toEqual([
      'warmup',
      'steady',
      'intervals',
      'cooldown',
    ]);

    const raw = be.buildRawSegmentsFromBlocks(blocks);
    // warmup(1) + steady(1) + intervals(6*2=12) + cooldown(1) = 15 segments.
    expect(raw.length).toBe(15);

    const blocks2 = be.segmentsToBlocks(raw);
    expect(blocks2.map((b) => b.kind)).toEqual([
      'warmup',
      'steady',
      'intervals',
      'cooldown',
    ]);
    const raw2 = be.buildRawSegmentsFromBlocks(blocks2);
    expect(raw2).toEqual(raw);
  });

  it('round-trips a mixed set incl. freeride + cadence', () => {
    const be = createBuilderBackend();
    const blocks = [
      be.createBlock('warmup', {
        durationSec: 300,
        powerLowRel: 0.5,
        powerHighRel: 0.8,
      }),
      be.createBlock('steady', {
        durationSec: 600,
        powerRel: 0.75,
        cadenceRpm: 95,
      }),
      be.createBlock('freeride', { durationSec: 120 }),
      be.createBlock('intervals', {
        repeat: 4,
        onDurationSec: 30,
        offDurationSec: 90,
        onPowerRel: 1.2,
        offPowerRel: 0.5,
      }),
      be.createBlock('cooldown', {
        durationSec: 300,
        powerLowRel: 0.6,
        powerHighRel: 0.45,
      }),
    ];
    const raw = be.buildRawSegmentsFromBlocks(blocks);
    const blocks2 = be.segmentsToBlocks(raw);
    const raw2 = be.buildRawSegmentsFromBlocks(blocks2);
    expect(raw2).toEqual(raw);
    expect(raw.some((s) => (s as unknown[])[3] === 'freeride')).toBe(true);
    expect(raw.some((s) => (s as unknown[]).length === 5)).toBe(true);
  });
});

describe('builder-backend: serialization to .zwo', () => {
  it('a built workout serializes to a stable .zwo', () => {
    const be = createBuilderBackend();
    be.setMeta({
      workoutTitle: 'Test Build',
      source: 'Me',
      description: 'A test',
      sourceURL: '',
    });
    be.setDefaultBlocks();
    be.recomputeDerived(250);
    const canonical = be.getCanonicalState();
    const xml = canonicalWorkoutToZwoXml(canonical);
    expect(xml).toContain('<workout_file>');
    expect(xml).toContain('Test Build');
    expect(xml).toContain('<workout>');
    expect(xml.length).toBeGreaterThan(100);
  });
});

describe('builder-backend: differential parity vs legacy', () => {
  const cases: { name: string; build: (be: any) => void }[] = [
    {
      name: 'default new-workout blocks',
      build: (be) => be.setDefaultBlocks(),
    },
    {
      name: 'steady + intervals',
      build: (be) => {
        be.commitBlocks(
          [
            be.createBlock('steady', { durationSec: 600, powerRel: 0.7 }),
            be.createBlock('intervals', {
              repeat: 3,
              onDurationSec: 120,
              offDurationSec: 60,
              onPowerRel: 1.05,
              offPowerRel: 0.5,
            }),
          ],
          { selectIndex: null },
        );
      },
    },
    {
      name: 'warmup + freeride + cooldown',
      build: (be) => {
        be.commitBlocks(
          [
            be.createBlock('warmup', {
              durationSec: 300,
              powerLowRel: 0.45,
              powerHighRel: 0.7,
            }),
            be.createBlock('freeride', { durationSec: 600 }),
            be.createBlock('cooldown', {
              durationSec: 300,
              powerLowRel: 0.6,
              powerHighRel: 0.4,
            }),
          ],
          { selectIndex: null },
        );
      },
    },
    {
      name: 'steady with cadence',
      build: (be) => {
        be.commitBlocks(
          [
            be.createBlock('steady', {
              durationSec: 450,
              powerRel: 0.82,
              cadenceRpm: 90,
            }),
          ],
          { selectIndex: null },
        );
      },
    },
  ];

  for (const c of cases) {
    it(`matches legacy rawSegments for "${c.name}"`, () => {
      const tsBe = createBuilderBackend();
      const lgBe = legacyBackend.createBuilderBackend();
      c.build(tsBe);
      c.build(lgBe);
      const tsRaw = tsBe.buildRawSegmentsFromBlocks(tsBe.getCurrentBlocks());
      const lgRaw = lgBe.buildRawSegmentsFromBlocks(lgBe.getCurrentBlocks());
      expect(tsRaw).toEqual(lgRaw);
    });

    it(`matches legacy .zwo for "${c.name}"`, () => {
      const tsBe = createBuilderBackend();
      const lgBe = legacyBackend.createBuilderBackend();
      c.build(tsBe);
      c.build(lgBe);
      const meta = {
        workoutTitle: 'Diff',
        source: 'Me',
        description: 'd',
        sourceURL: '',
      };
      tsBe.setMeta(meta);
      lgBe.setMeta(meta);
      tsBe.recomputeDerived(250);
      lgBe.recomputeDerived(250);
      const tsXml = canonicalWorkoutToZwoXml(tsBe.getCanonicalState());
      const lgXml = legacyZwo.canonicalWorkoutToZwoXml(lgBe.getCanonicalState());
      expect(tsXml).toBe(lgXml);
    });
  }
});

describe('builder-backend: mutations + undo/redo', () => {
  it('insert changes block count; attr update changes value; undo reverts', () => {
    const be = createBuilderBackend();
    be.setDefaultBlocks();
    be.recomputeDerived(250);
    const before = be.getCurrentBlocks().length;

    be.setInsertAfterOverrideIndex(before - 1);
    be.insertBlockAtInsertionPoint(
      { kind: 'steady', durationSec: 300, powerRel: 0.6 },
      { selectOnInsert: true },
    );
    expect(be.getCurrentBlocks().length).toBe(before + 1);

    const idx = be.getSelectedBlockIndex();
    expect(idx).not.toBeNull();
    be.applyBlockAttrUpdate(idx!, { powerRel: 0.9 });
    expect(be.getBlockSteadyPower(be.getCurrentBlocks()[idx!]!)).toBeCloseTo(
      0.9,
      5,
    );

    be.undoLastChange();
    expect(be.getBlockSteadyPower(be.getCurrentBlocks()[idx!]!)).toBeCloseTo(
      0.6,
      5,
    );
  });

  it('empty workout serializes to no segments', () => {
    const be = createBuilderBackend();
    be.commitBlocks([], { selectIndex: null });
    be.recomputeDerived(250);
    const raw: RawSegment[] = be.getCurrentRawSegments();
    expect(raw.length).toBe(0);
  });
});
