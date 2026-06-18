// shim.ts
//
// Default-to-real platform bootstrap for the NEW app, mirroring
// web/scripts/velo-shim.js. When `window.__VELO_TEST_ENV__` is present (injected
// by the Playwright harness BEFORE app code runs) it swaps the platform
// providers the ports read from globals (navigator.bluetooth, timers, Date,
// AudioContext, indexedDB, showDirectoryPicker); when absent it is a no-op, so
// production behavior is pristine.
//
// This must be imported FIRST in main.ts, before any port/engine module that
// captures these globals.

interface VeloTestEnv {
  clock?: {
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
    dateNow?: () => number;
    performanceNow?: () => number;
    DateClass?: DateConstructor;
  };
  bluetooth?: unknown;
  audioContext?: unknown;
  indexedDB?: IDBFactory;
  showDirectoryPicker?: unknown;
}

export function installPlatformShim(): void {
  const env = (window as unknown as { __VELO_TEST_ENV__?: VeloTestEnv }).__VELO_TEST_ENV__;
  if (!env) return; // default-to-real

  const w = window as unknown as Record<string, unknown>;

  if (env.clock) {
    const c = env.clock;
    if (c.setTimeout) window.setTimeout = c.setTimeout;
    if (c.clearTimeout) window.clearTimeout = c.clearTimeout;
    if (c.setInterval) window.setInterval = c.setInterval;
    if (c.clearInterval) window.clearInterval = c.clearInterval;

    if (c.DateClass) {
      window.Date = c.DateClass;
    } else if (c.dateNow) {
      const dateNow = c.dateNow;
      const RealDate = window.Date;
      const FakeDate = function (this: unknown, ...args: unknown[]): Date | string {
        if (!(this instanceof FakeDate)) return new RealDate(dateNow()).toString();
        if (args.length === 0) return new RealDate(dateNow());
        // @ts-expect-error variadic Date ctor passthrough
        return new RealDate(...args);
      } as unknown as DateConstructor;
      (FakeDate as unknown as { prototype: unknown }).prototype = RealDate.prototype;
      FakeDate.now = () => dateNow();
      FakeDate.parse = RealDate.parse;
      FakeDate.UTC = RealDate.UTC;
      window.Date = FakeDate;
    }

    if (c.performanceNow && window.performance) {
      try {
        window.performance.now = c.performanceNow;
      } catch {
        /* ignore */
      }
    }
  }

  if (env.bluetooth) {
    try {
      Object.defineProperty(navigator, 'bluetooth', { value: env.bluetooth, configurable: true });
    } catch {
      try {
        (navigator as unknown as Record<string, unknown>).bluetooth = env.bluetooth;
      } catch {
        /* ignore */
      }
    }
  }

  if (env.audioContext) {
    w.AudioContext = env.audioContext;
    w.webkitAudioContext = env.audioContext;
  }

  if (env.indexedDB) {
    try {
      Object.defineProperty(window, 'indexedDB', { value: env.indexedDB, configurable: true });
    } catch {
      try {
        w.indexedDB = env.indexedDB;
      } catch {
        /* ignore */
      }
    }
  }

  if (env.showDirectoryPicker) {
    w.showDirectoryPicker = env.showDirectoryPicker;
  }
}
