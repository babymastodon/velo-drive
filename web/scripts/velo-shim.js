// velo-shim.js  (classic script; injected FIRST by apply-shims.mjs)
//
// Default-to-real bootstrap. When `window.__VELO_TEST_ENV__` is present it
// swaps the platform providers the legacy app reads from globals; when absent
// it does nothing, so the shimmed copy is byte-for-byte equivalent to pristine.
//
// The test env (installed by the Playwright harness via addInitScript BEFORE
// this script runs) is a plain object with any of these optional fields:
//
//   clock: {                       // virtual clock (sinon-style)
//     setTimeout, clearTimeout, setInterval, clearInterval,
//     dateNow,                     // () => ms
//     performanceNow,              // () => ms (high-res, monotonic-ish)
//     DateClass,                   // a Date subclass whose now()/no-arg ctor are virtual
//   }
//   bluetooth: <navigator.bluetooth replacement>
//   audioContext: <AudioContext constructor replacement>
//   indexedDB: <indexedDB replacement>
//   showDirectoryPicker: <function>   // FSA root picker replacement
//
// Everything is optional and applied only if provided, so partial envs work.

(function () {
  "use strict";
  var env = window.__VELO_TEST_ENV__;
  if (!env) return; // default-to-real: no injection -> pristine behavior

  // ----- virtual clock -------------------------------------------------------
  if (env.clock) {
    var c = env.clock;
    if (c.setTimeout) window.setTimeout = c.setTimeout;
    if (c.clearTimeout) window.clearTimeout = c.clearTimeout;
    if (c.setInterval) window.setInterval = c.setInterval;
    if (c.clearInterval) window.clearInterval = c.clearInterval;

    if (c.DateClass) {
      // Replace the global Date so `new Date()`, `Date.now()`,
      // `new Date(x).toISOString()` etc. all read virtual time.
      window.Date = c.DateClass;
    } else if (c.dateNow) {
      var RealDate = window.Date;
      var FakeDate = function (a, b, d, e, f, g, h) {
        if (!(this instanceof FakeDate)) return new RealDate(c.dateNow()).toString();
        if (arguments.length === 0) return new RealDate(c.dateNow());
        return new RealDate(a, b, d, e, f, g, h);
      };
      FakeDate.prototype = RealDate.prototype;
      FakeDate.now = function () { return c.dateNow(); };
      FakeDate.parse = RealDate.parse;
      FakeDate.UTC = RealDate.UTC;
      window.Date = FakeDate;
    }

    if (c.performanceNow && window.performance) {
      try { window.performance.now = c.performanceNow; } catch (_e) {}
    }
  }

  // ----- Web Bluetooth (FTMS trainer / HR / battery) -------------------------
  if (env.bluetooth) {
    try {
      Object.defineProperty(navigator, "bluetooth", {
        value: env.bluetooth,
        configurable: true,
      });
    } catch (_e) {
      try { navigator.bluetooth = env.bluetooth; } catch (_e2) {}
    }
  }

  // ----- Web Audio (beeper) --------------------------------------------------
  if (env.audioContext) {
    window.AudioContext = env.audioContext;
    window.webkitAudioContext = env.audioContext;
  }

  // ----- IndexedDB (settings + dir handles) ----------------------------------
  if (env.indexedDB) {
    try {
      Object.defineProperty(window, "indexedDB", {
        value: env.indexedDB,
        configurable: true,
      });
    } catch (_e) {
      try { window.indexedDB = env.indexedDB; } catch (_e2) {}
    }
  }

  // ----- File System Access root picker --------------------------------------
  if (env.showDirectoryPicker) {
    window.showDirectoryPicker = env.showDirectoryPicker;
  }
})();
