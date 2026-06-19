// core/scrapers.ts
//
// Pure TypeScript port of the TrainerDay-URL scraper from docs/scrapers.js. Turns
// a TrainerDay workout URL into a CanonicalWorkout. Uses the global `fetch`
// (the e2e/unit harness can stub it). Returns a [workout, errorMessage] tuple:
//   - on success: [canonical, null]
//   - on failure: [null, "user-friendly error message"]
//
// Only the TrainerDay path is ported here (the picker's "Import TrainerDay"
// button). The TrainerRoad / WhatsOnZwift page scrapers are page-context-only and
// are not used by the re-hosted picker.

import type { CanonicalWorkout, RawSegment } from './model.js';

const TRAINERDAY_WORKOUT_REGEX = /^\/workouts\/([^/?#]+)/;

/** Tuple returned by every scraper: [workout, null] | [null, errorMessage]. */
export type ScrapeResult = [CanonicalWorkout | null, string | null];

interface FetchError extends Error {
  status?: number;
  url?: string;
  isCorsError?: boolean;
  isNetworkError?: boolean;
  cause?: unknown;
}

/**
 * fetchJson with basic CORS / offline detection (mirrors docs/scrapers.js). HTTP
 * errors carry a `status`; CORS/offline failures carry `isCorsError`/`isNetworkError`.
 */
async function fetchJson(url: string, options: RequestInit = {}): Promise<unknown> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as FetchError;
      err.status = res.status;
      err.url = url;
      throw err;
    }
    try {
      return await res.json();
    } catch (jsonErr) {
      const err = new Error('Invalid JSON') as FetchError;
      err.url = url;
      err.cause = jsonErr;
      throw err;
    }
  } catch (err) {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (err instanceof TypeError && online) {
      const corsErr = new Error(
        'Request was blocked by the browser (CORS / site access).',
      ) as FetchError;
      corsErr.isCorsError = true;
      corsErr.url = url;
      throw corsErr;
    }
    if (err instanceof TypeError && !online) {
      const netErr = new Error('Network request failed (offline).') as FetchError;
      netErr.isNetworkError = true;
      netErr.url = url;
      throw netErr;
    }
    throw err;
  }
}

async function fetchTrainerDayWorkoutBySlug(slug: string): Promise<unknown> {
  const url = `https://app.api.trainerday.com/api/workouts/bySlug/${encodeURIComponent(slug)}`;
  return fetchJson(url, { credentials: 'omit' });
}

/** Plain-text-ify HTML descriptions (mirrors docs/scrapers.js toPlainText). */
function toPlainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert TrainerDay segments into canonical [minutes, startPower, endPower, type?, cadenceRpm?].
 * TrainerDay segments are typically [minutes, startPct, endPct?, cadence?, ...].
 */
function canonicalizeTrainerDaySegments(segments: unknown): RawSegment[] {
  if (!Array.isArray(segments)) return [];
  const out: RawSegment[] = [];
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const minutes = Number(seg[0]);
    const start = Number(seg[1]);
    const end = seg.length > 2 && seg[2] != null ? Number(seg[2]) : start;
    const cadence = seg.length > 3 && seg[3] != null ? Number(seg[3]) : null;
    const cadenceRpm = Number.isFinite(cadence as number) ? Math.round(cadence as number) : null;
    if (
      Number.isFinite(minutes) &&
      minutes > 0 &&
      Number.isFinite(start) &&
      Number.isFinite(end)
    ) {
      if (cadenceRpm != null) {
        out.push([minutes, start, end, null, cadenceRpm]);
      } else {
        out.push([minutes, start, end]);
      }
    }
  }
  return out;
}

function getTrainerDaySlugFromPath(path: string): string | null {
  const match = path.match(TRAINERDAY_WORKOUT_REGEX);
  return match && match[1] ? match[1] : null;
}

async function importTrainerDayFromPathAndSource(
  path: string,
  sourceURL: string,
): Promise<ScrapeResult> {
  const slug = getTrainerDaySlugFromPath(path || '');
  if (!slug) {
    return [null, 'This TrainerDay link does not look like a workout page.'];
  }

  let details: { segments?: unknown; title?: string; description?: string } | undefined;
  try {
    details = (await fetchTrainerDayWorkoutBySlug(slug)) as typeof details;
  } catch (e) {
    const err = e as FetchError;
    console.error('[VeloDrive][TrainerDay] fetch error:', err);
    if (err && err.isCorsError) {
      return [
        null,
        'TrainerDay blocked this request. In Chrome, allow VeloDrive access to trainerday.com in Extensions → Site Access.',
      ];
    }
    if (err && err.isNetworkError) {
      return [null, 'You appear to be offline. Check your connection and try again.'];
    }
    if (err && err.status) {
      const status = Number(err.status);
      if (status === 404) return [null, 'TrainerDay could not find that workout (404).'];
      if (status === 401 || status === 403) {
        return [null, 'TrainerDay blocked access to that workout (permission denied).'];
      }
      if (status === 429) return [null, 'TrainerDay rate limited this request. Try again soon.'];
      if (status >= 500) return [null, 'TrainerDay server error. Try again later.'];
      return [null, `TrainerDay returned an error (${status}).`];
    }
    if (err && err.message === 'Invalid JSON') {
      return [
        null,
        'TrainerDay returned unexpected data. Try again or use a different workout.',
      ];
    }
    return [null, 'VeloDrive couldn’t load this TrainerDay workout.'];
  }

  const rawSegments = canonicalizeTrainerDaySegments(
    Array.isArray(details?.segments) ? details?.segments : [],
  );
  if (!rawSegments.length) {
    return [
      null,
      'This TrainerDay workout doesn’t have any intervals that VeloDrive can use.',
    ];
  }

  const canonical: CanonicalWorkout = {
    source: 'TrainerDay',
    sourceURL,
    workoutTitle: details?.title || 'TrainerDay Workout',
    rawSegments,
    description: toPlainText(details?.description || ''),
    textEvents: [],
  };
  return [canonical, null];
}

/**
 * Parse a TrainerDay workout URL into a CanonicalWorkout tuple. Pure: depends
 * only on the global `fetch` (stubbable in tests).
 */
export async function parseTrainerDayUrl(urlString: string): Promise<ScrapeResult> {
  if (!urlString || typeof urlString !== 'string') {
    return [null, 'Please enter a TrainerDay workout URL.'];
  }
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return [null, 'That does not look like a valid URL.'];
  }
  if (!url.hostname.includes('trainerday.com')) {
    return [null, 'Please enter a TrainerDay workout URL.'];
  }
  return importTrainerDayFromPathAndSource(url.pathname, url.toString());
}
