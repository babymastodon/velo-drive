import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(WEB_ROOT, ".tmp", "docs", "trainerday-violator.json");
const WORKOUT_URL = "https://app.trainerday.com/workouts/violator";
const API_URL = "https://app.api.trainerday.com/api/workouts/bySlug/violator";

async function downloadViolator() {
  const response = await fetch(API_URL, {
    headers: {accept: "application/json"},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`TrainerDay returned HTTP ${response.status} for ${API_URL}`);
  }

  const details = await response.json();
  if (
    details?.slug !== "violator" ||
    details?.title !== "Violator" ||
    !Array.isArray(details?.segments) ||
    details.segments.length < 100
  ) {
    throw new Error("TrainerDay returned unexpected data for the Violator workout.");
  }

  return {
    source: "TrainerDay",
    sourceURL: WORKOUT_URL,
    workoutTitle: details.title,
    description: typeof details.description === "string" ? details.description : "",
    segments: details.segments,
  };
}

const workout = await downloadViolator();
await mkdir(dirname(OUTPUT_PATH), {recursive: true});
await writeFile(OUTPUT_PATH, `${JSON.stringify(workout)}\n`, "utf8");
process.stdout.write(
  `Downloaded ${workout.workoutTitle} from TrainerDay (${workout.segments.length} segments).\n`,
);
