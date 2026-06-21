// importers.ts
//
// Bulk workout importers that fan out over a site's listing + workout pages and
// return CanonicalWorkouts annotated with a target `sourcePath` (folder + file).
// The fetch seam (core/net.ts) routes through the browser in the PWA (CORS
// permitting) and native Rust in the app (no CORS) — so the heavier crawls
// (WhatsOnZwift) work best in the desktop app.

import { httpGetText } from './net.js';
import { canonicalizeTrainerDaySegments, buildWhatsOnZwiftCanonical } from './scrapers.js';
import type { CanonicalWorkout } from './model.js';

export type ImportProgress = (message: string) => void;

const TRAINERDAY_SEARCH =
  'https://app.api.trainerday.com/api/workout/search?s=&type=0&myLibrary=0&sortBy=popularity&structure=blocks';
const WHATSONZWIFT_SEARCH =
  'https://whatsonzwift.com/search?sport=all&d=all&sp=all&l=all&z=all&k=&s=relevance&o%5Bzc%5D=1&o%5Bzw%5D=1&o%5Bzf%5D=1&o%5Bc%5D=1';

/** Filesystem-safe path segment (no slashes / reserved chars), capped. */
function safeSeg(s: string): string {
  return (
    (s || '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'workout'
  );
}

function stripHtml(s: unknown): string {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
  return out;
}

// --------------------------- TrainerDay (by popularity) ---------------------------

interface TdItem {
  id?: number;
  _id?: string;
  slug?: string;
  title?: string;
  description?: string;
  _segmentsBackup?: unknown;
}

/**
 * The TrainerDay search API returns workouts (with inline segments) sorted by
 * popularity, paginated. We page through it until we have `limit` usable
 * workouts or the API runs out. No per-workout fetch is needed.
 */
export async function fetchTrainerDayPopular(
  limit: number,
  onProgress?: ImportProgress,
): Promise<CanonicalWorkout[]> {
  const out: CanonicalWorkout[] = [];
  const seen = new Set<string>();
  const pageSize = Math.min(500, Math.max(1, limit));
  let page = 0;
  // Hard cap on pages so a quirk can't loop forever (40k workouts / 500).
  for (let guard = 0; out.length < limit && guard < 200; guard += 1, page += 1) {
    const url = `${TRAINERDAY_SEARCH}&pageNumber=${page}&pageSize=${pageSize}`;
    let res;
    try {
      res = await httpGetText(url);
    } catch {
      break;
    }
    if (!res.ok) break;
    let data: { items?: TdItem[]; hasMore?: boolean };
    try {
      data = JSON.parse(res.text);
    } catch {
      break;
    }
    const items = data.items || [];
    if (!items.length) break;
    for (const it of items) {
      if (out.length >= limit) break;
      const key = String(it.id ?? it._id ?? it.slug ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const rawSegments = canonicalizeTrainerDaySegments(it._segmentsBackup);
      if (!rawSegments.length) continue;
      const title = (it.title || '').trim() || 'TrainerDay Workout';
      out.push({
        source: 'TrainerDay',
        sourceURL: it.slug ? `https://app.trainerday.com/workouts/${it.slug}` : '',
        workoutTitle: title,
        rawSegments,
        description: stripHtml(it.description),
        textEvents: [],
        sourcePath: `TrainerDay/${safeSeg(title)}.zwo`,
      });
    }
    onProgress?.(`Fetched ${out.length} workouts…`);
    if (!data.hasMore) break;
  }
  return out;
}

// --------------------------- WhatsOnZwift (every workout) ---------------------------

/** Collect distinct /workouts/<collection>/<slug> links from a parsed page. */
function workoutLinks(doc: Document): { collection: string; slug: string }[] {
  const seen = new Set<string>();
  const out: { collection: string; slug: string }[] = [];
  for (const a of Array.from(doc.querySelectorAll('a[href*="/workouts/"]'))) {
    const href = (a.getAttribute('href') || '').split('#')[0]!.replace(/\/+$/, '');
    const m = href.match(/\/workouts\/([a-z0-9-]+)\/([a-z0-9-]+)$/i);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ collection: m[1]!, slug: m[2]! });
  }
  return out;
}

/**
 * WhatsOnZwift has no API; its search page lists every workout (server-rendered,
 * ~30/page). We page through it to enumerate all workout URLs, then fetch each
 * workout page for its segments + display name (the page `<h1>`). The folder is
 * the collection slug. This is a large crawl (~3k pages) — best in the app.
 */
export async function fetchWhatsOnZwiftAll(
  onProgress?: ImportProgress,
): Promise<CanonicalWorkout[]> {
  // 1) Enumerate every workout URL via the paginated search results.
  const all = new Map<string, { collection: string; slug: string }>();
  for (let page = 1; page <= 400; page += 1) {
    const res = await httpGetText(`${WHATSONZWIFT_SEARCH}&page=${page}`);
    if (!res.ok) break;
    const doc = new DOMParser().parseFromString(res.text, 'text/html');
    const links = workoutLinks(doc);
    let added = 0;
    for (const l of links) {
      const k = `${l.collection}/${l.slug}`;
      if (!all.has(k)) {
        all.set(k, l);
        added += 1;
      }
    }
    onProgress?.(`Found ${all.size} workouts (page ${page})…`);
    // Stop when a page contributes nothing new (past the last results page).
    if (added === 0) break;
  }

  // 2) Fetch each workout page for its segments + name (limited concurrency).
  const list = Array.from(all.values());
  let done = 0;
  const results = await mapLimit(list, 5, async ({ collection, slug }) => {
    const url = `https://whatsonzwift.com/workouts/${collection}/${slug}`;
    try {
      const res = await httpGetText(url);
      done += 1;
      if (done % 10 === 0 || done === list.length) {
        onProgress?.(`Imported ${done}/${list.length} workouts…`);
      }
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(res.text, 'text/html');
      const [canonical] = buildWhatsOnZwiftCanonical(doc, url);
      if (!canonical) return null;
      const h1 = doc.querySelector('h1')?.textContent?.trim();
      const name = h1 || canonical.workoutTitle || slug;
      canonical.workoutTitle = name;
      canonical.sourcePath = `WhatsOnZwift/${safeSeg(collection)}/${safeSeg(name)}.zwo`;
      return canonical;
    } catch {
      done += 1;
      return null;
    }
  });
  return results.filter((c): c is CanonicalWorkout => !!c);
}
