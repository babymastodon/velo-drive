// WebFileStore.ts
//
// IndexedDB "settings" plumbing (the HUD subset). Reads `indexedDB` (and, for
// the history dir, the persisted FSA handles) so the harness fakes drive it.

import type {
  FileStore,
  ActiveState,
  FsDirHandle,
  FsHandle,
} from '../FileStore.js';
import type { CanonicalWorkout } from '../../core/model.js';
import {
  parseZwoXmlToCanonicalWorkout,
  canonicalWorkoutToZwoXml,
} from '../../core/zwo.js';
import { parseFitFile, type ParseFitResult } from '../../core/fit.js';
import type { RawSegment } from '../../core/model.js';
import type { PowerInterval } from '../../core/planner-analysis.js';
import {
  buildHistoryPreview,
  type HistoryPreview,
  type HistoryFitEntry,
} from '../../core/history.js';
import {
  removeScheduledByTitle as removeScheduledByTitleRule,
  moveScheduledEntry as moveScheduledEntryRule,
  type ScheduleEntry,
} from '../../core/schedule.js';

// Re-export the domain types from core so existing importers (UI + tests) keep
// working while the canonical declarations live in core/ (dependency points
// downward).
export type { HistoryPreview, HistoryFitEntry } from '../../core/history.js';
export type { ScheduleEntry } from '../../core/schedule.js';

const DB_NAME = 'velo-drive';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';

// Persisted FIT-metrics cache. Computed previews are keyed by the FIT file name
// so each planner open re-parses only NEW files. Bump the version whenever the
// preview format/computation changes (invalidates the whole cache).
const STATS_CACHE_KEY = 'workoutStatsCache';
const STATS_CACHE_VERSION = 30;

const STORAGE_SELECTED_WORKOUT = 'selectedWorkout';
const STORAGE_ACTIVE_STATE = 'activeWorkoutState';
const STORAGE_LAST_BIKE_DEVICE_ID = 'lastBikeDeviceId';
const STORAGE_LAST_HR_DEVICE_ID = 'lastHrDeviceId';
const WORKOUT_DIR_KEY = 'workoutDirHandle'; // history dir
const ZWO_DIR_KEY = 'dirHandle'; // .zwo workouts library dir
const TRASH_DIR_KEY = 'trashDirHandle';
const ROOT_DIR_KEY = 'rootDirHandle';
const SCHEDULE_FILE = 'schedule.json';

// Marker set before a default-seed pass and cleared only once every default is
// present. Lets an INTERRUPTED seed (tab closed / network blip mid-copy) resume
// and backfill its tail on the next folder pick, instead of being stranded
// because the now-non-empty folder looks "already seeded". See
// maybeSeedDefaultWorkouts.
const SEED_IN_PROGRESS_KEY = 'defaultWorkoutsSeedInProgress';

