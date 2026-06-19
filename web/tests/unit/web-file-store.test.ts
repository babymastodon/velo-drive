// tests/unit/web-file-store.test.ts
//
// Unit coverage for the two WebFileStore behaviors added in the defect pass:
//   * pickRootDir seeds the 6 bundled default workouts when the library is empty
//     (J-CFG-17), and skips seeding when the library already has .zwo files.
//   * removeScheduledByTitle clears the matching scheduled entry (post-ride flow,
//     J-PLAN-34) and leaves others intact.
//
// Drives the real WebFileStore against the in-memory FSA + fake IndexedDB fakes
// (harness/file-store.ts), a fake showDirectoryPicker, and a fake fetch that
// serves the bundled /workouts/<name> assets from disk.

import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  FakeFileSystemDirectoryHandle,
  createFakeIndexedDB,
} from "../../harness/file-store.js";
import {WebFileStore} from "../../src/ports/web/WebFileStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_WORKOUTS = resolve(__dirname, "..", "..", "public", "workouts");

const DEFAULT_NAMES = [
  "Basefire%20Waves.zwo",
  "Breath%20of%20Power.zwo",
  "Into%20the%20Black.zwo",
  "Keep%20Turning.zwo",
  "Rise%20Against%20the%20Odds.zwo",
  "Sleepy%20Spin.zwo",
];

function installEnv(root: FakeFileSystemDirectoryHandle): void {
  const {indexedDB} = createFakeIndexedDB({});
  (globalThis as unknown as {indexedDB: unknown}).indexedDB = indexedDB;
  (globalThis as unknown as {showDirectoryPicker: () => Promise<unknown>}).showDirectoryPicker =
    () => Promise.resolve(root);
  // Serve /workouts/<name> from the bundled public assets (mirrors the app
  // fetch). The app requests `/workouts/${encodeURI(fileName)}` where fileName is
  // already the URL-encoded on-disk name (e.g. "Basefire%20Waves.zwo"); encodeURI
  // then escapes the "%" -> "%25", so the request path is double-encoded
  // ("Basefire%2520Waves.zwo"). A real HTTP server decodes the path once before
  // resolving the file, so decode once here to recover the on-disk name.
  (globalThis as unknown as {fetch: typeof fetch}).fetch = (async (url: string) => {
    const onDisk = decodeURIComponent(String(url).replace(/^\/workouts\//, ""));
    const text = readFileSync(join(PUBLIC_WORKOUTS, onDisk), "utf8");
    return {ok: true, status: 200, text: async () => text} as unknown as Response;
  }) as unknown as typeof fetch;
}

async function listZwoNames(dir: FakeFileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".zwo")) out.push(entry.name);
  }
  return out.sort();
}

describe("WebFileStore.pickRootDir default-workout seeding (J-CFG-17)", () => {
  let root: FakeFileSystemDirectoryHandle;

  beforeEach(() => {
    root = new FakeFileSystemDirectoryHandle("VeloDrive");
    installEnv(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds the 6 default workouts into an empty workouts/ library", async () => {
    const store = new WebFileStore();
    const picked = await store.pickRootDir();
    expect(picked).not.toBeNull();

    const workouts = await root.getDirectoryHandle("workouts", {create: false});
    const names = await listZwoNames(workouts);
    expect(names).toEqual([...DEFAULT_NAMES].sort());

    // Each seeded file has real .zwo content (non-empty).
    const first = await workouts.getFileHandle(DEFAULT_NAMES[0] as string);
    const file = await first.getFile();
    expect((await file.text()).length).toBeGreaterThan(0);
  });

  it("does NOT seed when the library already has a .zwo", async () => {
    // Pre-create workouts/ with one existing file.
    const workouts = await root.getDirectoryHandle("workouts", {create: true});
    workouts.seedFile("Existing.zwo", "<workout_file></workout_file>");

    const store = new WebFileStore();
    await store.pickRootDir();

    const names = await listZwoNames(workouts);
    expect(names).toEqual(["Existing.zwo"]);
  });
});

describe("WebFileStore.removeScheduledByTitle (post-ride flow, J-PLAN-34)", () => {
  // Seed the root handle directly into the fake IndexedDB in the {key, handle}
  // shape loadHandle reads (mirrors the page-env hermetic seed), then write the
  // schedule into the seeded root.
  function bootConfigured(initial: {date: string; workoutTitle: string}[]): {
    store: WebFileStore;
    root: FakeFileSystemDirectoryHandle;
  } {
    const root = new FakeFileSystemDirectoryHandle("VeloDrive");
    root.seedFile("schedule.json", JSON.stringify(initial));
    const {indexedDB} = createFakeIndexedDB({rootDirHandle: {key: "rootDirHandle", handle: root}});
    (globalThis as unknown as {indexedDB: unknown}).indexedDB = indexedDB;
    return {store: new WebFileStore(), root};
  }

  it("removes only the matching day+title entry (case/space-insensitive)", async () => {
    const {store} = bootConfigured([
      {date: "2026-06-18", workoutTitle: "Sleepy Spin"},
      {date: "2026-06-18", workoutTitle: "Keep Turning"},
      {date: "2026-06-19", workoutTitle: "Sleepy Spin"},
    ]);

    const removed = await store.removeScheduledByTitle("2026-06-18", "  sleepy spin  ");
    expect(removed).toBe(true);

    const remaining = await store.loadSchedule();
    expect(remaining).toEqual([
      {date: "2026-06-18", workoutTitle: "Keep Turning"},
      {date: "2026-06-19", workoutTitle: "Sleepy Spin"},
    ]);
  });

  it("returns false when nothing matches", async () => {
    const {store} = bootConfigured([{date: "2026-06-18", workoutTitle: "Sleepy Spin"}]);
    const removed = await store.removeScheduledByTitle("2026-06-18", "Nonexistent");
    expect(removed).toBe(false);
  });
});
