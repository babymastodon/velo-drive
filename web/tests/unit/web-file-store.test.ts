// tests/unit/web-file-store.test.ts
//
// Unit coverage for the two WebFileStore behaviors added in the defect pass:
//   * pickRootDir seeds the bundled default workouts when the library is empty,
//     and skips seeding when the library already has .zwo files.
//   * removeScheduledByTitle clears the matching scheduled entry (post-ride
//     flow) and leaves others intact.
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

// The full bundled starter library seeded on a fresh folder pick (matches
// WebFileStore.DEFAULT_WORKOUT_FILES — the complete public/workouts/ set).
const DEFAULT_NAMES = [
  "Airforge.zwo",
  "Ashen%20Surge.zwo",
  "Basefire%20Waves.zwo",
  "Blackglass%20Gauntlet.zwo",
  "Breath%20of%20Power.zwo",
  "Breath%20Spark.zwo",
  "Cinder%20Edge.zwo",
  "Crestline%20Endurance.zwo",
  "Deep%20Current.zwo",
  "Dreamwake.zwo",
  "Endless%20Rhythm.zwo",
  "Endurance%20Drift.zwo",
  "Endurance%20Espresso.zwo",
  "Endure%20the%20Climb.zwo",
  "Freeride%2030.zwo",
  "Freeride%2045.zwo",
  "Freeride%2060.zwo",
  "Freeride%2075.zwo",
  "Freeride%2090.zwo",
  "Hard%20Road%2C%20Steady%20Heart.zwo",
  "Into%20the%20Black.zwo",
  "Keep%20Turning.zwo",
  "Long%20Rollers.zwo",
  "Lullaby%20Legs.zwo",
  "Lungfire.zwo",
  "Mellow%20Matchsticks.zwo",
  "Nocturne%20Strain.zwo",
  "Obsidian%20Pulse.zwo",
  "Open%20Road%20Pulse.zwo",
  "Pillow%20Pops.zwo",
  "Quick%20Turn.zwo",
  "Relentless%20Rise.zwo",
  "Rise%20Against%20the%20Odds.zwo",
  "Rolling%20Crests.zwo",
  "Short%20Resolve.zwo",
  "Sleepy%20Spin.zwo",
  "Snooze%20Cruise.zwo",
  "Steady%20Carousel.zwo",
  "Steel%20the%20Line.zwo",
  "Velvet%20Cadence.zwo",
  "Windline.zwo",
];

