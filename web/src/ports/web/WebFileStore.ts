// WebFileStore.ts
//
// TypeScript port of the docs/storage.js IndexedDB "settings" plumbing (the HUD
// subset). Reads `indexedDB` (and, for the history dir, the persisted FSA
// handles) so the harness fakes drive it exactly like the legacy app.

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
import {
  DEFAULT_FTP,
  computeMetricsFromSamples,
  inferZoneFromSegments,
  type Sample,
} from '../../core/metrics.js';
import {
  buildPowerSegments,
  powerMaxFromIntervals,
  type PowerInterval,
} from '../../core/planner-analysis.js';

const DB_NAME = 'velo-drive';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';

// Persisted FIT-metrics cache (mirrors docs/planner-backend.js
// STATS_CACHE_VERSION + load/saveWorkoutStatsCache). Computed previews are keyed
// by the FIT file name so each planner open re-parses only NEW files. Bump the
// version whenever the preview format/computation changes (invalidates the whole
// cache).
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

/** A raw FIT history file entry (name + parsed contents). */
export interface HistoryFitEntry {
  fileName: string;
  parsed: ParseFitResult;
}

/**
 * A computed per-ride history preview (the planner calendar card model). Built
 * by listHistoryPreviews from a parsed FIT + cached by file name so repeat opens
 * skip the parse + metric/segment math. `startedAt` is serialized as an ISO
 * string in the cache and rehydrated to a Date here.
 */
export interface HistoryPreview {
  fileName: string;
  workoutTitle: string;
  durationSec: number;
  kj: number | null;
  ifValue: number | null;
  tss: number | null;
  startedAt: Date | null;
  rawSegments: RawSegment[];
  powerSegments: PowerInterval[];
  powerMax: number;
  zone: string;
}

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

/** A persisted schedule entry (schedule.json is a flat array of these). */
export interface ScheduleEntry {
  date: string; // YYYY-MM-DD
  workoutTitle: string;
}

/** Injective title -> file-safe base name (mirrors docs/workout-picker.js). */
function sanitizeZwoFileName(title: string): string {
  return encodeURIComponent(title);
}

interface HandleRecord {
  handle: unknown;
}

// FSA permission surface (present on real FileSystemHandle, faked granted in the
// harness). A persisted handle reloaded from IndexedDB comes back in the
// "prompt" state in a REAL browser, so reads/writes fail until we re-request
// read-write permission (mirrors docs/storage.js ensureDirPermission). The
// harness fake always resolves "granted", so this is a no-op in tests.
interface FsPermissionHandle {
  queryPermission?(opts: { mode: 'readwrite' | 'read' }): Promise<PermissionState | string>;
  requestPermission?(opts: { mode: 'readwrite' | 'read' }): Promise<PermissionState | string>;
}

