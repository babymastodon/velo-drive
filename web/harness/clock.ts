// harness/clock.ts
//
// A sinon-style virtual clock that owns setTimeout / setInterval / Date.now /
// performance.now / new Date across the whole page. The app spreads time over
// five bases (engine setInterval tick, beeper setTimeout cascade, transport
// performance.now throttle + setTimeout reconnect, pause accounting via
// Date.now, FIT timestamps via `new Date`). One clock owns them all so the
// harness can advance time deterministically.
//
// `step(ms)` / `stepTicks(n)` advance virtual time AND drain microtasks between
// fired callbacks, because the engine tick is `async` and awaits BLE/FS before
// the next timer is allowed to observe the new state.
//
// This module is plain TS with no DOM/Node deps so it can be (a) imported in
// Vitest and (b) serialized into the page via Playwright `addInitScript`
// (see tests/e2e/fixtures.ts, which calls `createVirtualClock` inside the page).

export interface VirtualClock {
  // Drop-in global replacements.
  setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number;
  clearTimeout: (id?: number) => void;
  setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => number;
  clearInterval: (id?: number) => void;
  dateNow: () => number;
  performanceNow: () => number;
  DateClass: DateConstructor;

  // Test controls.
  now: () => number;
  /** Advance virtual time by `ms`, firing due timers in order, draining
   *  microtasks after each, so async tick bodies settle. */
  step: (ms: number) => Promise<void>;
  /** Advance in 1000ms increments `n` times (one engine tick per increment). */
  stepTicks: (n: number) => Promise<void>;
  /** Number of currently-scheduled timers (for leak diagnostics). */
  pending: () => number;
}

interface Timer {
  id: number;
  fn: (...a: unknown[]) => void;
  args: unknown[];
  dueAt: number; // virtual ms
  intervalMs: number | null; // null => one-shot
}

export interface VirtualClockOptions {
  /** Wall-clock epoch the virtual clock starts at (ms since 1970). */
  startMs?: number;
  /** performance.now() origin offset; defaults to 0 so it reads as uptime. */
  perfOrigin?: number;
}

export function createVirtualClock(opts: VirtualClockOptions = {}): VirtualClock {
  // Capture the REAL Date so DateClass below is not self-referential after the
  // shim swaps the global Date.
  const RealDate = Date;

  const startMs = opts.startMs ?? RealDate.UTC(2026, 0, 1, 12, 0, 0); // 2026-01-01T12:00:00Z
  let nowMs = startMs;
  const perfOrigin = opts.perfOrigin ?? 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();

  function schedule(
    fn: (...a: unknown[]) => void,
    ms: number | undefined,
    args: unknown[],
    intervalMs: number | null,
  ): number {
    const id = nextId++;
    const delay = Math.max(0, ms || 0);
    timers.set(id, {id, fn, args, dueAt: nowMs + delay, intervalMs});
    return id;
  }

  const setTimeoutFn = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    schedule(fn, ms, args, null);
  const setIntervalFn = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    schedule(fn, ms, args, Math.max(1, ms || 1));
  const clear = (id?: number) => {
    if (id != null) timers.delete(id);
  };

  // Microtask drain: yield enough times that chained `await`s settle. The
  // engine tick awaits at most a couple of promises (BLE write, FS write), so a
  // small fixed number of flushes is plenty and keeps `step` bounded.
  async function drainMicrotasks(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  }

  function nextDue(limitMs: number): Timer | null {
    let best: Timer | null = null;
    for (const t of timers.values()) {
      if (t.dueAt > limitMs) continue;
      if (!best || t.dueAt < best.dueAt || (t.dueAt === best.dueAt && t.id < best.id)) {
        best = t;
      }
    }
    return best;
  }

  async function step(ms: number): Promise<void> {
    const target = nowMs + Math.max(0, ms);
    // Fire all timers due at or before `target`, advancing virtual time to each
    // timer's dueAt as we go, draining microtasks after every callback.
    // Guard against runaway re-scheduling (e.g. a 1ms interval over a long step).
    let guard = 0;
    for (;;) {
      const t = nextDue(target);
      if (!t) break;
      if (++guard > 1_000_000) throw new Error("virtual clock: too many timer firings in one step");

      nowMs = Math.max(nowMs, t.dueAt);
      if (t.intervalMs == null) {
        timers.delete(t.id);
      } else {
        t.dueAt = nowMs + t.intervalMs; // reschedule interval
      }
      try {
        t.fn(...t.args);
      } catch (err) {
        // Match host timer semantics: a throwing callback doesn't stop the loop.
        // eslint-disable-next-line no-console
        console.error("[virtual-clock] timer callback threw:", err);
      }
      await drainMicrotasks();
    }
    nowMs = Math.max(nowMs, target);
    await drainMicrotasks();
  }

  async function stepTicks(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      // eslint-disable-next-line no-await-in-loop
      await step(1000);
    }
  }

  // A Date subclass whose no-arg ctor / now() read virtual time, while explicit
  // args behave normally. Instances are real Dates (instanceof works, all proto
  // methods intact), so `toISOString()` etc. are unaffected.
  class FakeDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) {
        super(nowMs);
      } else {
        super(...(a as ConstructorParameters<typeof Date>));
      }
    }
    static override now(): number {
      return nowMs;
    }
  }

  return {
    setTimeout: setTimeoutFn,
    clearTimeout: clear,
    setInterval: setIntervalFn,
    clearInterval: clear,
    dateNow: () => nowMs,
    // performance.now() reads as monotonic uptime since the clock's start.
    performanceNow: () => nowMs - startMs + perfOrigin,
    DateClass: FakeDate as unknown as DateConstructor,
    now: () => nowMs,
    step,
    stepTicks,
    pending: () => timers.size,
  };
}
