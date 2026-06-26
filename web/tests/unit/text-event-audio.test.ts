// tests/unit/text-event-audio.test.ts
//
// Asserts the engine fires beeper.playTextEventTaps exactly once when a text
// event becomes active during a running ride (J-RIDE-10). The companion
// theme-redraw-on-OS-flip assertion lives in tests/e2e/defects.new.spec.ts (the
// .svelte.ts theme store needs the Svelte compiler, which the e2e build has and
// this Node-only vitest config does not).

import {describe, it, expect, vi} from "vitest";

// --------------------------- engine text-event audio (J-RIDE-10) ---------------------------
describe("engine text-event audio cue", () => {
  it("fires playTextEventTaps once when a text event becomes active", async () => {
    const {WorkoutEngine} = await import("../../src/core/engine.js");

    const taps = vi.fn();
    const beeper = {
      setEnabled() {},
      keepAwake() {},
      releaseKeepAwake() {},
      runStartCountdown(onDone: () => void) {
        onDone();
      },
      showPausedOverlay() {},
      showResumedOverlay() {},
      playBeepPattern() {},
      playDangerDanger() {},
      playTextEventTaps: taps,
    };
    // Minimal transport + fileStore stubs (the engine only needs them present).
    const transport = {
      on() {},
      init() {},
      requestControl() {},
      setTargetPower() {},
      setTargetResistance() {},
      setSavedDeviceIds() {},
      setPersistDeviceIds() {},
      startNotifications() {},
    } as unknown as ConstructorParameters<typeof WorkoutEngine>[0]["transport"];
    const fileStore = {
      getSetting: async <T>(_k: string, d: T) => d,
      putSetting: async () => {},
      loadSelectedWorkout: async () => null,
      loadActiveState: async () => null,
      saveActiveState: async () => {},
      loadWorkoutDirHandle: async () => null,
    } as unknown as ConstructorParameters<typeof WorkoutEngine>[0]["fileStore"];

    const engine = new WorkoutEngine({
      transport,
      beeper,
      fileStore,
      saveWorkoutFile: false,
    });

    // Drive the private text-event check directly across an event window. Set a
    // workout with one text event at t=5s for 10s, mark the engine running.
    const e = engine as unknown as {
      canonicalWorkout: unknown;
      workoutRunning: boolean;
      workoutPaused: boolean;
      elapsedSec: number;
      maybePlayTextEvent: () => void;
    };
    e.canonicalWorkout = {
      workoutTitle: "T",
      rawSegments: [[1, 50, 50]],
      textEvents: [{offsetSec: 5, durationSec: 10, text: "Push!"}],
    };
    e.workoutRunning = true;
    e.workoutPaused = false;

    // Before the window: no tap.
    e.elapsedSec = 3;
    e.maybePlayTextEvent();
    expect(taps).toHaveBeenCalledTimes(0);

    // Becomes active: fires once.
    e.elapsedSec = 5;
    e.maybePlayTextEvent();
    expect(taps).toHaveBeenCalledTimes(1);

    // Still active next second: does NOT re-fire (deduped).
    e.elapsedSec = 6;
    e.maybePlayTextEvent();
    expect(taps).toHaveBeenCalledTimes(1);

    // After the window: no further tap.
    e.elapsedSec = 20;
    e.maybePlayTextEvent();
    expect(taps).toHaveBeenCalledTimes(1);
  });
});
