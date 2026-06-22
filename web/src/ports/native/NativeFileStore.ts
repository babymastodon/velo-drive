// NativeFileStore — the Tauri (native) FileStore. Settings/active-state stay in
// IndexedDB (works in the webview), and the workout folder is a native path
// instead of a File System Access handle. Because the workout/history/schedule
// logic in WebFileStore is written against the FsDirHandle abstraction, we only
// override how the root folder is obtained — everything else is inherited.

import { invoke } from '@tauri-apps/api/core';
import { WebFileStore } from '../web/WebFileStore.js';
import type { FsDirHandle } from '../FileStore.js';
import { NativeDirHandle, pickFolderNative } from './native-fs.js';

const ROOT_PATH_KEY = 'nativeRootDirPath';

export class NativeFileStore extends WebFileStore {
  override async loadRootDirHandle(): Promise<FsDirHandle | null> {
    const path = await this.getSetting<string | null>(ROOT_PATH_KEY, null);
    return path ? new NativeDirHandle(path) : null;
  }

  /** First run: default the data folder to the XDG location (~/.local/share/
   *  VeloDrive), creating + seeding it, so the app works without a folder prompt.
   *  No-op once a folder is configured (the user can change it in Settings). */
  async ensureDefaultRoot(): Promise<void> {
    const existing = await this.getSetting<string | null>(ROOT_PATH_KEY, null);
    // Keep a configured folder that already holds a library.
    if (existing && (await this.folderHasWorkouts(existing))) return;
    try {
      const path = await invoke<string>('fs_default_root');
      await this.putSetting(ROOT_PATH_KEY, path);
      const root = new NativeDirHandle(path);
      const workouts = await root.getDirectoryHandle('workouts', { create: true });
      await root.getDirectoryHandle('history', { create: true });
      await root.getDirectoryHandle('trash', { create: true });
      await this.maybeSeedDefaultWorkouts(workouts);
      this.invalidatePreloadedWorkouts();
    } catch (err) {
      console.error('[NativeFileStore] ensureDefaultRoot failed:', err);
    }
  }

  private async folderHasWorkouts(rootPath: string): Promise<boolean> {
    try {
      const w = await new NativeDirHandle(rootPath).getDirectoryHandle('workouts', { create: false });
      for await (const e of w.values()) {
        if (e.kind === 'file' && e.name.toLowerCase().endsWith('.zwo')) return true;
      }
    } catch {
      /* no workouts dir */
    }
    return false;
  }

  override async pickRootDir(): Promise<FsDirHandle | null> {
    const path = await pickFolderNative();
    if (!path) return null; // user cancelled
    try {
      await this.putSetting(ROOT_PATH_KEY, path);
      const root = new NativeDirHandle(path);
      const workouts = await root.getDirectoryHandle('workouts', { create: true });
      await root.getDirectoryHandle('history', { create: true });
      await root.getDirectoryHandle('trash', { create: true });
      // Seed the bundled defaults when the library is empty (same as the web path).
      await this.maybeSeedDefaultWorkouts(workouts);
      this.invalidatePreloadedWorkouts();
      return root;
    } catch (err) {
      console.error('[NativeFileStore] pickRootDir failed:', err);
      this.onError?.('Failed to set up the data folder.');
      return null;
    }
  }
}
