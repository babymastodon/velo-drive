// FileStore.ts
//
// Port interface for settings/persistence + file output, wrapping the behavior
// of docs/storage.js. The web implementation (WebFileStore) reads `indexedDB`
// and `showDirectoryPicker` so the harness fakes drive it. Only the surface the
// HUD needs is modeled: load selected workout, FTP + settings, saved device IDs,
// active-state persistence, and the history dir handle (for FIT output).

import type { CanonicalWorkout } from '../core/model.js';

export interface ActiveState {
  [key: string]: unknown;
}

export interface FsDirHandle {
  readonly name?: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
}
export interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
export interface FsWritable {
  write(data: ArrayBufferView | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
}

export interface FileStore {
  loadSelectedWorkout(): Promise<CanonicalWorkout | null>;
  getSetting<T>(key: string, defaultValue: T): Promise<T>;
  /** Persist a single setting (mirrors docs/storage.js setSetting). */
  putSetting(key: string, value: unknown): Promise<void>;
  loadBleDeviceIds(): Promise<{ bikeId: string | null; hrId: string | null }>;
  loadActiveState(): Promise<ActiveState | null>;
  saveActiveState(state: ActiveState): Promise<void>;
  loadWorkoutDirHandle(): Promise<FsDirHandle | null>;
  /** The persisted root-dir handle (VeloDrive folder), or null if unset. */
  loadRootDirHandle(): Promise<FsDirHandle | null>;
  /** Prompt the user to pick the VeloDrive root folder (FSA). */
  pickRootDir(): Promise<FsDirHandle | null>;
}
