// Path-backed implementations of the FsDirHandle/FsFileHandle abstractions,
// over the native fs commands (src-tauri/src/files.rs). Because WebFileStore's
// file logic is written against these interfaces, NativeFileStore reuses it
// unchanged — only the root folder is obtained natively.

import { invoke } from '@tauri-apps/api/core';
import type { FsDirHandle, FsFileHandle, FsFile, FsHandle, FsWritable } from '../FileStore.js';

interface RustDirEntry {
  name: string;
  isDir: boolean;
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return dir.endsWith('/') ? dir + name : dir + '/' + name;
}

function baseName(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function notFound(name: string): Error {
  const err = new Error(`NotFound: ${name}`);
  // Match the File System Access API so existence checks (catch NotFoundError)
  // behave the same.
  err.name = 'NotFoundError';
  return err;
}

/** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
export async function pickFolderNative(): Promise<string | null> {
  return (await invoke<string | null>('fs_pick_folder')) ?? null;
}

export class NativeDirHandle implements FsDirHandle {
  constructor(public readonly path: string) {}

  get name(): string {
    return baseName(this.path);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle> {
    const p = joinPath(this.path, name);
    const exists = await invoke<boolean>('fs_exists', { path: p });
    if (!exists) {
      if (opts?.create) await invoke('fs_write_text', { path: p, contents: '' });
      else throw notFound(name);
    }
    return new NativeFileHandle(p);
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle> {
    const p = joinPath(this.path, name);
    if (opts?.create) {
      await invoke('fs_mkdir', { path: p });
    } else if (!(await invoke<boolean>('fs_exists', { path: p }))) {
      throw notFound(name);
    }
    return new NativeDirHandle(p);
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    await invoke('fs_remove', { path: joinPath(this.path, name), recursive: !!opts?.recursive });
  }

  async *values(): AsyncIterableIterator<FsHandle> {
    const entries = await invoke<RustDirEntry[]>('fs_read_dir', { path: this.path });
    for (const e of entries) {
      yield { kind: e.isDir ? 'directory' : 'file', name: e.name };
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<FsHandle> {
    return this.values();
  }
}

class NativeFileHandle implements FsFileHandle {
  readonly kind = 'file' as const;
  constructor(public readonly path: string) {}
  get name(): string {
    return baseName(this.path);
  }
  async getFile(): Promise<FsFile> {
    return new NativeFile(this.path);
  }
  async createWritable(): Promise<FsWritable> {
    return new NativeWritable(this.path);
  }
}

class NativeFile implements FsFile {
  constructor(public readonly path: string) {}
  get name(): string {
    return baseName(this.path);
  }
  text(): Promise<string> {
    return invoke<string>('fs_read_text', { path: this.path });
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    const b64 = await invoke<string>('fs_read_bytes', { path: this.path });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
}

// Buffers writes and flushes on close() — createWritable() replaces the file, so
// the accumulated content is written once.
class NativeWritable implements FsWritable {
  private chunks: Uint8Array[] = [];
  private allText = true;

  constructor(public readonly path: string) {}

  async write(data: ArrayBufferView | ArrayBuffer | string): Promise<void> {
    if (typeof data === 'string') {
      this.chunks.push(new TextEncoder().encode(data));
      return;
    }
    this.allText = false;
    if (data instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(data.slice(0)));
    } else {
      // ArrayBufferView (e.g. Uint8Array): copy its bytes into a fresh buffer.
      const v = data as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      this.chunks.push(new Uint8Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
    }
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      all.set(c, off);
      off += c.length;
    }
    if (this.allText) {
      await invoke('fs_write_text', { path: this.path, contents: new TextDecoder().decode(all) });
    } else {
      let bin = '';
      for (let i = 0; i < all.length; i++) bin += String.fromCharCode(all[i] as number);
      await invoke('fs_write_bytes', { path: this.path, b64: btoa(bin) });
    }
  }
}
