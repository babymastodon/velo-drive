// tests/unit/engine-state.test.ts
//
// Targeted unit tests for the 9 workout state-machine bug fixes in
// src/core/engine.ts (A1, A2, A4, P1, P2, P3, P4, P7, P8). Mirrors the
// fake-deps + private-field-poke style of text-event-audio.test.ts and drives
// the engine through an injectable virtual clock + setInterval/setTimeout so
// ticks are deterministic.

import {describe, it, expect, vi, beforeEach} from "vitest";

import type {WorkoutEngine as WorkoutEngineType} from "../../src/core/engine.js";
import type {CanonicalWorkout} from "../../src/core/model.js";
import type {ActiveState} from "../../src/ports/FileStore.js";
import type {
  TrainerState,
  BikeSample,
} from "../../src/ports/TrainerTransport.js";

// ---------------------------------------------------------------- harness ----

/** A controllable virtual clock + interval/timeout scheduler. */
function makeClock() {
  let nowMs = 0;
  type Timer = {id: number; fn: () => void; periodic: boolean; nextAt: number; ms: number};
  const timers = new Map<number, Timer>();
  let nextId = 1;

  return {
    now: () => nowMs,
    setInterval: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, {id, fn, periodic: true, nextAt: nowMs + ms, ms});
      return id;
    },
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, {id, fn, periodic: false, nextAt: nowMs + ms, ms});
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
    /** Advance the clock and fire the periodic ticker N times (1s each). */
    async tick(n = 1): Promise<void> {
      for (let i = 0; i < n; i++) {
        nowMs += 1000;
        for (const t of [...timers.values()]) {
          if (t.periodic && nowMs >= t.nextAt) {
            t.nextAt += t.ms;
            t.fn();
          }
        }
        // Let the async tick body (await sendTrainerState etc.) flush.
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    /** Advance the clock by ms without firing timers (simulate app-closed gap). */
    advance(ms: number) {
      nowMs += ms;
    },
    setNow(ms: number) {
      nowMs = ms;
    },
  };
}

function makeBeeper() {
  return {
    setEnabled() {},
    keepAwake() {},
    releaseKeepAwake() {},
    stopAll() {},
    // Synchronous countdown so beginRun runs inline (matches text-event test).
    runStartCountdown(onDone: () => void) {
      onDone();
    },
    showPausedOverlay: vi.fn(),
    showResumedOverlay: vi.fn(),
    playBeepPattern() {},
    playDangerDanger() {},
    playTextEventTaps() {},
  };
}

function makeTransport() {
  const setTrainerState = vi.fn(
    async (_st: TrainerState, _opts?: {force?: boolean}) => {},
  );
  const transport = {
    on() {
      return () => {};
    },
    off() {},
    init() {},
    connectBikeViaPicker: async () => {},
    connectHrViaPicker: async () => {},
    setTrainerState,
  } as unknown as ConstructorParameters<typeof WorkoutEngineType>[0]["transport"];
  return {transport, setTrainerState};
}

function makeFileStore(opts: {active?: ActiveState | null; selected?: CanonicalWorkout | null} = {}) {
  const saved: ActiveState[] = [];
  const fileStore = {
    loadSelectedWorkout: async () => opts.selected ?? null,
    getSetting: async <T>(_k: string, d: T) => d,
    putSetting: async () => {},
    loadBleDeviceIds: async () => ({bikeId: null, hrId: null}),
    loadActiveState: async () => opts.active ?? null,
    saveActiveState: async (s: ActiveState) => {
      saved.push(s);
    },
    loadWorkoutDirHandle: async () => null,
    loadRootDirHandle: async () => null,
    pickRootDir: async () => null,
  } as unknown as ConstructorParameters<typeof WorkoutEngineType>[0]["fileStore"];
  return {fileStore, saved};
}

async function makeEngine(opts: {
  active?: ActiveState | null;
  selected?: CanonicalWorkout | null;
  init?: boolean;
} = {}) {
  const {WorkoutEngine} = await import("../../src/core/engine.js");
  const clock = makeClock();
  const beeper = makeBeeper();
  const {transport, setTrainerState} = makeTransport();
  const {fileStore, saved} = makeFileStore({active: opts.active, selected: opts.selected});

  const engine = new WorkoutEngine({
    transport,
    beeper,
    fileStore,
    saveWorkoutFile: false,
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout,
  });

  if (opts.init !== false) {
    await engine.init({});
  }

  return {engine, clock, beeper, transport, setTrainerState, fileStore, saved};
}