// The bundled default workout library. On a fresh folder pick, if the workouts/
// dir is empty, every file here is fetched from /workouts/<name> (bundled in
// web/public/workouts) and written into the folder so a new user gets the full
// starter library — short spins through long endurance + free-rides, not an
// arbitrary 60-min-ish subset (41 files).
const DEFAULT_WORKOUT_FILES = [
  'Airforge.zwo',
  'Ashen%20Surge.zwo',
  'Basefire%20Waves.zwo',
  'Blackglass%20Gauntlet.zwo',
  'Breath%20of%20Power.zwo',
  'Breath%20Spark.zwo',
  'Cinder%20Edge.zwo',
  'Crestline%20Endurance.zwo',
  'Deep%20Current.zwo',
  'Dreamwake.zwo',
  'Endless%20Rhythm.zwo',
  'Endurance%20Drift.zwo',
  'Endurance%20Espresso.zwo',
  'Endure%20the%20Climb.zwo',
  'Freeride%2030.zwo',
  'Freeride%2045.zwo',
  'Freeride%2060.zwo',
  'Freeride%2075.zwo',
  'Freeride%2090.zwo',
  'Hard%20Road%2C%20Steady%20Heart.zwo',
  'Into%20the%20Black.zwo',
  'Keep%20Turning.zwo',
  'Long%20Rollers.zwo',
  'Lullaby%20Legs.zwo',
  'Lungfire.zwo',
  'Mellow%20Matchsticks.zwo',
  'Nocturne%20Strain.zwo',
  'Obsidian%20Pulse.zwo',
  'Open%20Road%20Pulse.zwo',
  'Pillow%20Pops.zwo',
  'Quick%20Turn.zwo',
  'Relentless%20Rise.zwo',
  'Rise%20Against%20the%20Odds.zwo',
  'Rolling%20Crests.zwo',
  'Short%20Resolve.zwo',
  'Sleepy%20Spin.zwo',
  'Snooze%20Cruise.zwo',
  'Steady%20Carousel.zwo',
  'Steel%20the%20Line.zwo',
  'Velvet%20Cadence.zwo',
  'Windline.zwo',
];

// The HistoryFitEntry + computed HistoryPreview models now live in
// core/history.ts
// (buildHistoryPreview); WebFileStore keeps the file/cache I/O around it.

// On-disk cache entry (startedAt as ISO string, everything else JSON-friendly).
interface StatsCacheEntry {
  workoutTitle: string;
  durationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  startedAt: string | null;
  rawSegments: RawSegment[];
  powerSegments: PowerInterval[];
  powerMax: number;
  zone: string;
}
interface StatsCache {
  version: number;
  entries: Record<string, StatsCacheEntry>;
}

// ScheduleEntry now lives in core/schedule.ts (re-exported above).

/** Injective title -> file-safe base name. */
function sanitizeZwoFileName(title: string): string {
  return encodeURIComponent(title);
}

interface HandleRecord {
  handle: unknown;
}

// FSA permission surface (present on real FileSystemHandle, faked granted in the
// harness). A persisted handle reloaded from IndexedDB comes back in the
// "prompt" state in a REAL browser, so reads/writes fail until we re-request
// read-write permission. The harness fake always resolves "granted", so this is
// a no-op in tests.
interface FsPermissionHandle {
  queryPermission?(opts: { mode: 'readwrite' | 'read' }): Promise<PermissionState | string>;
  requestPermission?(opts: { mode: 'readwrite' | 'read' }): Promise<PermissionState | string>;
}

/**
 * Re-authorize a persisted directory handle for read-write access: query first,
 * short-circuit on granted/denied, otherwise prompt. Returns true only when
 * read-write access is granted. requestPermission must run in a user gesture in
 * a real browser.
 */
async function ensureDirPermission(handle: unknown): Promise<boolean> {
  const h = handle as FsPermissionHandle | null;
  if (!h || typeof h.queryPermission !== 'function' || typeof h.requestPermission !== 'function') {
    // No permission API (older/unsupported) — assume usable rather than block.
    return true;
  }
  try {
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p === 'granted') return true;
    if (p === 'denied') return false;
    p = await h.requestPermission({ mode: 'readwrite' });
    return p === 'granted';
  } catch (err) {
    console.warn('[WebFileStore] ensureDirPermission failed:', err);
    return false;
  }
}

