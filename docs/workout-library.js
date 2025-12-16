// workout-library.js
// Helpers for loading canonical workouts from the local ZWO library.

import { loadZwoDirHandle } from "./storage.js";
import { parseZwoXmlToCanonicalWorkout } from "./zwo.js";

export async function loadWorkoutFile(entry) {
  if (!entry || !entry.workoutTitle) return entry;
  try {
    const dir = await loadZwoDirHandle();
    if (!dir) {
      entry.missing = true;
      return entry;
    }
    const fileName =
      (entry.fileName && entry.fileName.endsWith(".zwo")
        ? entry.fileName
        : `${encodeURIComponent(entry.workoutTitle || entry.fileName || "")}.zwo`) ||
      "";
    const handle = await dir.getFileHandle(fileName, { create: false });
    const file = await handle.getFile();
    const text = await file.text();
    const canonical = parseZwoXmlToCanonicalWorkout(text) || {};
    const enrichedCanonical = {
      ...canonical,
      workoutTitle: canonical.workoutTitle || entry.workoutTitle,
      fileName,
    };
    const rawSegments = enrichedCanonical.rawSegments || [];
    entry.rawSegments = rawSegments;
    entry.canonical = enrichedCanonical;
    entry.workoutTitle = enrichedCanonical.workoutTitle;
    entry.fileName = fileName;
    entry.source = enrichedCanonical.source;
    entry.sourceURL = enrichedCanonical.sourceURL;
    entry.description = enrichedCanonical.description;
    entry.missing = false;
  } catch (_err) {
    entry.missing = true;
  }
  return entry;
}
