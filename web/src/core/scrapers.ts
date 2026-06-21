// core/scrapers.ts
//
// The TrainerDay-URL scraper. Turns a TrainerDay workout URL into a
// CanonicalWorkout. Uses the global `fetch` (the e2e/unit harness can stub it).
// Returns a [workout, errorMessage] tuple:
//   - on success: [canonical, null]
//   - on failure: [null, "user-friendly error message"]
//
// Only the TrainerDay path lives here (the picker's "Import TrainerDay" button).

import type { CanonicalWorkout, RawSegment } from './model.js';
import { httpGetText, type HttpResult } from './net.js';

const TRAINERDAY_WORKOUT_REGEX = /^\/workouts\/([^/?#]+)/;
const WHATSONZWIFT_WORKOUT_REGEX = /^\/workouts\/.+/;

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
 * fetchJson with basic CORS / offline detection. HTTP errors carry a `status`;
 * CORS/offline failures carry `isCorsError`/`isNetworkError`.
 */
/** GET as text, mapping a browser CORS/offline TypeError to a tagged error. */
async function fetchText(url: string): Promise<HttpResult> {
  try {
    return await httpGetText(url);
  } catch (err) {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (err instanceof TypeError && online) {
      const corsErr = new Error('Request was blocked by the browser (CORS / cross-origin).') as FetchError;
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

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetchText(url);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`) as FetchError;
    err.status = r.status;
    err.url = url;
    throw err;
  }
  try {
    return JSON.parse(r.text);
  } catch (jsonErr) {
    const err = new Error('Invalid JSON') as FetchError;
    err.url = url;
    err.cause = jsonErr;
    throw err;
  }
}

async function fetchTrainerDayWorkoutBySlug(slug: string): Promise<unknown> {
  const url = `https://app.api.trainerday.com/api/workouts/bySlug/${encodeURIComponent(slug)}`;
  return fetchJson(url);
}

/** Plain-text-ify HTML descriptions. */
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
        'TrainerDay blocked this request (CORS). Download the workout as a .zwo file and import it instead.',
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

// ---------------- WhatsOnZwift (server-rendered HTML → CanonicalWorkout) ------

function extractWozTitle(doc: Document): string {
  return doc.querySelector('header.my-8 h1')?.textContent?.trim() || 'WhatsOnZwift Workout';
}

function extractWozDescription(doc: Document): string {
  const ul = doc.querySelector('ul.items-baseline');
  let el = ul?.previousElementSibling ?? null;
  while (el) {
    if (el.tagName.toLowerCase() === 'p') return el.textContent?.trim() || '';
    el = el.previousElementSibling;
  }
  return '';
}

interface WozSeg {
  minutes: number;
  startPct: number;
  endPct: number;
  cadence: number | null;
}

/** Parse the WhatsOnZwift workout bars (e.g. "5x 4min @ 72% FTP, 2min @ 52% FTP"). */
function extractWozSegments(doc: Document): WozSeg[] {
  const container = doc.querySelector('div.order-2');
  if (!container) return [];
  const segments: WozSeg[] = [];
  for (const bar of Array.from(container.querySelectorAll('.textbar'))) {
    const text = (bar.textContent || '').replace(/\s+/g, ' ').trim();
    const powSpans = bar.querySelectorAll('span[data-unit="relpow"][data-value]');

    // Interval sets: "Nx <on> @ p%, <off> @ p%".
    const repMatch = text.match(/(\d+)\s*x\b/i);
    if (repMatch && powSpans.length >= 2) {
      const reps = parseInt(repMatch[1] ?? '', 10);
      const durations = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(min|sec)/gi))
        .map((m) => {
          const val = parseFloat(m[1] ?? '');
          if (!Number.isFinite(val)) return null;
          return (m[2] ?? '').toLowerCase() === 'sec' ? val / 60 : val;
        })
        .filter((v): v is number => v != null);
      if (Number.isFinite(reps) && reps > 0 && durations.length >= 2) {
        const onMinutes = durations[0] as number;
        const offMinutes = durations[1] as number;
        const pOn = Number(powSpans[0]?.getAttribute('data-value'));
        const pOff = Number(powSpans[1]?.getAttribute('data-value'));
        if (onMinutes > 0 && offMinutes > 0 && Number.isFinite(pOn) && Number.isFinite(pOff)) {
          for (let i = 0; i < reps; i++) {
            segments.push({ minutes: onMinutes, startPct: pOn, endPct: pOn, cadence: null });
            segments.push({ minutes: offMinutes, startPct: pOff, endPct: pOff, cadence: null });
          }
          continue;
        }
      }
    }

    // Single bars (steady or ramp), minutes or seconds.
    let minutes: number | null = null;
    const minMatch = text.match(/(\d+)\s*min/i);
    if (minMatch) {
      minutes = Number(minMatch[1]);
    } else {
      const secMatch = text.match(/(\d+)\s*sec/i);
      if (secMatch && Number.isFinite(Number(secMatch[1]))) minutes = Number(secMatch[1]) / 60;
    }
    if (minutes == null || !(minutes > 0)) continue;
    const cadenceMatch = text.match(/@\s*(\d+)\s*rpm/i);
    const cadence = cadenceMatch ? Number(cadenceMatch[1]) : null;

    if (powSpans.length === 1) {
      const pct = Number(powSpans[0]?.getAttribute('data-value'));
      if (Number.isFinite(pct)) segments.push({ minutes, startPct: pct, endPct: pct, cadence });
    } else if (powSpans.length >= 2) {
      const lo = Number(powSpans[0]?.getAttribute('data-value'));
      const hi = Number(powSpans[1]?.getAttribute('data-value'));
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        segments.push({ minutes, startPct: lo, endPct: hi, cadence });
      }
    }
  }
  return segments;
}

function canonicalizeWozSegments(segments: WozSeg[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const s of segments) {
    const minutes = Number(s.minutes);
    const start = Number(s.startPct);
    const end = s.endPct != null ? Number(s.endPct) : start;
    const cadence = Number.isFinite(s.cadence as number) ? Math.round(s.cadence as number) : null;
    if (minutes > 0 && Number.isFinite(start) && Number.isFinite(end)) {
      if (cadence != null) out.push([minutes, start, end, null, cadence]);
      else out.push([minutes, start, end]);
    }
  }
  return out;
}

/** Build a CanonicalWorkout from a parsed WhatsOnZwift workout document. */
export function buildWhatsOnZwiftCanonical(doc: Document, sourceURL: string): ScrapeResult {
  const rawSegments = canonicalizeWozSegments(extractWozSegments(doc));
  if (!rawSegments.length) {
    return [null, 'VeloDrive couldn’t find any intervals on this WhatsOnZwift workout page.'];
  }
  const canonical: CanonicalWorkout = {
    source: 'WhatsOnZwift',
    sourceURL,
    workoutTitle: extractWozTitle(doc),
    rawSegments,
    description: toPlainText(extractWozDescription(doc)),
    textEvents: [],
  };
  return [canonical, null];
}

/** Fetch + parse a WhatsOnZwift workout URL into a CanonicalWorkout tuple. */
export async function parseWhatsOnZwiftUrl(urlString: string): Promise<ScrapeResult> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return [null, 'That does not look like a valid URL.'];
  }
  if (!url.hostname.includes('whatsonzwift.com')) {
    return [null, 'Please enter a WhatsOnZwift workout URL.'];
  }
  if (!WHATSONZWIFT_WORKOUT_REGEX.test(url.pathname)) {
    return [null, 'This doesn’t look like a WhatsOnZwift workout page.'];
  }
  if (typeof DOMParser === 'undefined') {
    return [null, 'WhatsOnZwift import isn’t available here.'];
  }
  let html: string;
  try {
    const r = await fetchText(url.toString());
    if (!r.ok) return [null, `WhatsOnZwift returned an error (${r.status}).`];
    html = r.text;
  } catch (e) {
    const err = e as FetchError;
    if (err?.isCorsError) {
      return [null, 'WhatsOnZwift blocked this request (CORS). The desktop app can import it directly.'];
    }
    if (err?.isNetworkError) {
      return [null, 'You appear to be offline. Check your connection and try again.'];
    }
    return [null, 'VeloDrive couldn’t load this WhatsOnZwift workout.'];
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return buildWhatsOnZwiftCanonical(doc, url.toString());
  } catch {
    return [null, 'VeloDrive couldn’t read this WhatsOnZwift workout.'];
  }
}

/** Dispatch a workout URL to the right scraper by host (TrainerDay or WhatsOnZwift). */
export async function parseWorkoutUrl(urlString: string): Promise<ScrapeResult> {
  if (!urlString || typeof urlString !== 'string') {
    return [null, 'Please enter a workout URL.'];
  }
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return [null, 'That does not look like a valid URL.'];
  }
  const host = url.hostname.toLowerCase();
  if (host.includes('trainerday.com')) {
    return importTrainerDayFromPathAndSource(url.pathname, url.toString());
  }
  if (host.includes('whatsonzwift.com')) {
    return parseWhatsOnZwiftUrl(url.toString());
  }
  return [null, 'Paste a TrainerDay or WhatsOnZwift workout URL.'];
}