/**
 * Re-authorize a persisted directory handle for read-write access. Mirrors
 * docs/storage.js ensureDirPermission: query first, short-circuit on
 * granted/denied, otherwise prompt. Returns true only when read-write access is
 * granted. requestPermission must run in a user gesture in a real browser.
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
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, value });
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
      if (typeof alert === 'function') {
        alert('Selecting a data folder requires File System Access support.');
      }
      return null;
    }
    try {
      const root = await picker();
      // Re-authorize read-write before touching the folder (mirrors
      // docs/storage.js pickRootDir → ensureDirPermission). In a real browser
      // showDirectoryPicker() grants on selection, but be explicit.
      const ok = await ensureDirPermission(root);
      if (!ok) {
        if (typeof alert === 'function') {
          alert('Permission was not granted to the selected folder.');
        }
        return null;
      }
      // Persist the root + the three standard subdir handles so they survive a
      // reload (mirrors docs/storage.js saveRootDirHandle/saveZwoDirHandle/
      // saveWorkoutDirHandle/saveTrashDirHandle). Persisting the subdir handles
      // (not just root) matches legacy and avoids re-deriving them every load.
      await this.setSetting(ROOT_DIR_KEY, { handle: root });
      const workouts = await root.getDirectoryHandle('workouts', { create: true });
      const history = await root.getDirectoryHandle('history', { create: true });
      const trash = await root.getDirectoryHandle('trash', { create: true });
      await this.setSetting(ZWO_DIR_KEY, { handle: workouts });
      await this.setSetting(WORKOUT_DIR_KEY, { handle: history });
      await this.setSetting(TRASH_DIR_KEY, { handle: trash });
      this.workoutDirHandle = history;
      return root;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return null;
      console.error('[WebFileStore] Failed to choose root folder:', err);
      if (typeof alert === 'function') alert('Failed to choose folder.');
      return null;
    }
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
    // Re-authorize the reloaded handle (legacy rescanWorkouts → ensureDirPermission).
    // Runs in the gesture that opened the picker, so the prompt is allowed.
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
    if (!dir) return false;
    // Re-authorize the persisted handle before writing (mirrors legacy
    // saveCanonicalWorkoutToZwoDir → ensureDirPermission). A handle reloaded
    // from IndexedDB is in the "prompt" state in a real browser until this runs.
    if (!(await ensureDirPermission(dir))) return false;
    const fileName = sanitizeZwoFileName(canonical.workoutTitle || 'workout') + '.zwo';
    try {
      // Mirror legacy saveCanonicalWorkoutToZwoDir (docs/workout-picker.js
      // 1805-1823): if a same-name .zwo already exists, move it to trash BEFORE
      // writing so there is always a recoverable copy (no silent overwrite). If
      // the trash move fails, abort the save rather than risk data loss.
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
      return false;
    }
  }

  /**
   * Move an existing library .zwo (by exact file name) to the trash dir with a
   * timestamped name. Shared by deleteWorkoutToTrash + the pre-overwrite trash
   * move in saveWorkout. Mirrors legacy moveWorkoutFileToTrash.
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
      // Cap the trashed file name length (legacy 1644-1647) to keep the FS happy.
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
   * List + parse every .fit file in the history dir. Mirrors the legacy
   * planner-backend.js history index (docs/planner-backend.js): the day a ride
   * belongs to is derived by the caller from `fileName` (UTC ISO timestamps).
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
   * unchanged files. Mirrors docs/planner-backend.js loadHistoryPreview, but
   * caches the WHOLE preview (rawSegments included) keyed by file name so a
   * cache hit avoids the parse entirely. Cache invalidates by file name +
   * STATS_CACHE_VERSION; entries for files no longer present are pruned.
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
    const cw = parsed.canonicalWorkout || ({} as CanonicalWorkout);
    const meta = parsed.meta || {};
    const ftp = meta.ftp || DEFAULT_FTP;
    // FitSample lacks the index signature Sample carries; the fields used are
    // identical, so widen for the metric/segment helpers (same call PlannerView
    // makes against parsed.samples).
    const samples = (parsed.samples || []) as Sample[];
    const lastSample = samples.length ? samples[samples.length - 1] : null;
    const durationSecHint =
      meta.totalTimerSec != null
        ? Math.max(1, Math.round(meta.totalTimerSec))
        : meta.startedAt && meta.endedAt
          ? Math.max(1, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000))
          : Math.max(1, Math.round(lastSample?.t || 0));
    const metrics = computeMetricsFromSamples(samples, ftp, durationSecHint);
    const powerSegments = buildPowerSegments(samples, durationSecHint).intervals;
    return {
      fileName,
      workoutTitle: cw.workoutTitle || fileName.replace(/\.fit$/i, ''),
      durationSec: metrics.durationSec || durationSecHint || 0,
      kj: meta.totalWorkJ != null ? meta.totalWorkJ / 1000 : metrics.kj,
      ifValue: metrics.ifValue,
      tss: metrics.tss,
      startedAt: meta.startedAt || null,
      rawSegments: cw.rawSegments || [],
      powerSegments,
      powerMax: powerMaxFromIntervals(powerSegments),
      zone: inferZoneFromSegments(cw.rawSegments || []),
    };
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

  /** Persist schedule.json (pretty-printed, mirrors docs/storage.js). */
  async saveSchedule(entries: ScheduleEntry[]): Promise<boolean> {
    try {
      const root = (await this.loadHandle(ROOT_DIR_KEY)) as FsDirHandle | null;
      if (!root) return false;
      if (!(await ensureDirPermission(root))) return false;
      const fileHandle = await root.getFileHandle(SCHEDULE_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(entries || [], null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.warn('[WebFileStore] saveSchedule failed:', err);
      return false;
    }
  }

  /** Move a history .fit file to the trash dir (mirrors moveHistoryFileToTrash). */
  async deleteHistoryToTrash(fileName: string): Promise<boolean> {
    const srcDir = await this.loadWorkoutDirHandle();
    const trashDir = await this.loadTrashDirHandle();
    if (!srcDir || !trashDir) return false;
    if (!(await ensureDirPermission(srcDir)) || !(await ensureDirPermission(trashDir))) return false;
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
      return false;
    }
  }
}
