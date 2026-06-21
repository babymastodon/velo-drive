// harness/page-env.js  (plain ES, no imports)
//
// Self-contained, page-side build of the whole hermetic test env. Playwright
// injects this via `addInitScript({ path })` BEFORE the app loads. It builds:
//   * a virtual clock (setTimeout/setInterval/Date/performance.now)
//   * an in-memory File System Access dir tree + fake IndexedDB (settings)
//   * an FTMS trainer simulator (fake navigator.bluetooth)
//   * an audio recorder (fake AudioContext)
// then installs them on `window.__VELO_TEST_ENV__` (consumed by the app shim)
// and exposes a control API on `window.__VELO_HARNESS__` so tests can drive a
// ride (advance time, emit BLE samples, inspect control-point writes, etc.).
//
// The TS modules under harness/*.ts are the typed source-of-truth and the
// Vitest self-test target; this file is the runtime-inlined equivalent. Keep the
// FTMS byte layout here in sync with harness/ftms.ts.
//
// Configuration is read from `window.__VELO_HARNESS_CONFIG__` if present
// (FTP, soundEnabled, themeMode, selectedWorkout, startMs, seedZwo, schedule).

(function () {
  "use strict";

  var cfg = window.__VELO_HARNESS_CONFIG__ || {};

  // =====================================================================
  // Virtual clock
  // =====================================================================
  function createVirtualClock(startMs) {
    var RealDate = Date;
    var nowMs = (typeof startMs === "number") ? startMs : RealDate.UTC(2026, 0, 1, 12, 0, 0);
    var startAt = nowMs;
    var nextId = 1;
    var timers = new Map();

    function schedule(fn, ms, args, intervalMs) {
      var id = nextId++;
      var delay = Math.max(0, ms || 0);
      timers.set(id, {id: id, fn: fn, args: args, dueAt: nowMs + delay, intervalMs: intervalMs});
      return id;
    }
    function clear(id) { if (id != null) timers.delete(id); }

    function drain() {
      var p = Promise.resolve();
      for (var i = 0; i < 8; i++) p = p.then(function () {});
      return p;
    }
    function nextDue(limit) {
      var best = null;
      timers.forEach(function (t) {
        if (t.dueAt > limit) return;
        if (!best || t.dueAt < best.dueAt || (t.dueAt === best.dueAt && t.id < best.id)) best = t;
      });
      return best;
    }
    function step(ms) {
      var target = nowMs + Math.max(0, ms);
      var guard = 0;
      function loop() {
        var t = nextDue(target);
        if (!t) {
          nowMs = Math.max(nowMs, target);
          return drain();
        }
        if (++guard > 1000000) throw new Error("virtual clock runaway");
        nowMs = Math.max(nowMs, t.dueAt);
        if (t.intervalMs == null) timers.delete(t.id);
        else t.dueAt = nowMs + t.intervalMs;
        try { t.fn.apply(null, t.args); }
        catch (err) { console.error("[clock] timer threw:", err); }
        return drain().then(loop);
      }
      return Promise.resolve().then(loop);
    }
    function stepTicks(n) {
      var p = Promise.resolve();
      for (var i = 0; i < n; i++) p = p.then(function () { return step(1000); });
      return p;
    }

    function FakeDate() {
      if (arguments.length === 0) return new RealDate(nowMs);
      return new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))();
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = function () { return nowMs; };
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;

    return {
      setTimeout: function (fn, ms) { return schedule(fn, ms, [].slice.call(arguments, 2), null); },
      clearTimeout: clear,
      setInterval: function (fn, ms) { return schedule(fn, ms, [].slice.call(arguments, 2), Math.max(1, ms || 1)); },
      clearInterval: clear,
      dateNow: function () { return nowMs; },
      performanceNow: function () { return nowMs - startAt; },
      DateClass: FakeDate,
      now: function () { return nowMs; },
      step: step,
      stepTicks: stepTicks,
      pending: function () { return timers.size; }
    };
  }

  // =====================================================================
  // In-memory File System Access + fake IndexedDB
  // =====================================================================
  function bytesOf(data) {
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && typeof data.arrayBuffer === "function") {
      return data.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }
    return new Uint8Array(0);
  }

  function FakeFileHandle(name, bytes) {
    this.kind = "file";
    this.name = name;
    this._bytes = bytes || new Uint8Array(0);
  }
  FakeFileHandle.prototype.getFile = function () {
    var bytes = this._bytes;
    return Promise.resolve({
      name: this.name,
      size: bytes.byteLength,
      text: function () { return Promise.resolve(new TextDecoder().decode(bytes)); },
      arrayBuffer: function () { return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
    });
  };
  FakeFileHandle.prototype.createWritable = function () {
    var self = this;
    var chunks = [];
    return Promise.resolve({
      write: function (data) {
        return Promise.resolve(bytesOf(data)).then(function (b) { chunks.push(b); });
      },
      close: function () {
        var total = 0, i;
        for (i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
        var merged = new Uint8Array(total), off = 0;
        for (i = 0; i < chunks.length; i++) { merged.set(chunks[i], off); off += chunks[i].byteLength; }
        self._bytes = merged;
        return Promise.resolve();
      }
    });
  };
  FakeFileHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  FakeFileHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };

  function FakeDirHandle(name) {
    this.kind = "directory";
    this.name = name || "root";
    this._files = new Map();
    this._dirs = new Map();
  }
  FakeDirHandle.prototype.getDirectoryHandle = function (name, opts) {
    var d = this._dirs.get(name);
    if (!d) {
      if (!opts || !opts.create) return Promise.reject(notFound(name));
      d = new FakeDirHandle(name);
      this._dirs.set(name, d);
    }
    return Promise.resolve(d);
  };
  FakeDirHandle.prototype.getFileHandle = function (name, opts) {
    var f = this._files.get(name);
    if (!f) {
      if (!opts || !opts.create) return Promise.reject(notFound(name));
      f = new FakeFileHandle(name);
      this._files.set(name, f);
    }
    return Promise.resolve(f);
  };
  FakeDirHandle.prototype.removeEntry = function (name) {
    if (!this._files.delete(name) && !this._dirs.delete(name)) return Promise.reject(notFound(name));
    return Promise.resolve();
  };
  FakeDirHandle.prototype.values = function () {
    var files = Array.from(this._files.values());
    var dirs = Array.from(this._dirs.values());
    var all = files.concat(dirs);
    var i = 0;
    var iterator = {
      next: function () {
        return Promise.resolve(i < all.length ? {value: all[i++], done: false} : {value: undefined, done: true});
      }
    };
    iterator[Symbol.asyncIterator] = function () { return this; };
    return iterator;
  };
  // Provide a real async iterator (for await ... of)
  FakeDirHandle.prototype[Symbol.asyncIterator] = function () { return this.values(); };
  FakeDirHandle.prototype.queryPermission = function () { return Promise.resolve("granted"); };
  FakeDirHandle.prototype.requestPermission = function () { return Promise.resolve("granted"); };
  FakeDirHandle.prototype.seedFile = function (name, content) {
    var bytes = (typeof content === "string") ? new TextEncoder().encode(content) : content;
    var f = new FakeFileHandle(name, bytes);
    this._files.set(name, f);
    return f;
  };

  function notFound(name) {
    var e = new Error('Entry "' + name + '" not found');
    e.name = "NotFoundError";
    return e;
  }

  // ---- fake IndexedDB ----
  function createFakeIndexedDB(seed) {
    var store = new Map();
    if (seed) {
      Object.keys(seed).forEach(function (k) {
        var rec = seed[k]; rec.key = k; store.set(k, rec);
      });
    }
    function req(resolveWith) {
      var r = {onsuccess: null, onerror: null, result: undefined, error: undefined};
      Promise.resolve().then(function () {
        try { r.result = resolveWith(); if (r.onsuccess) r.onsuccess({target: r}); }
        catch (err) { r.error = err; if (r.onerror) r.onerror({target: r}); }
      });
      return r;
    }
    function objectStore() {
      return {
        put: function (record) { store.set(record.key, record); return req(function () { return record.key; }); },
        get: function (key) { return req(function () { return store.get(key); }); },
        delete: function (key) { store.delete(key); return req(function () { return undefined; }); }
      };
    }
    function transaction() {
      var tx = {oncomplete: null, onerror: null, error: null, objectStore: objectStore};
      Promise.resolve().then(function () { if (tx.oncomplete) tx.oncomplete(); });
      return tx;
    }
    var db = {
      objectStoreNames: { _s: new Set(["settings"]), contains: function (n) { return this._s.has(n); } },
      createObjectStore: function (n) { this.objectStoreNames._s.add(n); return {}; },
      transaction: transaction
    };
    return {
      _store: store,
      indexedDB: {
        open: function () {
          var r = {onupgradeneeded: null, onsuccess: null, onerror: null, result: undefined, error: undefined};
          Promise.resolve().then(function () {
            try { if (r.onupgradeneeded) r.onupgradeneeded({target: {result: db}}); } catch (e) {}
            r.result = db;
            if (r.onsuccess) r.onsuccess({target: r});
          });
          return r;
        }
      }
    };
  }

  // =====================================================================
  // FTMS trainer simulator (fake navigator.bluetooth)
  // =====================================================================
  var FTMS = {
    SERVICE: 0x1826, HR_SERVICE: 0x180d, BATTERY_SERVICE: 0x180f,
    INDOOR_BIKE_DATA: 0x2ad2, CONTROL_POINT: 0x2ad9, HR_MEAS: 0x2a37, BATTERY_LEVEL: 0x2a19
  };
  var FTMS_OPCODES = {
    requestControl: 0x00, setTargetResistanceLevel: 0x04, setTargetPower: 0x05, startOrResume: 0x07
  };

  function encodeIndoorBikeData(s) {
    var hasSpeed = s.speedKph != null, hasCad = s.cadence != null, hasPow = s.power != null, hasHr = s.hr != null;
    var flags = 0;
    if (!hasSpeed) flags |= 0x0001;
    if (hasCad) flags |= (1 << 2);
    if (hasPow) flags |= (1 << 6);
    if (hasHr) flags |= (1 << 9);
    var len = 2 + (hasSpeed ? 2 : 0) + (hasCad ? 2 : 0) + (hasPow ? 2 : 0) + (hasHr ? 1 : 0);
    var dv = new DataView(new ArrayBuffer(len)); var i = 0;
    dv.setUint16(i, flags, true); i += 2;
    if (hasSpeed) { dv.setUint16(i, Math.round(s.speedKph * 100), true); i += 2; }
    if (hasCad) { dv.setUint16(i, Math.round(s.cadence * 2), true); i += 2; }
    if (hasPow) { dv.setInt16(i, Math.round(s.power), true); i += 2; }
    if (hasHr) { dv.setUint8(i, Math.round(s.hr) & 0xff); i += 1; }
    return dv;
  }
  function encodeHr(bpm) {
    var dv = new DataView(new ArrayBuffer(2));
    dv.setUint8(0, 0x00); dv.setUint8(1, Math.round(bpm) & 0xff);
    return dv;
  }
  function encodeCpResponse(reqOp) {
    var dv = new DataView(new ArrayBuffer(3));
    dv.setUint8(0, 0x80); dv.setUint8(1, reqOp); dv.setUint8(2, 0x01);
    return dv;
  }
  function parseCpWrite(buf) {
    var dv = (buf instanceof DataView) ? buf : new DataView(buf);
    var op = dv.getUint8(0);
    var param = dv.byteLength >= 3 ? dv.getInt16(1, true) : null;
    var value = null;
    if (op === FTMS_OPCODES.setTargetPower) value = param;
    else if (op === FTMS_OPCODES.setTargetResistanceLevel) value = (param == null ? null : param / 10);
    var raw = []; for (var i = 0; i < dv.byteLength; i++) raw.push(dv.getUint8(i));
    return {opcode: op, param: param, value: value, raw: raw};
  }

  function FakeChar(uuid) { this.uuid = uuid; this.value = null; this._listeners = new Set(); this.onWrite = null; this.readFactory = null; }
  FakeChar.prototype.startNotifications = function () { return Promise.resolve(this); };
  FakeChar.prototype.stopNotifications = function () { return Promise.resolve(this); };
  FakeChar.prototype.addEventListener = function (t, fn) { if (t === "characteristicvaluechanged") this._listeners.add(fn); };
  FakeChar.prototype.removeEventListener = function (t, fn) { if (t === "characteristicvaluechanged") this._listeners.delete(fn); };
  FakeChar.prototype.notify = function (value) {
    this.value = value;
    var arr = Array.from(this._listeners);
    for (var i = 0; i < arr.length; i++) { try { arr[i]({target: {value: value}}); } catch (e) { console.error("[ftms-sim]", e); } }
  };
  FakeChar.prototype.writeValueWithResponse = function (buf) { if (this.onWrite) this.onWrite(buf); return Promise.resolve(); };
  FakeChar.prototype.writeValue = function (buf) { if (this.onWrite) this.onWrite(buf); return Promise.resolve(); };
  FakeChar.prototype.readValue = function () { var v = this.readFactory ? this.readFactory() : (this.value || new DataView(new ArrayBuffer(0))); this.value = v; return Promise.resolve(v); };

  function FakeService(uuid) { this.uuid = uuid; this._chars = new Map(); }
  FakeService.prototype.add = function (c) { this._chars.set(c.uuid, c); return c; };
  FakeService.prototype.getCharacteristic = function (uuid) {
    var c = this._chars.get(uuid);
    return c ? Promise.resolve(c) : Promise.reject(notFound("char " + uuid));
  };

  function FakeGatt(device, services) { this.connected = false; this.device = device; this._services = services; }
  FakeGatt.prototype.connect = function () { this.connected = true; return Promise.resolve(this); };
  FakeGatt.prototype.disconnect = function () { if (!this.connected) return; this.connected = false; this.device._fireDisconnect(); };
  FakeGatt.prototype.getPrimaryService = function (uuid) {
    var s = this._services.get(uuid);
    return s ? Promise.resolve(s) : Promise.reject(notFound("service " + uuid));
  };

  function FakeDevice(id, name) {
    this.id = id; this.name = name;
    this._services = new Map();
    this._disc = new Set();
    this.gatt = new FakeGatt(this, this._services);
  }
  FakeDevice.prototype.addService = function (s) { this._services.set(s.uuid, s); return s; };
  FakeDevice.prototype.addEventListener = function (t, fn) { if (t === "gattserverdisconnected") this._disc.add(fn); };
  FakeDevice.prototype.removeEventListener = function (t, fn) { if (t === "gattserverdisconnected") this._disc.delete(fn); };
  FakeDevice.prototype._fireDisconnect = function () { Array.from(this._disc).forEach(function (fn) { try { fn(); } catch (e) { console.error("[ftms-sim]", e); } }); };

  function createFtmsSim(options) {
    options = options || {};
    var bikeId = options.bikeId || "sim-bike-0001";
    var bikeName = options.bikeName || "VeloDrive Sim Trainer";
    var hrId = options.hrId || "sim-hr-0001";
    var hrName = options.hrName || "VeloDrive Sim HRM";
    var state = {
      power: options.power != null ? options.power : 150,
      cadence: options.cadence != null ? options.cadence : 90,
      speedKph: options.speedKph != null ? options.speedKph : 30,
      hr: options.hr != null ? options.hr : 140,
      batteryPercent: options.batteryPercent != null ? options.batteryPercent : 88
    };
    var controlPointWrites = [];

    var bike = new FakeDevice(bikeId, bikeName);
    var ftms = bike.addService(new FakeService(FTMS.SERVICE));
    var bikeBattery = bike.addService(new FakeService(FTMS.BATTERY_SERVICE));
    var indoorChar = ftms.add(new FakeChar(FTMS.INDOOR_BIKE_DATA));
    var cpChar = ftms.add(new FakeChar(FTMS.CONTROL_POINT));
    var bikeBatChar = bikeBattery.add(new FakeChar(FTMS.BATTERY_LEVEL));
    bikeBatChar.readFactory = function () { var dv = new DataView(new ArrayBuffer(1)); dv.setUint8(0, state.batteryPercent & 0xff); return dv; };
    cpChar.onWrite = function (buf) {
      var decoded = parseCpWrite(buf);
      controlPointWrites.push(decoded);
      cpChar.notify(encodeCpResponse(decoded.opcode));
    };

    var hrDev = new FakeDevice(hrId, hrName);
    var hrSvc = hrDev.addService(new FakeService(FTMS.HR_SERVICE));
    var hrBat = hrDev.addService(new FakeService(FTMS.BATTERY_SERVICE));
    var hrChar = hrSvc.add(new FakeChar(FTMS.HR_MEAS));
    var hrBatChar = hrBat.add(new FakeChar(FTMS.BATTERY_LEVEL));
    hrBatChar.readFactory = function () { var dv = new DataView(new ArrayBuffer(1)); dv.setUint8(0, state.batteryPercent & 0xff); return dv; };

    function requestDevice(opts) {
      var wantsHr = JSON.stringify(opts || {}).indexOf(String(FTMS.HR_SERVICE)) >= 0;
      return Promise.resolve(wantsHr ? hrDev : bike);
    }
    function getDevices() { return Promise.resolve([bike, hrDev]); }

    function emitBikeData(over) {
      over = over || {};
      indoorChar.notify(encodeIndoorBikeData({
        power: over.power !== undefined ? over.power : state.power,
        cadence: over.cadence !== undefined ? over.cadence : state.cadence,
        speedKph: over.speedKph !== undefined ? over.speedKph : state.speedKph,
        hr: over.hr !== undefined ? over.hr : null
      }));
    }
    function emitHr(bpm) { hrChar.notify(encodeHr(bpm != null ? bpm : (state.hr || 0))); }

    return {
      bluetooth: {requestDevice: requestDevice, getDevices: getDevices},
      controlPointWrites: controlPointWrites,
      state: state,
      setReportedPower: function (w) { state.power = w; },
      setReportedCadence: function (r) { state.cadence = r; },
      setReportedHr: function (b) { state.hr = b; },
      setReportedSpeed: function (s) { state.speedKph = s; },
      emitBikeData: emitBikeData,
      emitHr: emitHr,
      disconnectBike: function () { bike.gatt.disconnect(); },
      bikeDeviceId: bikeId,
      hrDeviceId: hrId
    };
  }

  // =====================================================================
  // Audio recorder (fake AudioContext)
  // =====================================================================
  function createAudioRecorder() {
    var events = [];
    function param(v) {
      return {value: v, setValueAtTime: f, linearRampToValueAtTime: f, exponentialRampToValueAtTime: f, setTargetAtTime: f};
      function f() { return this; }
    }
    function FakeAudioContext() {
      this.state = "running";
      this.currentTime = 0;
      this.destination = {connect: function () { return this; }, disconnect: function () {}};
    }
    FakeAudioContext.prototype.createGain = function () {
      return {gain: param(1), connect: function () { return this; }, disconnect: function () {}};
    };
    FakeAudioContext.prototype.createBiquadFilter = function () {
      return {type: "lowpass", frequency: param(350), Q: param(1), connect: function () { return this; }, disconnect: function () {}};
    };
    FakeAudioContext.prototype.createOscillator = function () {
      var ctx = this;
      var osc = {
        type: "sine", frequency: param(440), detune: param(0), onended: null,
        connect: function () { return this; }, disconnect: function () {},
        start: function (when) { events.push({type: "oscillator-start", freq: osc.frequency.value, oscType: osc.type, at: (when == null ? ctx.currentTime : when)}); },
        stop: function () { if (osc.onended) { try { osc.onended(); } catch (e) {} } }
      };
      return osc;
    };
    FakeAudioContext.prototype.resume = function () { this.state = "running"; return Promise.resolve(); };
    FakeAudioContext.prototype.suspend = function () { this.state = "suspended"; return Promise.resolve(); };
    FakeAudioContext.prototype.close = function () { this.state = "closed"; return Promise.resolve(); };
    return {AudioContextClass: FakeAudioContext, events: events, toneCount: function () { return events.length; }, reset: function () { events.length = 0; }};
  }

  // =====================================================================
  // Assemble env + seed configured state
  // =====================================================================
  var clock = createVirtualClock(cfg.startMs);
  var sim = createFtmsSim(cfg.sim || {});
  var audio = createAudioRecorder();

  // Build the configured root dir tree: root/workouts (seeded .zwo) + history + trash.
  var root = new FakeDirHandle("VeloDrive");
  var workoutsDir = new FakeDirHandle("workouts");
  var historyDir = new FakeDirHandle("history");
  var trashDir = new FakeDirHandle("trash");
  root._dirs.set("workouts", workoutsDir);
  root._dirs.set("history", historyDir);
  root._dirs.set("trash", trashDir);
  if (cfg.seedZwo) {
    Object.keys(cfg.seedZwo).forEach(function (name) { workoutsDir.seedFile(name, cfg.seedZwo[name]); });
  }
  if (cfg.schedule) {
    root.seedFile("schedule.json", JSON.stringify(cfg.schedule));
  }

  // Seed the IndexedDB "settings" store so the app boots CONFIGURED.
  var seed = {
    rootDirHandle: {handle: root},
    dirHandle: {handle: workoutsDir},
    workoutDirHandle: {handle: historyDir},
    trashDirHandle: {handle: trashDir},
    ftp: {value: cfg.ftp != null ? cfg.ftp : 250},
    soundEnabled: {value: cfg.soundEnabled != null ? cfg.soundEnabled : false},
    themeMode: {value: cfg.themeMode || "light"}
  };
  if (cfg.selectedWorkout) seed.selectedWorkout = {value: cfg.selectedWorkout};
  if (cfg.connectBike !== false) seed.lastBikeDeviceId = {value: sim.bikeDeviceId};
  if (cfg.connectHr) seed.lastHrDeviceId = {value: sim.hrDeviceId};

  var idb = createFakeIndexedDB(seed);

  // showDirectoryPicker (FSA root) — returns the same pre-seeded root.
  function showDirectoryPicker() { return Promise.resolve(root); }

  window.__VELO_TEST_ENV__ = {
    clock: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      dateNow: clock.dateNow,
      performanceNow: clock.performanceNow,
      DateClass: clock.DateClass
    },
    bluetooth: sim.bluetooth,
    audioContext: audio.AudioContextClass,
    indexedDB: idb.indexedDB,
    showDirectoryPicker: showDirectoryPicker
  };

  // Control API for tests (drive a ride / inspect side-effects).
  window.__VELO_HARNESS__ = {
    clock: clock,
    sim: sim,
    audio: audio,
    fs: {root: root, workouts: workoutsDir, history: historyDir, trash: trashDir},
    settingsStore: idb._store,
    // advance N engine ticks (1s each), emitting a bike sample before each tick
    // so power/cadence/hr flow into the engine like a real trainer at ~1Hz.
    async ride(nTicks, perTick) {
      for (var i = 0; i < nTicks; i++) {
        if (typeof perTick === "function") perTick(i);
        sim.emitBikeData();
        sim.emitHr();
        await clock.step(1000);
      }
    },
    // pump pending timers without advancing semantic time meaningfully
    settle: function () { return clock.step(0); }
  };
})();