// Typed accessor for private fields we poke/assert.
type Priv = {
  canonicalWorkout: unknown;
  workoutRunning: boolean;
  workoutPaused: boolean;
  workoutStarting: boolean;
  elapsedSec: number;
  workoutTotalSec: number;
  autoStartSuppressed: boolean;
  lastSamplePower: number | null;
  pauseStartedAtMs: number | null;
  manualPauseAutoResumeBlockedUntilMs: number;
  totalPausedMs: number;
  autoPauseDisabledUntilSec: number;
  freeRideMode: "erg" | "resistance";
};

const priv = (e: WorkoutEngineType) => e as unknown as Priv;

function bike(power: number): BikeSample {
  return {power, cadence: 90, speedKph: 30, hrFromBike: null};
}

const ERG_WORKOUT: CanonicalWorkout = {
  workoutTitle: "Erg",
  rawSegments: [[10, 50, 50]], // 10 min @ 50% FTP
} as unknown as CanonicalWorkout;

const RESISTANCE_FREERIDE: CanonicalWorkout = {
  workoutTitle: "Free",
  rawSegments: [[10, 0, 0, "freeride"]], // 10 min free-ride
} as unknown as CanonicalWorkout;

// ----------------------------------------------------------------- tests -----

describe("engine state-machine bug fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // A1 -----------------------------------------------------------------------
  it("A1: selecting a new workout after a finish re-arms auto-start", async () => {
    const {engine} = await makeEngine();
    // Simulate a finished ride: endWorkout sets autoStartSuppressed=true.
    priv(engine).autoStartSuppressed = true;

    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    expect(priv(engine).autoStartSuppressed).toBe(false);

    // Pedaling at/above threshold now auto-starts.
    engine.handleBikeSample(bike(200));
    expect(priv(engine).workoutStarting || priv(engine).workoutRunning).toBe(true);
  });

  // A2 -----------------------------------------------------------------------
  it("A2: empty-rawSegments workout is rejected and never crashes", async () => {
    const alerts: string[] = [];
    const {WorkoutEngine} = await import("../../src/core/engine.js");
    const clock = makeClock();
    const {transport} = makeTransport();
    const {fileStore} = makeFileStore();
    const engine = new WorkoutEngine({
      transport,
      beeper: makeBeeper(),
      fileStore,
      saveWorkoutFile: false,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      setTimeout: clock.setTimeout,
    });
    await engine.init({onAlert: (m) => alerts.push(m)});

    const empty = {workoutTitle: "Empty", rawSegments: []} as unknown as CanonicalWorkout;
    engine.setWorkoutFromPicker(empty);
    expect(alerts.some((m) => /no segments/i.test(m))).toBe(true);
    // Workout was NOT accepted.
    expect(priv(engine).canonicalWorkout).toBeNull();

    // Even if an empty workout slips in, sample + Start must not throw.
    priv(engine).canonicalWorkout = empty;
    expect(() => engine.handleBikeSample(bike(300))).not.toThrow();
    expect(() => engine.startWorkout()).not.toThrow();
    expect(priv(engine).workoutRunning).toBe(false);
  });

  // A4 + P4 ------------------------------------------------------------------
  it("A4: Space/Start during countdown is a no-op (no stray pause toggle)", async () => {
    const {WorkoutEngine} = await import("../../src/core/engine.js");
    const clock = makeClock();
    const {transport} = makeTransport();
    const {fileStore} = makeFileStore();
    // Countdown that does NOT auto-complete, so we can observe workoutStarting.
    const beeper = {
      ...makeBeeper(),
      runStartCountdown(_onDone: () => void) {
        /* hold in countdown */
      },
    };
    const engine = new WorkoutEngine({
      transport,
      beeper,
      fileStore,
      saveWorkoutFile: false,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      setTimeout: clock.setTimeout,
    });
    await engine.init({});
    priv(engine).canonicalWorkout = structuredClone(ERG_WORKOUT);

    engine.startWorkout(); // enters countdown
    expect(priv(engine).workoutStarting).toBe(true);
    expect(priv(engine).workoutPaused).toBe(false);

    engine.startWorkout(); // Space during countdown — must be a no-op
    expect(priv(engine).workoutStarting).toBe(true);
    expect(priv(engine).workoutPaused).toBe(false);
  });

  // P1 -----------------------------------------------------------------------
  it("P1: resistance free-ride auto-pauses then auto-resumes on power", async () => {
    const {engine, clock, beeper} = await makeEngine();
    engine.setFreeRideMode("resistance");
    engine.setWorkoutFromPicker(structuredClone(RESISTANCE_FREERIDE));
    engine.startWorkout(); // synchronous countdown → running
    expect(priv(engine).workoutRunning).toBe(true);
    expect(priv(engine).workoutPaused).toBe(false);

    // Ride past the 15s grace with power, then drop to 0 → auto-pause.
    engine.handleBikeSample(bike(150));
    await clock.tick(16);
    engine.handleBikeSample(bike(0));
    await clock.tick(2);
    expect(priv(engine).workoutPaused).toBe(true);

    // Resume pedaling — ERG 0.9×target rule can't apply (target is null), so the
    // resistance branch must auto-resume on positive power.
    engine.handleBikeSample(bike(120));
    await clock.tick(1);
    expect(priv(engine).workoutPaused).toBe(false);
    expect(beeper.showResumedOverlay).toHaveBeenCalled();
    // P4: auto-resume clears the manual-pause block for symmetry.
    expect(priv(engine).manualPauseAutoResumeBlockedUntilMs).toBe(0);
  });

  // S1 -----------------------------------------------------------------------
  it("S1: a stalled feed (samples stop) is treated as zero power → auto-pause", async () => {
    const {engine, clock} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    // Ride past the 15s grace WITH power flowing every second (advances the feed
    // clock so lastBikeSampleMs is non-zero and fresh).
    for (let i = 0; i < 16; i++) {
      engine.handleBikeSample(bike(150));
      await clock.tick(1);
    }
    expect(priv(engine).workoutPaused).toBe(false);

    // Feed stops (BLE link up, notifications dead): no more handleBikeSample.
    // lastSamplePower stays 150, but after >STALE_SAMPLE_MS (12s) with no fresh
    // sample it's treated as 0, so the ride auto-pauses instead of coasting on.
    clock.advance(14_000);
    await clock.tick(1);
    expect(priv(engine).workoutPaused).toBe(true);
  });

  // S2 -----------------------------------------------------------------------
  it("S2: a ride left paused past the idle window auto-ends", async () => {
    const {engine, clock} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    // Get running past grace, then drop to 0 → auto-pause.
    for (let i = 0; i < 16; i++) {
      engine.handleBikeSample(bike(150));
      await clock.tick(1);
    }
    engine.handleBikeSample(bike(0));
    await clock.tick(2);
    expect(priv(engine).workoutPaused).toBe(true);
    expect(priv(engine).pauseStartedAtMs).not.toBeNull();

    // Left paused past the 20-minute idle window → the ride auto-ends so it can't
    // run (and beep) indefinitely in the background.
    clock.advance(20 * 60_000 + 1000);
    await clock.tick(1);
    expect(priv(engine).workoutRunning).toBe(false);
    expect(priv(engine).workoutPaused).toBe(false);
  });

  // P2 -----------------------------------------------------------------------
  it("P2: FTP / ERG / mode changes while paused do NOT force-send to trainer", async () => {
    const {engine, setTrainerState} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    // Manually pause.
    engine.startWorkout(); // running → pause (workoutStarting is false now)
    expect(priv(engine).workoutPaused).toBe(true);

    setTrainerState.mockClear();
    engine.setFtp(260);
    engine.adjustManualErg(10);
    engine.setFreeRideMode("resistance");
    engine.adjustManualResistance(5);
    // No forced send should have reached the trainer while paused.
    expect(setTrainerState).not.toHaveBeenCalled();
    // But state still updated + persisted (FTP applied).
    expect(engine.getViewModel().currentFtp).toBe(260);
  });

  it("P2: FTP change while NOT paused still force-sends", async () => {
    const {engine, setTrainerState} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    expect(priv(engine).workoutRunning).toBe(true);
    expect(priv(engine).workoutPaused).toBe(false);
    setTrainerState.mockClear();
    engine.setFtp(260);
    await Promise.resolve();
    expect(setTrainerState).toHaveBeenCalledWith(
      expect.objectContaining({kind: "erg"}),
      expect.objectContaining({force: true}),
    );
  });

  // P3 -----------------------------------------------------------------------
  it("P3: manual resume force-re-sends the held target", async () => {
    const {engine, setTrainerState} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    engine.startWorkout(); // pause
    expect(priv(engine).workoutPaused).toBe(true);

    setTrainerState.mockClear();
    engine.startWorkout(); // resume
    await Promise.resolve();
    await Promise.resolve();
    expect(priv(engine).workoutPaused).toBe(false);
    expect(setTrainerState).toHaveBeenCalledWith(
      expect.objectContaining({kind: "erg"}),
      expect.objectContaining({force: true}),
    );
  });

  it("P3: auto-resume force-re-sends the held target", async () => {
    const {engine, clock, setTrainerState} = await makeEngine();
    engine.setWorkoutFromPicker(structuredClone(ERG_WORKOUT));
    engine.startWorkout();
    // Ride past grace, drop power → auto-pause.
    engine.handleBikeSample(bike(150));
    await clock.tick(16);
    engine.handleBikeSample(bike(0));
    await clock.tick(2);
    expect(priv(engine).workoutPaused).toBe(true);

    setTrainerState.mockClear();
    // Pedal at >=0.9*target (target = 50% of default FTP ~ 100-130W) → auto-resume.
    engine.handleBikeSample(bike(400));
    await clock.tick(1);
    expect(priv(engine).workoutPaused).toBe(false);
    expect(setTrainerState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({force: true}),
    );
  });

  // P7 -----------------------------------------------------------------------
  it("P7: restoring a ride at/after total finalizes instead of staying paused", async () => {
    const ended: unknown[] = [];
    const active: ActiveState = {
      canonicalWorkout: ERG_WORKOUT, // total = 600s
      workoutRunning: true,
      workoutPaused: false,
      elapsedSec: 600,
      liveSamples: [{t: 600, power: 100, hr: null, cadence: 80, targetPower: 100}],
      workoutStartedAt: new Date(0).toISOString(),
    };
    const {engine} = await makeEngine({active, init: false});
    await engine.init({onWorkoutEnded: (i) => ended.push(i)});

    // Finalized: not running, not paused, elapsed reset.
    expect(priv(engine).workoutRunning).toBe(false);
    expect(priv(engine).workoutPaused).toBe(false);
    expect(priv(engine).elapsedSec).toBe(0);
    expect(ended.length).toBe(1);
  });

  it("P7: restoring a mid-ride still arms a paused ticker (unchanged)", async () => {
    const active: ActiveState = {
      canonicalWorkout: ERG_WORKOUT,
      workoutRunning: true,
      workoutPaused: false,
      elapsedSec: 120,
      liveSamples: [],
      workoutStartedAt: new Date(0).toISOString(),
    };
    const {engine} = await makeEngine({active, init: false});
    await engine.init({});
    expect(priv(engine).workoutRunning).toBe(true);
    expect(priv(engine).workoutPaused).toBe(true);
    expect(priv(engine).elapsedSec).toBe(120);
  });

  // P8 -----------------------------------------------------------------------
  it("P8: restore nulls pauseStartedAtMs so the app-closed gap is not counted", async () => {
    const priorPauseMs = 1_000_000;
    const active: ActiveState = {
      canonicalWorkout: ERG_WORKOUT,
      workoutRunning: true,
      workoutPaused: true,
      elapsedSec: 120,
      liveSamples: [],
      pauseStartedAtMs: priorPauseMs,
      manualPauseAutoResumeBlockedUntilMs: priorPauseMs + 50_000,
      totalPausedMs: 5_000,
      workoutStartedAt: new Date(0).toISOString(),
    };
    const {engine, clock} = await makeEngine({active, init: false});
    // Simulate a large app-closed gap by jumping the clock far past the prior ms.
    clock.setNow(priorPauseMs + 10_000_000);
    await engine.init({});

    expect(priv(engine).pauseStartedAtMs).toBeNull();
    expect(priv(engine).manualPauseAutoResumeBlockedUntilMs).toBe(0);
    // totalPausedMs preserved from the snapshot, NOT inflated by the gap.
    expect(priv(engine).totalPausedMs).toBe(5_000);
  });
});
