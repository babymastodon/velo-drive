import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {CanonicalWorkout} from "../../src/core/model.js";
import {canonicalizeTrainerDaySegments} from "../../src/core/scrapers.js";
import {getRawCadence, segDurationSec} from "../../src/core/segments.js";

export interface DemoSample {
  t: number;
  power: number;
  hr: number;
  cadence: number;
  targetPower: number;
  /** True only for the sparse, intentional deviations used to avoid a perfect trace. */
  isGap: boolean;
}

interface SegmentAtTime {
  startPct: number;
  endPct: number;
  durationSec: number;
  elapsedSec: number;
  cadence: number | null;
}

function hashUnit(value: number): number {
  // A stable integer hash mapped to [0, 1). This is deliberately not random:
  // documentation captures must be byte-for-byte repeatable.
  let x = (value + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 0x1_0000_0000;
}

function segmentAt(workout: CanonicalWorkout, t: number): SegmentAtTime {
  let cursor = 0;
  const segments = workout.rawSegments ?? [];
  for (const raw of segments) {
    const durationSec = segDurationSec(Number(raw[0]) || 0);
    if (t < cursor + durationSec) {
      return {
        startPct: Number(raw[1]) || 0,
        endPct: raw[2] == null ? Number(raw[1]) || 0 : Number(raw[2]),
        durationSec,
        elapsedSec: Math.max(0, t - cursor),
        cadence: getRawCadence(raw),
      };
    }
    cursor += durationSec;
  }

  const last = segments.at(-1);
  return {
    startPct: last ? Number(last[2] ?? last[1]) || 0 : 0,
    endPct: last ? Number(last[2] ?? last[1]) || 0 : 0,
    durationSec: 1,
    elapsedSec: 0,
    cadence: getRawCadence(last),
  };
}

export function workoutDurationSec(workout: CanonicalWorkout): number {
  return (workout.rawSegments ?? []).reduce(
    (sum, raw) => sum + segDurationSec(Number(raw[0]) || 0),
    0,
  );
}

export function workoutTargetAt(
  workout: CanonicalWorkout,
  ftp: number,
  t: number,
): {power: number; cadence: number} {
  const seg = segmentAt(workout, t);
  const fraction = seg.durationSec > 1 ? seg.elapsedSec / (seg.durationSec - 1) : 0;
  const pct = seg.startPct + (seg.endPct - seg.startPct) * Math.max(0, Math.min(1, fraction));
  const power = Math.max(0, (pct / 100) * ftp);
  const inferredCadence = 86 + Math.max(0, Math.min(10, (pct - 50) * 0.2));
  return {power, cadence: seg.cadence ?? inferredCadence};
}

/**
 * Produce human-looking, deterministic trainer samples for screenshots.
 *
 * Power stays close to the workout target (normally inside +/-3%) with three
 * short, clearly bounded deviations. Heart rate is driven by a smoothed power
 * load with slower recovery than rise, mild cardiac drift, and low-amplitude
 * sensor noise. It therefore does not jump when a short interval starts.
 */
export function generateDemoTelemetry(
  workout: CanonicalWorkout,
  ftp: number,
  durationSec = workoutDurationSec(workout),
): DemoSample[] {
  const fullDurationSec = workoutDurationSec(workout);
  const requestedSec = Math.max(1, Math.min(fullDurationSec, Math.round(durationSec)));
  const gaps = [
    {start: Math.floor(fullDurationSec * 0.31), duration: 6, scale: 0.88},
    {start: Math.floor(fullDurationSec * 0.59), duration: 4, scale: 1.1},
    {start: Math.floor(fullDurationSec * 0.81), duration: 8, scale: 0.84},
  ];

  let hrState = 96;
  let cadenceState = workoutTargetAt(workout, ftp, 0).cadence;
  const recentPower: number[] = [];
  const samples: DemoSample[] = [];

  // Always model the complete ride, then take the requested prefix. That keeps
  // gaps, cardiac drift, and delayed responses on the same timeline whether a
  // capture shows 20 minutes or a history file contains the whole workout.
  for (let t = 0; t < fullDurationSec; t += 1) {
    const target = workoutTargetAt(workout, ftp, t);
    const fineNoise =
      Math.sin(t * 0.47) * 0.009 +
      Math.sin(t * 0.071 + 1.7) * 0.006 +
      (hashUnit(t * 17 + 11) - 0.5) * 0.012;
    const gap = gaps.find((candidate) => t >= candidate.start && t < candidate.start + candidate.duration);
    const power = Math.max(0, Math.round(target.power * (1 + fineNoise) * (gap?.scale ?? 1)));

    // HR reacts to the work the rider is actually doing, not directly to the
    // prescribed target. The asymmetric time constants model faster exertion
    // response and slower recovery; drift adds up to ~5 bpm over a full ride.
    recentPower.push(power);
    if (recentPower.length > 10) recentPower.shift();
    const delayedPower = recentPower.reduce((sum, value) => sum + value, 0) / recentPower.length;
    const intensity = ftp > 0 ? Math.max(0, Math.min(1.35, delayedPower / ftp)) : 0;
    const drift = 5 * (t / Math.max(1, fullDurationSec - 1));
    const desiredHr = 90 + 68 * Math.pow(intensity, 0.85) + drift;
    const tau = desiredHr >= hrState ? 28 : 48;
    hrState += (desiredHr - hrState) / tau;
    const hrNoise =
      Math.sin(t / 9.7) * 0.85 +
      Math.sin(t / 23.1 + 0.8) * 0.65 +
      (hashUnit(t * 29 + 7) - 0.5) * 0.8;
    const hr = Math.round(Math.max(88, Math.min(190, hrState + hrNoise)));

    // Cadence cannot jump to a new prescription in one sample. A short,
    // asymmetric slew lets it build over a sprint and settle more gradually
    // afterward, with only low-amplitude sensor/rider variation on top.
    const cadenceTau = target.cadence >= cadenceState ? 4 : 6;
    cadenceState += (target.cadence - cadenceState) / cadenceTau;
    const cadenceNoise =
      Math.sin(t * 0.33) * 0.9 + (hashUnit(t * 13 + 3) - 0.5) * 1.2;
    const cadence = Math.round(Math.max(55, Math.min(120, cadenceState + cadenceNoise)));

    samples.push({
      // FIT timer time is measured from ride start; the first one-second
      // sample is at t=1 and the last sample lands exactly on total elapsed.
      t: t + 1,
      power,
      hr,
      cadence,
      targetPower: Math.round(target.power),
      isGap: Boolean(gap),
    });
  }
  return samples.slice(0, requestedSec);
}

/**
 * Load the TrainerDay data fetched by scripts/download-docs-workouts.mjs.
 */
export function buildViolatorWorkout(): CanonicalWorkout {
  const downloadPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".tmp",
    "docs",
    "trainerday-violator.json",
  );
  let downloaded: {
    source?: unknown;
    sourceURL?: unknown;
    workoutTitle?: unknown;
    description?: unknown;
    segments?: unknown;
  };
  try {
    downloaded = JSON.parse(readFileSync(downloadPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${downloadPath}. Run npm run docs:screenshots to fetch the documentation workout.`,
      {cause: error},
    );
  }

  const rawSegments = canonicalizeTrainerDaySegments(downloaded.segments);
  if (
    downloaded.source !== "TrainerDay" ||
    downloaded.sourceURL !== "https://app.trainerday.com/workouts/violator" ||
    downloaded.workoutTitle !== "Violator" ||
    !rawSegments.length
  ) {
    throw new Error(`Invalid TrainerDay documentation workout at ${downloadPath}`);
  }

  return {
    source: downloaded.source,
    sourceURL: downloaded.sourceURL,
    workoutTitle: downloaded.workoutTitle,
    description: typeof downloaded.description === "string" ? downloaded.description : "",
    rawSegments,
    textEvents: [],
  };
}
