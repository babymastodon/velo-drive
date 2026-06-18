import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import * as newZwo from '../../src/core/zwo.js';
import type { RawSegment } from '../../src/core/model.js';

// A generator for "well-formed-ish" canonical segments using percent power
// (the 6..100 range avoids the legacy `<= 5 means relative` ambiguity, so the
// parse->serialize->parse fixpoint is meaningful).
const segmentArb = fc.tuple(
  fc.integer({ min: 1, max: 60 }), // minutes
  fc.integer({ min: 30, max: 120 }), // startPct
  fc.integer({ min: 30, max: 120 }), // endPct
);

describe('zwo property: parse->serialize->parse fixpoint', () => {
  it('serialization stabilizes after one round-trip', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: 20 }), (segs) => {
        const cw = {
          source: 'PropTest',
          sourceURL: '',
          workoutTitle: 'Prop',
          rawSegments: segs as unknown as RawSegment[],
          description: '',
          textEvents: [],
        };
        const xml1 = newZwo.canonicalWorkoutToZwoXml(cw);
        const cw1 = newZwo.parseZwoXmlToCanonicalWorkout(xml1);
        const xml2 = newZwo.canonicalWorkoutToZwoXml(cw1);
        const cw2 = newZwo.parseZwoXmlToCanonicalWorkout(xml2);
        const xml3 = newZwo.canonicalWorkoutToZwoXml(cw2);
        // After the first serialize/parse cycle, the form is a fixpoint.
        expect(xml3).toBe(xml2);
        expect(cw2).toEqual(cw1);
      }),
      { numRuns: 200 },
    );
  });
});