function installEnv(root: FakeFileSystemDirectoryHandle): void {
  const {indexedDB} = createFakeIndexedDB({});
  (globalThis as unknown as {indexedDB: unknown}).indexedDB = indexedDB;
  (globalThis as unknown as {showDirectoryPicker: () => Promise<unknown>}).showDirectoryPicker =
    () => Promise.resolve(root);
  // Serve /workouts/<name> from the bundled public assets (matching the app
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

  it("persists the picked folder so a reload (new store, same IndexedDB) loads it back", async () => {
    // Regression for the handle-shape bug: pickRootDir wrote handles via
    // setSetting ({key,value:{handle}}) but loadHandle reads record.handle, so
    // the folder never survived a reload and ALL file ops broke in the real app.
    // The harness hid it by seeding the read-shape directly; nothing exercised
    // the pick->persist->load round trip. This does.
    await new WebFileStore().pickRootDir();

    // Simulate a reload: a fresh store reading the SAME (fake) IndexedDB.
    const store2 = new WebFileStore();
    const rootHandle = (await store2.loadRootDirHandle()) as { name?: string } | null;
    expect(rootHandle, "root dir handle must survive a reload").not.toBeNull();
    expect(rootHandle?.name).toBe("VeloDrive");

    // The workouts dir resolves via the persisted handle (the loadHandle path),
    // so the library lists the seeded workouts after reload.
    const lib = await store2.listWorkouts();
    expect(lib.length).toBe(DEFAULT_NAMES.length);
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

  it("resumes an INTERRUPTED seed: backfills the stranded tail (incl. Sleepy Spin)", async () => {
    // Reproduces the real-world bug: the first seed pass was interrupted partway
    // (tab closed / blip), leaving the folder with only the alphabetical HEAD of
    // the defaults + the in-progress marker still set. The folder is now
    // non-empty, so a naive "bail if any .zwo exists" would have stranded the
    // tail (e.g. "Sleepy Spin", ~36/41) forever. The marker must let it resume.
    const workouts = await root.getDirectoryHandle("workouts", {create: true});
    for (const name of ["Airforge.zwo", "Ashen%20Surge.zwo", "Basefire%20Waves.zwo"]) {
      workouts.seedFile(name, "<workout_file></workout_file>");
    }
    // Re-seed IndexedDB with the in-progress marker (overrides beforeEach's env).
    const {indexedDB} = createFakeIndexedDB({
      defaultWorkoutsSeedInProgress: {key: "defaultWorkoutsSeedInProgress", value: true},
    });
    (globalThis as unknown as {indexedDB: unknown}).indexedDB = indexedDB;

    await new WebFileStore().pickRootDir();

    const names = await listZwoNames(workouts);
    expect(names).toEqual([...DEFAULT_NAMES].sort()); // backfilled to the full library
    expect(names).toContain("Sleepy%20Spin.zwo");
  });
});

describe("WebFileStore.removeScheduledByTitle (post-ride flow, J-PLAN-34)", () => {
  // Seed the root handle directly into the fake IndexedDB in the {key, handle}
  // shape loadHandle reads (matching the page-env hermetic seed), then write the
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

describe("WebFileStore.moveScheduledEntry (drag-and-drop reschedule, G3)", () => {
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

  // Far-future days so "today" never makes them past, regardless of run date.
  const FROM = "2099-06-18";
  const TO = "2099-06-25";
  const PAST = "2000-01-01";

  it("moves the matching entry to a future day and persists schedule.json", async () => {
    const {store} = bootConfigured([
      {date: FROM, workoutTitle: "Sleepy Spin"},
      {date: FROM, workoutTitle: "Keep Turning"},
    ]);
    const moved = await store.moveScheduledEntry(FROM, "Sleepy Spin", TO);
    expect(moved).toBe(true);

    const remaining = await store.loadSchedule();
    expect(remaining).toEqual([
      {date: FROM, workoutTitle: "Keep Turning"},
      {date: TO, workoutTitle: "Sleepy Spin"},
    ]);
  });

  it("rejects a move onto a PAST day (schedule unchanged)", async () => {
    const initial = [{date: FROM, workoutTitle: "Sleepy Spin"}];
    const {store} = bootConfigured(initial);
    const moved = await store.moveScheduledEntry(FROM, "Sleepy Spin", PAST);
    expect(moved).toBe(false);
    expect(await store.loadSchedule()).toEqual(initial);
  });

  it("is a no-op (true) when from===to and does not duplicate", async () => {
    const initial = [{date: FROM, workoutTitle: "Sleepy Spin"}];
    const {store} = bootConfigured(initial);
    const moved = await store.moveScheduledEntry(FROM, "Sleepy Spin", FROM);
    expect(moved).toBe(true);
    expect(await store.loadSchedule()).toEqual(initial);
  });

  it("returns false when no entry matches", async () => {
    const {store} = bootConfigured([{date: FROM, workoutTitle: "Sleepy Spin"}]);
    expect(await store.moveScheduledEntry(FROM, "Nonexistent", TO)).toBe(false);
  });
});

describe("WebFileStore.setSetting de-proxies values (selectedWorkout reload regression, R1)", () => {
  beforeEach(() => {
    installEnv(new FakeFileSystemDirectoryHandle("VeloDrive"));
  });
  afterEach(() => vi.restoreAllMocks());

  it("persists a clone-HOSTILE value as a plain, structured-clone-safe object", async () => {
    const store = new WebFileStore();
    // Stand-in for a Svelte $state proxy: a value the real structured-clone
    // algorithm REJECTS (a function property throws DataCloneError, exactly like
    // the $state proxy did in a real browser). Persisting it must not throw and
    // must round-trip as a plain object — else selectedWorkout is lost on reload.
    const hostile = {
      workoutTitle: "Sleepy Spin",
      rawSegments: [{power: 1}],
      textEvents: [],
      _fn: () => 1,
    };
    expect(() => structuredClone(hostile)).toThrow(); // input IS clone-hostile

    await store.putSetting("selectedWorkout", hostile);
    const back = await store.loadSelectedWorkout();

    expect(back).not.toBeNull();
    expect(back).toMatchObject({workoutTitle: "Sleepy Spin"});
    // The stored value is now plain -> survives the real structured clone.
    expect(() => structuredClone(back)).not.toThrow();
  });
});
