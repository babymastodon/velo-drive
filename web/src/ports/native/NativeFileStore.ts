// NativeFileStore — the Tauri (native) FileStore. Settings/active-state stay in
// IndexedDB (works in the webview), and the workout folder is a native path
// instead of a File System Access handle. Because the workout/history/schedule
// logic in WebFileStore is written against the FsDirHandle abstraction, we only
// override how the root folder is obtained — everything else is inherited.

import { WebFileStore } from '../web/WebFileStore.js';
import type { FsDirHandle } from '../FileStore.js';
import { NativeDirHandle, pickFolderNative } from './native-fs.js';

const ROOT_PATH_KEY = 'nativeRootDirPath';

export class NativeFileStore extends WebFileStore {
  override async loadRootDirHandle(): Promise<FsDirHandle | null> {
    const path = await this.getSetting<string | null>(ROOT_PATH_KEY, null);
    return path ? new NativeDirHandle(path) : null;
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