export class WebFileStore implements FileStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private workoutDirHandle: FsDirHandle | null = null;
  private statsCache: StatsCache | null = null;

  // Test/diagnostic marker: how many FIT files listHistoryPreviews parsed (i.e.
  // cache misses). A second open of an unchanged history should add 0.
  historyParseCount = 0;

  // Optional UI error sink. The composition root wires this to a themed Dialog
  // alert so the important file-op failures (no folder, permission revoked,
  // save/delete failed) surface to the user instead of failing silently. The
  // data-loss guard (overwrite-to-trash-first) is unaffected.
  onError: ((message: string) => void) | null = null;

  private notifyError(message: string): void {
    if (this.onError) {
      try {
        this.onError(message);
      } catch {
        /* never let the notifier break a file op */
      }
    }
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    const db = await this.getDb();
    // De-proxy before persisting. Values arrive as Svelte 5 $state PROXIES (e.g.
    // a selected workout from the picker's $state list, or the active-ride
    // snapshot). A real browser's IDBObjectStore.put runs the structured-clone
    // algorithm, which throws DataCloneError on a Proxy — so the write silently
    // FAILED and the state was lost on reload. Every settings value here is plain
    // JSON-safe data (FSA handles use saveHandle, NOT this path), so a JSON
    // round-trip yields a clone-safe plain object. (The hermetic fake IndexedDB
    // does a plain Map.set with no clone, which is why this slipped past tests.)
    const plain = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, value: plain });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Persist a FileSystemDirectoryHandle. Handles use a DIFFERENT record shape
  // than settings: `{key, handle}` (read back by loadHandle via `record.handle`),
  // NOT `{key, value}`. Writing a handle through setSetting() stores
  // `{key, value:{handle}}`, which loadHandle CANNOT read (record.handle is
  // undefined) — so the picked folder silently failed to persist. This matches
  // the harness seed shape (page-env: store[key] = {handle}).
  private async saveHandle(key: string, handle: unknown): Promise<void> {
    const db = await this.getDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, handle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async getSettingRaw<T>(key: string, defaultValue: T): Promise<T> {
    const db = await this.getDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(SETTINGS_STORE).get(key);
      req.onsuccess = () => {
        const record = req.result as { value?: T } | undefined;
        if (!record || !('value' in record)) resolve(defaultValue);
        else resolve(record.value as T);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async loadHandle(key: string): Promise<unknown | null> {
    const db = await this.getDb();
    return new Promise<unknown | null>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(SETTINGS_STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as HandleRecord | undefined;
        resolve(rec ? rec.handle : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- public API ----------

  getSetting<T>(key: string, defaultValue: T): Promise<T> {
    return this.getSettingRaw(key, defaultValue);
  }

  putSetting(key: string, value: unknown): Promise<void> {
    return this.setSetting(key, value);
  }

  async loadRootDirHandle(): Promise<FsDirHandle | null> {
    return (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
  }

  async pickRootDir(): Promise<FsDirHandle | null> {
    const picker = (globalThis as unknown as {
      showDirectoryPicker?: () => Promise<FsDirHandle>;
    }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      this.notifyError('Selecting a data folder requires File System Access support.');
      return null;
    }
    try {
      const root = await picker();
      // Re-authorize read-write before touching the folder. In a real browser
      // showDirectoryPicker() grants on selection, but be explicit.
      const ok = await ensureDirPermission(root);
      if (!ok) {
        this.notifyError('Permission was not granted to the selected folder.');
        return null;
      }
      // Persist the root + the three standard subdir handles so they survive a
      // reload. Persisting the subdir handles (not just root) avoids re-deriving
      // them every load.
      await this.saveHandle(ROOT_DIR_KEY, root);
      const workouts = await root.getDirectoryHandle('workouts', { create: true });
      const history = await root.getDirectoryHandle('history', { create: true });
      const trash = await root.getDirectoryHandle('trash', { create: true });
      // Seed the bundled default workouts when the library is empty, so a fresh
      // user never lands on an empty picker.
      if (await ensureDirPermission(workouts)) {
        await this.maybeSeedDefaultWorkouts(workouts);
      }
      await this.saveHandle(ZWO_DIR_KEY, workouts);
      await this.saveHandle(WORKOUT_DIR_KEY, history);
      await this.saveHandle(TRASH_DIR_KEY, trash);
      this.workoutDirHandle = history;
      return root;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return null;
      console.error('[WebFileStore] Failed to choose root folder:', err);
      this.notifyError('Failed to choose folder.');
      return null;
    }
  }

  /**
   * If the workouts dir has no .zwo files, copy the bundled defaults in. Returns
   * the number of files copied.
   */
  protected async maybeSeedDefaultWorkouts(dir: FsDirHandle): Promise<number> {
    const empty = !(await this.directoryHasAnyZwoFiles(dir));
    const inProgress = await this.getSettingRaw<boolean>(SEED_IN_PROGRESS_KEY, false);
    // Seed a fresh (empty) library, OR resume a previously-interrupted seed whose
    // tail never landed (the folder has SOME .zwo but a prior pass didn't finish
    // — this is what stranded late-alphabet defaults like "Sleepy Spin"). A
    // non-empty folder with no in-progress marker is treated as the user's own
    // library and left untouched (respects deleted defaults).
    if (!empty && !inProgress) return 0;

    await this.setSetting(SEED_IN_PROGRESS_KEY, true);
    const copied = await this.copyDefaultWorkoutsToDir(dir);
    // Clear the marker only once every default is actually present, so a partial
    // failure retries + backfills on the next pick rather than being stranded.
    if (await this.allDefaultsPresent(dir)) {
      await this.setSetting(SEED_IN_PROGRESS_KEY, false);
    }
    return copied;
  }

  private async allDefaultsPresent(dir: FsDirHandle): Promise<boolean> {
    for (const fileName of DEFAULT_WORKOUT_FILES) {
      try {
        await dir.getFileHandle(fileName, { create: false });
      } catch {
        return false;
      }
    }
    return true;
  }

  private async directoryHasAnyZwoFiles(dir: FsDirHandle): Promise<boolean> {
    try {
      for await (const entry of dir.values() as AsyncIterable<FsHandle>) {
        if (entry.kind !== 'file') continue;
        if (entry.name.toLowerCase().endsWith('.zwo')) return true;
      }
    } catch (err) {
      console.error('[WebFileStore] Failed to inspect workouts folder:', err);
    }
    return false;
  }

  private async copyDefaultWorkoutsToDir(dir: FsDirHandle): Promise<number> {
    // Copy in bounded-parallel rather than one-at-a-time: 41 sequential
    // fetch+write round-trips left a multi-second window in which an interrupt
    // stranded the tail (and a concurrent listWorkouts saw a partial library).
    // Idempotent — a file that already exists is skipped, so this also serves as
    // the backfill path for a resumed seed.
    const CONCURRENCY = 6;
    const queue = [...DEFAULT_WORKOUT_FILES];
    let copied = 0;

    const copyOne = async (fileName: string): Promise<void> => {
      // Skip a file that already exists (create:false probe).
      try {
        await dir.getFileHandle(fileName, { create: false });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name !== 'NotFoundError') {
          console.error('[WebFileStore] Could not check workout file:', err);
          return;
        }
      }
      try {
        // The bundled .zwo live in web/public/workouts; the file names are
        // already URL-encoded on disk, so encodeURI leaves "%20" intact.
        const resp = await fetch(`/workouts/${encodeURI(fileName)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        copied += 1; // single-threaded between awaits — increment is safe
      } catch (err) {
        console.error(`[WebFileStore] Failed to copy default workout "${fileName}":`, err);
      }
    };

    const worker = async (): Promise<void> => {
      for (let fileName = queue.shift(); fileName; fileName = queue.shift()) {
        await copyOne(fileName);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
    );
    return copied;
  }

  async loadSelectedWorkout(): Promise<CanonicalWorkout | null> {
    return this.getSettingRaw<CanonicalWorkout | null>(STORAGE_SELECTED_WORKOUT, null);
  }

  async loadBleDeviceIds(): Promise<{ bikeId: string | null; hrId: string | null }> {
    const bikeId = await this.getSettingRaw<string | null>(STORAGE_LAST_BIKE_DEVICE_ID, null);
    const hrId = await this.getSettingRaw<string | null>(STORAGE_LAST_HR_DEVICE_ID, null);
    return { bikeId, hrId };
  }

  async loadActiveState(): Promise<ActiveState | null> {
    return this.getSettingRaw<ActiveState | null>(STORAGE_ACTIVE_STATE, null);
  }

  async saveActiveState(state: ActiveState): Promise<void> {
    return this.setSetting(STORAGE_ACTIVE_STATE, state);
  }

  async loadWorkoutDirHandle(): Promise<FsDirHandle | null> {
    if (this.workoutDirHandle) return this.workoutDirHandle;
    let handle = (await this.loadHandle(WORKOUT_DIR_KEY)) as FsDirHandle | null;
    if (!handle) {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (root) {
        handle = await root.getDirectoryHandle('history', { create: true });
      }
    }
    this.workoutDirHandle = handle || null;
    return this.workoutDirHandle;
  }

  // ---------- workout library (picker) ----------

  private async loadZwoDirHandle(): Promise<FsDirHandle | null> {
    let handle = (await this.loadHandle(ZWO_DIR_KEY)) as FsDirHandle | null;
    if (!handle) {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (root) handle = await root.getDirectoryHandle('workouts', { create: true });
    }
    return handle || null;
  }

  private async loadTrashDirHandle(): Promise<FsDirHandle | null> {
    let handle = (await this.loadHandle(TRASH_DIR_KEY)) as FsDirHandle | null;
    if (!handle) {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (root) handle = await root.getDirectoryHandle('trash', { create: true });
    }
    return handle || null;
  }

  async listWorkouts(): Promise<CanonicalWorkout[]> {
    const dir = await this.loadZwoDirHandle();
    if (!dir) return [];
    // Re-authorize the reloaded handle. Runs in the gesture that opened the
    // picker, so the prompt is allowed.
    await ensureDirPermission(dir);
    const out: CanonicalWorkout[] = [];
    try {
      for await (const entry of dir.values() as AsyncIterable<FsHandle>) {
        if (entry.kind !== 'file') continue;
        if (!entry.name.toLowerCase().endsWith('.zwo')) continue;
        const fileHandle = await dir.getFileHandle(entry.name);
        const file = await fileHandle.getFile?.();
        if (!file) continue;
        const text = await file.text();
        const canonical = parseZwoXmlToCanonicalWorkout(text);
        if (canonical) out.push(canonical);
      }
    } catch (err) {
      console.error('[WebFileStore] listWorkouts failed:', err);
    }
    return out;
  }

  async deleteWorkoutToTrash(canonical: CanonicalWorkout): Promise<boolean> {
    const fileName = sanitizeZwoFileName(canonical.workoutTitle || 'workout') + '.zwo';
    return this.moveZwoFileToTrash(fileName);
  }

  async saveWorkout(canonical: CanonicalWorkout): Promise<boolean> {
    const dir = await this.loadZwoDirHandle();
    if (!dir) {
      this.notifyError('Choose a VeloDrive folder first, then save the workout.');
      return false;
    }
    // Re-authorize the persisted handle before writing. A handle reloaded from
    // IndexedDB is in the "prompt" state in a real browser until this runs.
    if (!(await ensureDirPermission(dir))) {
      this.notifyError('Permission to write to the workouts folder was not granted.');
      return false;
    }
    const fileName = sanitizeZwoFileName(canonical.workoutTitle || 'workout') + '.zwo';
    try {
      // If a same-name .zwo already exists, move it to trash BEFORE writing so
      // there is always a recoverable copy (no silent overwrite). If the trash
      // move fails, abort the save rather than risk data loss.
      let overwriting = false;
      try {
        await dir.getFileHandle(fileName, { create: false });
        overwriting = true;
      } catch {
        overwriting = false;
      }
      if (overwriting) {
        const moved = await this.moveZwoFileToTrash(fileName);
        if (!moved) return false;
      }

      const xml = canonicalWorkoutToZwoXml(canonical);
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(xml);
      await writable.close();
      return true;
    } catch (err) {
      console.error('[WebFileStore] saveWorkout failed:', err);
      this.notifyError('Could not save the workout to the folder.');
      return false;
    }
  }

  /**
   * Move an existing library .zwo (by exact file name) to the trash dir with a
   * timestamped name. Shared by deleteWorkoutToTrash + the pre-overwrite trash
   * move in saveWorkout.
   */
  private async moveZwoFileToTrash(fileName: string): Promise<boolean> {
    const srcDir = await this.loadZwoDirHandle();
    const trashDir = await this.loadTrashDirHandle();
    if (!srcDir || !trashDir) return false;
    if (!(await ensureDirPermission(srcDir)) || !(await ensureDirPermission(trashDir))) return false;
    try {
      const srcFileHandle = await srcDir.getFileHandle(fileName, { create: false });
      const srcFile = await srcFileHandle.getFile?.();
      const text = srcFile ? await srcFile.text() : '';

      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
      const ext = dotIdx > 0 ? fileName.slice(dotIdx) : '';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let destFileName = `${base} (${stamp})${ext}`;
      // Cap the trashed file name length to keep the FS happy.
      if (destFileName.length > 120) {
        const overflow = destFileName.length - 120;
        const trimmedBase = base.slice(0, Math.max(0, base.length - overflow));
        destFileName = `${trimmedBase} (${stamp})${ext}`;
      }

      const destFileHandle = await trashDir.getFileHandle(destFileName, { create: true });
      const writable = await destFileHandle.createWritable();
      await writable.write(text);
      await writable.close();

      await srcDir.removeEntry(fileName);
      return true;
    } catch (err) {
      console.error('[WebFileStore] moveZwoFileToTrash failed:', err);
      return false;
    }
  }

  // ---------- planner: history (.fit) + schedule.json ----------

  /**
   * List + parse every .fit file in the history dir. The day a ride belongs to
   * is derived by the caller from `fileName` (UTC ISO timestamps).
   */
  async listHistory(): Promise<HistoryFitEntry[]> {
    const dir = await this.loadWorkoutDirHandle();
    if (!dir) return [];
    const out: HistoryFitEntry[] = [];
    try {
      for await (const entry of dir.values() as AsyncIterable<FsHandle>) {
        if (entry.kind !== 'file') continue;
        if (!entry.name.toLowerCase().endsWith('.fit')) continue;
        try {
          const fileHandle = await dir.getFileHandle(entry.name);
          const file = await fileHandle.getFile?.();
          if (!file) continue;
          const buf = await file.arrayBuffer();
          const parsed = parseFitFile(buf);
          out.push({ fileName: entry.name, parsed });
        } catch (err) {
          console.warn('[WebFileStore] failed to parse history file', entry.name, err);
        }
      }
    } catch (err) {
      console.error('[WebFileStore] listHistory failed:', err);
    }
    return out;
  }

  /**
   * List the history dir and return a computed preview per .fit file, using the
   * persisted stats cache (settings key `workoutStatsCache`) to skip re-parsing
   * unchanged files. Caches the WHOLE preview (rawSegments included) keyed by
   * file name so a cache hit avoids the parse entirely. Cache invalidates by
   * file name + STATS_CACHE_VERSION; entries for files no longer present are
   * pruned.
   */
  async listHistoryPreviews(): Promise<HistoryPreview[]> {
    const dir = await this.loadWorkoutDirHandle();
    if (!dir) return [];
    const cache = await this.ensureStatsCache();
    const out: HistoryPreview[] = [];
    const seen = new Set<string>();
    let dirty = false;
    try {
      for await (const entry of dir.values() as AsyncIterable<FsHandle>) {
        if (entry.kind !== 'file') continue;
        const fileName = entry.name;
        if (!fileName.toLowerCase().endsWith('.fit')) continue;
        seen.add(fileName);
        const cached = cache.entries[fileName];
        if (cached) {
          out.push(this.previewFromCache(fileName, cached));
          continue;
        }
        // Cache miss → parse + compute, then persist.
        try {
          const fileHandle = await dir.getFileHandle(fileName);
          const file = await fileHandle.getFile?.();
          if (!file) continue;
          const buf = await file.arrayBuffer();
          this.historyParseCount += 1;
          const parsed = parseFitFile(buf);
          const built = this.buildPreview(fileName, parsed);
          cache.entries[fileName] = this.cacheEntryFromPreview(built);
          dirty = true;
          out.push(built);
        } catch (err) {
          console.warn('[WebFileStore] failed to parse history file', fileName, err);
        }
      }
    } catch (err) {
      console.error('[WebFileStore] listHistoryPreviews failed:', err);
    }
    // Prune cache entries whose files have vanished (e.g. trashed rides).
    for (const key of Object.keys(cache.entries)) {
      if (!seen.has(key)) {
        delete cache.entries[key];
        dirty = true;
      }
    }
    if (dirty) void this.saveStatsCache(cache);
    return out;
  }

  private buildPreview(fileName: string, parsed: ParseFitResult): HistoryPreview {
    // Pure ride-analytics now live in core/history.ts; this adapter only owns
    // the file read + the stats-cache I/O around it.
    return buildHistoryPreview(fileName, parsed);
  }

  private cacheEntryFromPreview(p: HistoryPreview): StatsCacheEntry {
    return {
      workoutTitle: p.workoutTitle,
      durationSec: p.durationSec,
      kj: p.kj,
      ifValue: p.ifValue,
      tss: p.tss,
      startedAt: p.startedAt ? p.startedAt.toISOString() : null,
      rawSegments: p.rawSegments,
      powerSegments: p.powerSegments,
      powerMax: p.powerMax,
      zone: p.zone,
    };
  }

  private previewFromCache(fileName: string, c: StatsCacheEntry): HistoryPreview {
    return {
      fileName,
      workoutTitle: c.workoutTitle,
      durationSec: c.durationSec,
      kj: c.kj,
      ifValue: c.ifValue,
      tss: c.tss,
      startedAt: c.startedAt ? new Date(c.startedAt) : null,
      rawSegments: c.rawSegments || [],
      powerSegments: c.powerSegments || [],
      powerMax: c.powerMax || 0,
      zone: c.zone || '',
    };
  }

  private async ensureStatsCache(): Promise<StatsCache> {
    if (this.statsCache) return this.statsCache;
    try {
      const raw = await this.getSettingRaw<StatsCache | null>(STATS_CACHE_KEY, null);
      if (raw && raw.version === STATS_CACHE_VERSION && raw.entries) {
        this.statsCache = raw;
      } else {
        this.statsCache = { version: STATS_CACHE_VERSION, entries: {} };
      }
    } catch {
      this.statsCache = { version: STATS_CACHE_VERSION, entries: {} };
    }
    return this.statsCache;
  }

  private async saveStatsCache(cache: StatsCache): Promise<void> {
    try {
      await this.setSetting(STATS_CACHE_KEY, cache);
    } catch (err) {
      console.warn('[WebFileStore] saveStatsCache failed:', err);
    }
  }

  /**
   * Drop a file from the in-memory + persisted stats cache (e.g. after trashing
   * a ride). The next listHistoryPreviews would also prune it, but this keeps
   * the cache consistent immediately.
   */
  async invalidateHistoryStats(fileName: string): Promise<void> {
    const cache = await this.ensureStatsCache();
    if (cache.entries[fileName]) {
      delete cache.entries[fileName];
      await this.saveStatsCache(cache);
    }
  }

  /** Read schedule.json (a flat array) from the root dir; [] if absent. */
  async loadSchedule(): Promise<ScheduleEntry[]> {
    try {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (!root) return [];
      const fileHandle = await root.getFileHandle(SCHEDULE_FILE, { create: false });
      const file = await fileHandle.getFile?.();
      if (!file) return [];
      const parsed = JSON.parse(await file.text());
      return Array.isArray(parsed) ? (parsed as ScheduleEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** Persist schedule.json (pretty-printed). */
  async saveSchedule(entries: ScheduleEntry[]): Promise<boolean> {
    try {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (!root) {
        this.notifyError('Choose a VeloDrive folder first to save the schedule.');
        return false;
      }
      if (!(await ensureDirPermission(root))) {
        this.notifyError('Permission to write the schedule was not granted.');
        return false;
      }
      const fileHandle = await root.getFileHandle(SCHEDULE_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(entries || [], null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.warn('[WebFileStore] saveSchedule failed:', err);
      this.notifyError('Could not save the schedule.');
      return false;
    }
  }

  /**
   * Remove the scheduled entry for a given local day + workout title (matched
   * case-insensitively on the trimmed title), used by the post-ride follow-up:
   * finishing a scheduled ride clears that day's matching entry. Returns true if
   * an entry was removed (and persisted), false otherwise.
   */
  async removeScheduledByTitle(dateKey: string, title: string): Promise<boolean> {
    const entries = await this.loadSchedule();
    const next = removeScheduledByTitleRule(entries, dateKey, title);
    if (next === null) return false;
    return this.saveSchedule(next);
  }

  /**
   * Move a scheduled entry from one day to another (drag-and-drop reschedule):
   * a same-day move is a no-op (true), a move onto a PAST day is rejected
   * (false), and only the FIRST matching {fromDate, title} entry is moved. The
   * matched entry keeps its other fields and just gets the new date appended at
   * the end of the list. Returns true when the move succeeded (or was a no-op
   * same-day), false otherwise.
   */
  async moveScheduledEntry(
    fromDate: string,
    title: string,
    toDate: string,
  ): Promise<boolean> {
    if (!fromDate || !toDate || !title) return false;
    if (fromDate === toDate) return true;
    const entries = await this.loadSchedule();
    const result = moveScheduledEntryRule(entries, fromDate, title, toDate);
    if (result.kind === 'noop') return true;
    if (result.kind === 'reject') return false;
    return this.saveSchedule(result.entries);
  }

  /** Move a history .fit file to the trash dir. */
  async deleteHistoryToTrash(fileName: string): Promise<boolean> {
    const srcDir = await this.loadWorkoutDirHandle();
    const trashDir = await this.loadTrashDirHandle();
    if (!srcDir || !trashDir) {
      this.notifyError('Choose a VeloDrive folder first to delete this ride.');
      return false;
    }
    if (!(await ensureDirPermission(srcDir)) || !(await ensureDirPermission(trashDir))) {
      this.notifyError('Permission to move the ride to trash was not granted.');
      return false;
    }
    try {
      const srcFileHandle = await srcDir.getFileHandle(fileName, { create: false });
      const srcFile = await srcFileHandle.getFile?.();
      const buf = srcFile ? await srcFile.arrayBuffer() : new ArrayBuffer(0);

      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
      const ext = dotIdx > 0 ? fileName.slice(dotIdx) : '';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const destFileName = `${base} (${stamp})${ext}`;

      const destFileHandle = await trashDir.getFileHandle(destFileName, { create: true });
      const writable = await destFileHandle.createWritable();
      await writable.write(buf);
      await writable.close();

      await srcDir.removeEntry(fileName);
      return true;
    } catch (err) {
      console.error('[WebFileStore] deleteHistoryToTrash failed:', err);
      this.notifyError('Could not move the ride to the trash folder.');
      return false;
    }
  }
}
