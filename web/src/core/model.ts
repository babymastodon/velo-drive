// model.ts
//
// TypeScript types for the canonical workout representation.
//
// These types describe the SAME runtime data shape the legacy vanilla-JS code
// (docs/zwo.js, docs/workout-metrics.js, docs/fit-file.js) produces. They are
// types only — they introduce no runtime shape changes, so differential
// equality between the legacy modules and the ported TypeScript modules holds.

/**
 * The legacy positional segment tuple:
 *   [minutes, startPct, endPct, type?, cadence?]
 *
 * - minutes:  duration in minutes (float allowed)
 * - startPct: % FTP (or "start power"), usually 0–100
 * - endPct:   % FTP (or "end power"), usually 0–100
 * - type:     optional string flag (e.g. "freeride"). In serialized cadence
 *             segments this slot may be `null` (a placeholder before cadence).
 * - cadence:  optional cadence target (rpm)
 *
 * The legacy producers emit tuples of varying length (3, 4, or 5 elements);
 * this type captures all the observed runtime shapes without forcing a length.
 */
export type RawSegment =
  | [minutes: number, startPct: number, endPct: number]
  | [minutes: number, startPct: number, endPct: number, type: string]
  | [
      minutes: number,
      startPct: number,
      endPct: number,
      type: string | null,
      cadence: number,
    ];

/**
 * A text event aligned to the workout timeline.
 */
export interface TextEvent {
  offsetSec: number;
  durationSec: number;
  text: string;
}

/**
 * Canonical representation of a scraped/authored workout.
 *
 * Mirrors the object produced by parseZwoXmlToCanonicalWorkout and consumed by
 * canonicalWorkoutToZwoXml in the legacy code.
 */
export interface CanonicalWorkout {
  /** e.g. "TrainerRoad" | "TrainerDay" | "WhatsOnZwift" | "Unknown" */
  source: string;
  /** Original workout page URL */
  sourceURL: string;
  /** Human-readable workout title */
  workoutTitle: string;
  /** Canonical positional segments */
  rawSegments: RawSegment[];
  /** Human-readable description/notes */
  description: string;
  /** Optional text events aligned to workout timeline */
  textEvents?: TextEvent[];
}

/**
 * A higher-level workout view. Kept minimal; the canonical positional form
 * (CanonicalWorkout) is the load-bearing runtime shape in M1.
 */
export interface Segment {
  durationSec: number;
  pStartRel: number;
  pEndRel: number;
  cadenceRpm?: number | null;
  isFreeRide?: boolean;
}

export interface Workout {
  title: string;
  segments: Segment[];
}
