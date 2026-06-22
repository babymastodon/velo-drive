// FileStore.ts
//
// Port interface for settings/persistence + file output. The web implementation
// (WebFileStore) reads `indexedDB` and `showDirectoryPicker` so the harness
// fakes drive it. Only the surface the HUD needs is modeled: load selected
// workout, FTP + settings, saved device IDs, active-state persistence, and the
// history dir handle (for FIT output).

import type { CanonicalWorkout } from '../core/model.js';
import type { HistoryPreview, HistoryFitEntry } from '../core/history.js';
import type { ScheduleEntry } from '../core/schedule.js';

export interface ActiveState {
  [key: string]: unknown;
}

export interface FsDirHandle {
  readonly name?: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<FsHandle> | AsyncIterableIterator<FsHandle>;
  [Symbol.asyncIterator]?(): AsyncIterableIterator<FsHandle>;
}
export interface FsHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  /** File size in bytes + mtime (ms) when the platform's dir listing provides
   *  them (native) — lets the library cache skip re-reading unchanged files. */
  readonly size?: number;
  readonly mtimeMs?: number;
}
export interface FsFileHandle {
  readonly kind?: 'file';
  readonly name?: string;
  getFile?(): Promise<FsFile>;
  createWritable(): Promise<FsWritable>;
}
export interface FsFile {
  readonly name?: string;
  /** Cheap metadata (FSA File exposes these without reading content). */
  readonly size?: number;
  readonly lastModified?: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface FsWritable {
  write(data: ArrayBufferView | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
}

export interface FileStore {
  loadSelectedWorkout(): Promise<CanonicalWorkout | null>;
  getSetting<T>(key: string, defaultValue: T): Promise<T>;
  /** Persist a single setting. */
  putSetting(key: string, value: unknown): Promise<void>;
  loadBleDeviceIds(): Promise<{ bikeId: string | null; hrId: string | null }>;
  loadActiveState(): Promise<ActiveState | null>;
  saveActiveState(state: ActiveState): Promise<void>;
  loadWorkoutDirHandle(): Promise<FsDirHandle | null>;
  /** The persisted root-dir handle (VeloDrive folder), or null if unset. */
  loadRootDirHandle(): Promise<FsDirHandle | null>;
  /** Prompt the user to pick the VeloDrive root folder (FSA). */
  pickRootDir(): Promise<FsDirHandle | null>;

  // ---- Workout library (picker) ----
  /** Scan the .zwo workouts dir and return parsed CanonicalWorkouts. */
  listWorkouts(): Promise<CanonicalWorkout[]>;
  /** Start scanning the library in the background (call at app boot) so it's
   *  ready before the user opens the picker. */
  preloadWorkouts(): void;
  /** True once the preload has finished (for an instant, flash-free open). */
  isWorkoutsReady(): boolean;
  /** The preloaded in-memory library — instant if ready, else awaits the preload. */
  getWorkouts(): Promise<CanonicalWorkout[]>;
  /** Re-scan + refresh the in-memory library (after save/delete/import). */
  refreshWorkouts(): Promise<CanonicalWorkout[]>;
  /** Move a workout's .zwo file to the trash folder (delete). */
  deleteWorkoutToTrash(canonical: CanonicalWorkout): Promise<boolean>;
  /** Serialize + write a CanonicalWorkout into the workouts dir (used by clone). */
  saveWorkout(canonical: CanonicalWorkout): Promise<boolean>;
  /** Download a .zwo workout pack (a zip URL) into a wrapper subfolder of the
   * workouts dir (the zip's redundant top-level folder is stripped). */
  importZwoZip(
    url: string,
    subfolder?: string,
  ): Promise<{ added: number; error: string | null }>;
  /** Write a batch of CanonicalWorkouts to their `sourcePath` (bulk importers). */
  importWorkoutBatch(
    canonicals: CanonicalWorkout[],
    onProgress?: (done: number, total: number) => void,
    shouldCancel?: () => boolean,
  ): Promise<{ added: number; skipped: number; error: string | null }>;

  // ---- Planner: history (.fit) ----
  /** List + parse every .fit file in the history dir (full samples/meta). */
  listHistory(): Promise<HistoryFitEntry[]>;
  /** List the history dir and return a computed (cached) preview per .fit. */
  listHistoryPreviews(): Promise<HistoryPreview[]>;
  /** Drop a file from the in-memory + persisted ride-stats cache. */
  invalidateHistoryStats(fileName: string): Promise<void>;
  /** Move a history .fit file to the trash dir. */
  deleteHistoryToTrash(fileName: string): Promise<boolean>;

  // ---- Planner: schedule.json ----
  /** Read schedule.json (a flat array); [] if absent. */
  loadSchedule(): Promise<ScheduleEntry[]>;
  /** Persist schedule.json. */
  saveSchedule(entries: ScheduleEntry[]): Promise<boolean>;
  /** Remove a scheduled entry for a day + title (case-insensitive). */
  removeScheduledByTitle(dateKey: string, title: string): Promise<boolean>;
  /** Move a scheduled entry from one day to another (drag-and-drop reschedule). */
  moveScheduledEntry(fromDate: string, title: string, toDate: string): Promise<boolean>;
}
