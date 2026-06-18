// harness/file-store.ts
//
// In-memory File System Access fakes + a fake IndexedDB, enough to boot the
// legacy app into a CONFIGURED state without any real browser storage.
//
// What the legacy app needs (from docs/storage.js):
//   * indexedDB.open("velo-drive") with a "settings" object store keyed by
//     "key", holding {key, value} (settings) and {key, handle} (dir handles).
//   * Directory handles implementing getDirectoryHandle / getFileHandle /
//     values() / removeEntry / queryPermission / requestPermission, and file
//     handles implementing getFile / createWritable (write/close).
//
// `FakeFileSystemDirectoryHandle` is structurally clone-safe enough to be
// stored in the fake IDB (we store the live object, since this all lives in one
// page realm). Permissions default to "granted".

// ----------------------------- file system ---------------------------------

class FakeWritable {
  private chunks: Array<Uint8Array> = [];
  constructor(private file: FakeFileHandle) {}
  async write(data: Blob | ArrayBuffer | Uint8Array | string): Promise<void> {
    this.chunks.push(await toBytes(data));
  }
  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    this.file._setBytes(merged);
  }
}

async function toBytes(data: Blob | ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Blob
  const ab = await (data as Blob).arrayBuffer();
  return new Uint8Array(ab);
}

export class FakeFileHandle {
  kind = "file" as const;
  name: string;
  private bytes: Uint8Array;
  constructor(name: string, bytes: Uint8Array = new Uint8Array(0)) {
    this.name = name;
    this.bytes = bytes;
  }
  _setBytes(b: Uint8Array): void {
    this.bytes = b;
  }
  async getFile(): Promise<{
    name: string;
    size: number;
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }> {
    const bytes = this.bytes;
    return {
      name: this.name,
      size: bytes.byteLength,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this);
  }
  async queryPermission(): Promise<"granted"> {
    return "granted";
  }
  async requestPermission(): Promise<"granted"> {
    return "granted";
  }
}

export class FakeFileSystemDirectoryHandle {
  kind = "directory" as const;
  name: string;
  private files = new Map<string, FakeFileHandle>();
  private dirs = new Map<string, FakeFileSystemDirectoryHandle>();

  constructor(name = "root") {
    this.name = name;
  }

  async getDirectoryHandle(name: string, opts?: {create?: boolean}): Promise<FakeFileSystemDirectoryHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) {
        const err = new Error(`Directory "${name}" not found`);
        err.name = "NotFoundError";
        throw err;
      }
      d = new FakeFileSystemDirectoryHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: {create?: boolean}): Promise<FakeFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) {
        const err = new Error(`File "${name}" not found`);
        err.name = "NotFoundError";
        throw err;
      }
      f = new FakeFileHandle(name);
      this.files.set(name, f);
    }
    return f;
  }

  async removeEntry(name: string, _opts?: {recursive?: boolean}): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      const err = new Error(`Entry "${name}" not found`);
      err.name = "NotFoundError";
      throw err;
    }
  }

  async *values(): AsyncGenerator<FakeFileHandle | FakeFileSystemDirectoryHandle> {
    for (const f of this.files.values()) yield f;
    for (const d of this.dirs.values()) yield d;
  }

  async queryPermission(): Promise<"granted"> {
    return "granted";
  }
  async requestPermission(): Promise<"granted"> {
    return "granted";
  }

  // --- harness conveniences (not part of the FSA API) ---

  /** Seed a file by name with text or bytes. */
  seedFile(name: string, content: string | Uint8Array): FakeFileHandle {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const f = new FakeFileHandle(name, bytes);
    this.files.set(name, f);
    return f;
  }
}

// ------------------------------ fake IndexedDB ------------------------------
//
// Minimal IDB modelled on exactly the calls docs/storage.js makes. Backed by a
// single Map for the "settings" store. Records are {key, value?, handle?}.

interface SettingsRecord {
  key: string;
  value?: unknown;
  handle?: unknown;
}

// Async-success request object compatible with `req.onsuccess = ...` usage.
function makeRequest<T>(resolveWith: () => T) {
  const req: {
    result?: T;
    error?: unknown;
    onsuccess: ((this: unknown, ev: unknown) => void) | null;
    onerror: ((this: unknown, ev: unknown) => void) | null;
  } = {onsuccess: null, onerror: null};
  // Microtask so handlers attached synchronously after the call still fire.
  Promise.resolve().then(() => {
    try {
      req.result = resolveWith();
      req.onsuccess?.call(req, {target: req});
    } catch (err) {
      req.error = err;
      req.onerror?.call(req, {target: req});
    }
  });
  return req;
}

class FakeObjectStore {
  constructor(private store: Map<string, SettingsRecord>, private tx: FakeTransaction) {}
  put(record: SettingsRecord) {
    this.store.set(record.key, record);
    this.tx._markWrite();
    return makeRequest(() => record.key);
  }
  get(key: string) {
    return makeRequest(() => this.store.get(key));
  }
  delete(key: string) {
    this.store.delete(key);
    this.tx._markWrite();
    return makeRequest(() => undefined);
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  private wrote = false;
  constructor(private store: Map<string, SettingsRecord>) {
    // Complete on a microtask after the synchronous tx body runs.
    Promise.resolve().then(() => {
      try {
        this.oncomplete?.();
      } catch (err) {
        this.error = err;
        this.onerror?.();
      }
    });
  }
  objectStore(_name: string): FakeObjectStore {
    return new FakeObjectStore(this.store, this);
  }
  _markWrite(): void {
    this.wrote = true;
  }
}

class FakeDatabase {
  objectStoreNames = {
    _set: new Set<string>(),
    contains(name: string) {
      return this._set.has(name);
    },
  };
  private store: Map<string, SettingsRecord>;
  constructor(store: Map<string, SettingsRecord>) {
    this.store = store;
    this.objectStoreNames._set.add("settings");
  }
  createObjectStore(_name: string, _opts?: unknown) {
    this.objectStoreNames._set.add(_name);
    return {};
  }
  transaction(_storeName: string | string[], _mode?: string): FakeTransaction {
    return new FakeTransaction(this.store);
  }
}

export interface FakeIndexedDB {
  open: (name: string, version?: number) => {
    result?: FakeDatabase;
    error?: unknown;
    onupgradeneeded: ((ev: {target: {result: FakeDatabase}}) => void) | null;
    onsuccess: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
  };
}

/**
 * Create a fake `indexedDB` whose "settings" store is pre-seeded from `seed`
 * (key -> {value} or {handle}). Returns the indexedDB object plus a `setValue`
 * / `setHandle` helper for additional seeding.
 */
export function createFakeIndexedDB(
  seed: Record<string, SettingsRecord> = {},
): {indexedDB: FakeIndexedDB; store: Map<string, SettingsRecord>} {
  const store = new Map<string, SettingsRecord>();
  for (const [k, rec] of Object.entries(seed)) store.set(k, {...rec, key: k});

  const indexedDB: FakeIndexedDB = {
    open(_name: string, _version?: number) {
      const db = new FakeDatabase(store);
      const req: ReturnType<FakeIndexedDB["open"]> = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      Promise.resolve().then(() => {
        // Store already has its object store, so upgrade isn't strictly needed,
        // but fire it once to mirror real first-open semantics.
        try {
          req.onupgradeneeded?.({target: {result: db}});
        } catch {
          /* ignore */
        }
        req.result = db;
        req.onsuccess?.({target: req});
      });
      return req;
    },
  };

  return {indexedDB, store};
}
