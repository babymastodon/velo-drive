// workout-engine.js
// Business logic + state for running a workout.
// No direct DOM access; communicates via callbacks.
/** @typedef {import("./zwo.js").CanonicalWorkout} CanonicalWorkout */

import {BleManager} from "./ble-manager.js";
import {Beeper} from "./beeper.js";
import {DEFAULT_FTP} from "./workout-metrics.js";
import {buildFitFile} from "./fit-file.js";
import {
  loadSelectedWorkout,
  loadActiveState,
  saveActiveState,
  loadWorkoutDirHandle,
} from "./storage.js";

let instance = null;

export function getWorkoutEngine() {
  if (!instance) instance = createWorkoutEngine();
  return instance;
}

function createWorkoutEngine() {
  /** @type {CanonicalWorkout | null} */
  let canonicalWorkout = null;
  let workoutTotalSec = 0;

  let currentFtp = DEFAULT_FTP;
  let mode = "workout";
  let freeRideMode = "erg"; // "erg" | "resistance"
  let manualErgTarget = 200;
  let manualResistance = 30;

  // Prevents an immediate auto-start after finishing a workout.
  let autoStartSuppressed = false;
  let workoutRunning = false;
  let workoutPaused = false;
  let workoutStarting = false;
  /** @type {Date | null} */
  let workoutStartedAt = null;
  /** @type {Array<{type: "start" | "stop" | "stop_all", at: string}>} */
  let pauseEvents = [];
  let pauseStartedAtMs = null;
  let totalPausedMs = 0;
  let lastTickWallMs = null;
  let elapsedSec = 0;
  let currentIntervalIndex = 0;
  let intervalElapsedSec = 0;

  let lastSamplePower = null;
  let lastSampleHr = null;
  let lastSampleCadence = null;

  let zeroPowerSeconds = 0;
  let autoPauseDisabledUntilSec = 0;
  let manualPauseAutoResumeBlockedUntilMs = 0;

  let liveSamples = [];
  let workoutTicker = null;
  let saveStateTimer = null;

  let onStateChanged = () => {};
  let onLog = () => {};
  let onWorkoutEnded = () => {};

  const log = (msg) => onLog(msg);

  function recordPauseEvent(type) {
    if (!workoutStartedAt) return;
    const now = new Date();
    pauseEvents.push({type, at: now.toISOString()});
  }

  // --------- helpers for rawSegments ---------

  function isFreeRideSegment(seg) {
    return Array.isArray(seg) && seg[3] === "freeride";
  }

  function getRawCadence(seg) {
    if (!Array.isArray(seg)) return null;
    if (seg[3] === "freeride") return null;
    if (Number.isFinite(seg[4])) return Number(seg[4]);
    if (typeof seg[3] === "number" && Number.isFinite(seg[3])) {
      return Number(seg[3]);
    }
    return null;
  }

  function recomputeWorkoutTotalSec() {
    if (!canonicalWorkout) {
      workoutTotalSec = 0;
      return;
    }
    workoutTotalSec = canonicalWorkout.rawSegments.reduce(
      (sum, [minutes]) => sum + Math.max(1, Math.round((minutes || 0) * 60)),
      0
    );
  }

  /**
   * Returns current segment + target power at absolute time tSec.
   * Uses canonicalWorkout.rawSegments directly; no persistent scaled structure.
   */
  function getCurrentSegmentAtTime(tSec) {
    if (!canonicalWorkout || !workoutTotalSec) {
      return {segment: null, target: null, index: -1};
    }

    const ftp = currentFtp || DEFAULT_FTP;
    const t = Math.min(Math.max(0, tSec), workoutTotalSec);
    const raws = canonicalWorkout.rawSegments;

    let acc = 0;
    for (let i = 0; i < raws.length; i++) {
      const [minutes, startPct, endPct] = raws[i];
      const dur = Math.max(1, Math.round((minutes || 0) * 60));
      const start = acc;
      const end = acc + dur;
      const isFreeRide = isFreeRideSegment(raws[i]);
      const cadenceRpm = getRawCadence(raws[i]);

      if (t < end) {
        const pStartRel = (startPct || 0) / 100;
        const pEndRel = (endPct != null ? endPct : startPct || 0) / 100;
        const rel = (t - start) / dur;
        const startW = pStartRel * ftp;
        const endW = pEndRel * ftp;
        const target = isFreeRide
          ? freeRideMode === "erg"
            ? manualErgTarget
            : null
          : Math.round(
              startW + (endW - startW) * Math.min(1, Math.max(0, rel))
            );

        const segment = {
          durationSec: dur,
          startTimeSec: start,
          endTimeSec: end,
          pStartRel,
          pEndRel,
          isFreeRide,
          cadenceRpm,
        };

        currentIntervalIndex = i;
        return {segment, target, index: i};
      }

      acc = end;
    }

    return {segment: null, target: null, index: -1};
  }

  function getCurrentTargetPower() {
    if (!canonicalWorkout) return null;
    const t = workoutRunning || elapsedSec > 0 ? elapsedSec : 0;
    const {target} = getCurrentSegmentAtTime(t);
    return target;
  }

  function desiredTrainerState() {
    const t = workoutRunning || elapsedSec > 0 ? elapsedSec : 0;
    const {segment, target} = getCurrentSegmentAtTime(t);
    if (segment?.isFreeRide) {
      return freeRideMode === "erg"
        ? {kind: "erg", value: manualErgTarget}
        : {kind: "resistance", value: manualResistance};
    }
    return target == null ? null : {kind: "erg", value: target};
  }

  async function sendTrainerState(force = false) {
    const st = desiredTrainerState();
    if (!st) return;
    await BleManager.setTrainerState(st, {force});
  }

  // --------- persistence ---------

  function scheduleSaveActiveState() {
    if (saveStateTimer) return;
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      persistActiveState();
    }, 500);
  }

  function persistActiveState() {
    saveActiveState({
      canonicalWorkout,
      currentFtp,
      mode,
      freeRideMode,
      manualErgTarget,
      manualResistance,
      workoutRunning,
      workoutPaused,
      elapsedSec,
      currentIntervalIndex,
      liveSamples,
      zeroPowerSeconds,
      autoPauseDisabledUntilSec,
      manualPauseAutoResumeBlockedUntilMs,
      pauseEvents,
      pauseStartedAtMs,
      totalPausedMs,
      lastTickWallMs,
      workoutStartedAt: workoutStartedAt ? workoutStartedAt.toISOString() : null,
    });
  }

  function persistIdleState() {
    saveActiveState({
      currentFtp,
      mode: "workout",
      freeRideMode,
      manualErgTarget,
      manualResistance,
      workoutRunning: false,
      workoutPaused: false,
      workoutStarting: false,
      elapsedSec: 0,
      currentIntervalIndex: 0,
      liveSamples: [],
    });
  }

  async function saveWorkoutFile() {
    if (!canonicalWorkout || !liveSamples.length) return null;

    const dir = await loadWorkoutDirHandle();
    if (!dir) return null;

    const now = new Date();
    const lastSampleT = liveSamples.length
      ? liveSamples[liveSamples.length - 1].t || 0
      : elapsedSec;
    const startDate =
      workoutStartedAt ||
      new Date(now.getTime() - Math.max(0, lastSampleT) * 1000);
    const endDate = lastTickWallMs
      ? new Date(lastTickWallMs)
      : new Date(startDate.getTime() + Math.max(0, lastSampleT) * 1000);
    const totalElapsedSec = Math.max(
      0,
      Math.round((endDate.getTime() - startDate.getTime()) / 1000)
    );

    const nameSafe =
      canonicalWorkout.workoutTitle
        ?.replace(/[<>:"/\\|?*]+/g, "_")
        .slice(0, 60) || "workout";
    const timestamp = startDate
      .toISOString()
      .replace(/[:]/g, "-")
      .replace(/\.\d+Z$/, "Z");
    const fileName = `${timestamp} - ${nameSafe}.fit`;

    const fitBytes = buildFitFile({
      canonicalWorkout,
      samples: liveSamples,
      ftp: currentFtp,
      startedAt: startDate,
      endedAt: endDate,
      pauseEvents,
      totalElapsedSec,
    });

    const fileHandle = await dir.getFileHandle(fileName, {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write(fitBytes);
    await writable.close();

    log(`Workout saved to ${fileName}`);
    return {fileName, startedAt: startDate, endedAt: endDate};
  }

  // --------- auto-start / beeps ---------

  function maybeAutoStartFromPower(power) {
    if (!power || power <= 0) return;
    if (autoStartSuppressed) return;
    if (workoutRunning || workoutStarting) return;
    if (elapsedSec > 0 || liveSamples.length) return;
    if (!canonicalWorkout) return;

    const [minutes, startPct] = canonicalWorkout.rawSegments[0];
    const ftp = currentFtp || DEFAULT_FTP;
    const pStartRel = (startPct || 50) / 100;
    const startTarget = ftp * pStartRel;
    const threshold = Math.max(75, 0.5 * startTarget);

    if (power >= threshold) {
      log(
        `Auto-start: power ${power.toFixed(
          1
        )}W ≥ threshold ${threshold.toFixed(1)}W`
      );
      startWorkout();
    }
  }

  function handleIntervalBeep(currentT) {
    if (!canonicalWorkout) return;

    const {segment, index} = getCurrentSegmentAtTime(currentT);
    if (!segment || index < 0) return;
    if (segment.isFreeRide) return;

    const ftp = currentFtp || DEFAULT_FTP;
    const raws = canonicalWorkout.rawSegments;
    const nextRaw = raws[index + 1];
    if (!nextRaw) return;
    if (isFreeRideSegment(nextRaw)) return;

    const currEnd = segment.pEndRel * ftp;
    const nextStartPct = nextRaw[1];
    const nextStartRel = (nextStartPct || 0) / 100;
    const nextStart = nextStartRel * ftp;

    const diffFrac = Math.abs(nextStart - currEnd) / currEnd;
    if (diffFrac < 0.1) return;

    const secsToEndInt = Math.round(segment.endTimeSec - currentT);

    if (diffFrac >= 0.3 && nextStartRel >= 1.2 && secsToEndInt === 9) {
      Beeper.playDangerDanger();
    }

    if (secsToEndInt === 3) {
      Beeper.playBeepPattern();
    }
  }

  // --------- ticker ---------

  function startTicker() {
    if (workoutTicker) return;
    lastTickWallMs = Date.now();
    workoutTicker = setInterval(async () => {
      lastTickWallMs = Date.now();
      const shouldAdvance = workoutRunning && !workoutPaused;

      if (!workoutRunning && !workoutPaused) {
        emitStateChanged();
        return;
      }

      if (shouldAdvance) {
        elapsedSec += 1;
        const {segment, target} = getCurrentSegmentAtTime(elapsedSec);
        intervalElapsedSec = segment ? segment.endTimeSec - elapsedSec : 0;

        const currentTarget = target;

        {
          const inGrace = elapsedSec < autoPauseDisabledUntilSec;

          if (!lastSamplePower || lastSamplePower <= 0) {
            if (!inGrace) zeroPowerSeconds++;
            else zeroPowerSeconds = 0;

            if (!workoutPaused && !inGrace && zeroPowerSeconds >= 1) {
              log("Auto-pause: power at 0 for 1s.");
              setPaused(true, {showOverlay: true});
            }
          } else {
            zeroPowerSeconds = 0;
          }
        }

        await sendTrainerState(false);

        liveSamples.push({
          t: elapsedSec,
          power: lastSamplePower,
          hr: lastSampleHr,
          cadence: lastSampleCadence,
          targetPower: currentTarget || null,
        });

        if (workoutRunning && workoutTotalSec > 0 && elapsedSec >= workoutTotalSec) {
          await endWorkout();
          return;
        }

        if (workoutRunning && !workoutPaused) {
          handleIntervalBeep(elapsedSec);
        }

        scheduleSaveActiveState();
      }

      if (workoutRunning && workoutPaused) {
        const now = Date.now();
        const autoResumeBlocked = now < manualPauseAutoResumeBlockedUntilMs;

        const currentTarget = getCurrentTargetPower();
        if (!autoResumeBlocked && currentTarget && lastSamplePower) {
          if (lastSamplePower >= 0.9 * currentTarget) {
            log("Auto-resume: power high vs target (>=90%).");
            autoPauseDisabledUntilSec = elapsedSec + 15;
            Beeper.showResumedOverlay();
            setPaused(false);
          }
        }
      }

      emitStateChanged();
    }, 1000);
  }

  function stopTicker() {
    if (!workoutTicker) return;
    clearInterval(workoutTicker);
    workoutTicker = null;
  }

  // --------- state transitions ---------

  function emitStateChanged() {
    onStateChanged(getViewModel());
  }

  function setRunning(running) {
    workoutRunning = running;
    workoutPaused = !running;
    if (running && !workoutTicker) startTicker();
    emitStateChanged();
  }

  function setPaused(paused, {showOverlay = false} = {}) {
    if (paused === workoutPaused) return;
    const nowMs = Date.now();
    if (paused) {
      if (workoutRunning && pauseStartedAtMs == null) {
        pauseStartedAtMs = nowMs;
        recordPauseEvent("stop");
      }
    } else {
      if (pauseStartedAtMs != null) {
        totalPausedMs += nowMs - pauseStartedAtMs;
        pauseStartedAtMs = null;
      }
      if (workoutRunning) {
        recordPauseEvent("start");
      }
    }
    workoutPaused = paused;
    if (paused && showOverlay) Beeper.showPausedOverlay();
    emitStateChanged();
    scheduleSaveActiveState();
  }

  function startWorkout() {
    if (!canonicalWorkout) {
      alert("No workout selected. Choose a workout first.");
      return;
    }

    // User explicitly started a workout; allow auto-start again later.
    autoStartSuppressed = false;

    if (!workoutRunning && !workoutStarting) {
      workoutStarting = true;
      log("Starting workout (countdown)...");
      emitStateChanged();
      Beeper.runStartCountdown(async () => {
        liveSamples = [];
        elapsedSec = 0;

        const [minutes] = canonicalWorkout.rawSegments[0];
        intervalElapsedSec = Math.max(1, Math.round((minutes || 0) * 60));

        currentIntervalIndex = 0;
        workoutStartedAt = new Date();
        pauseEvents = [];
        pauseStartedAtMs = null;
        totalPausedMs = 0;
        lastTickWallMs = workoutStartedAt.getTime();
        recordPauseEvent("start");
        zeroPowerSeconds = 0;
        autoPauseDisabledUntilSec = 15;
        manualPauseAutoResumeBlockedUntilMs = 0;

        workoutStarting = false;
        setRunning(true);
        setPaused(false);
        emitStateChanged();
        await sendTrainerState(true);
        scheduleSaveActiveState();
      });
      return;
    }

    if (workoutPaused) {
      log("Manual resume requested.");
      autoPauseDisabledUntilSec = elapsedSec + 15;
      manualPauseAutoResumeBlockedUntilMs = 0;
      Beeper.showResumedOverlay();
      setPaused(false);
    } else {
      log("Manual pause requested.");
      manualPauseAutoResumeBlockedUntilMs = Date.now() + 10_000;
      Beeper.showPausedOverlay();
      setPaused(true);
    }
  }

  async function endWorkout() {
    log("Ending workout, stopping ticker, then writing FIT if samples exist.");

    // Block auto-starts until the user intentionally starts another workout.
    autoStartSuppressed = true;

    const endWallMs = Date.now();
    if (pauseStartedAtMs != null) {
      totalPausedMs += endWallMs - pauseStartedAtMs;
      pauseStartedAtMs = null;
    }
    if (workoutRunning) {
      recordPauseEvent("stop_all");
    }
    stopTicker();
    let savedInfo = null;
    if (liveSamples.length) {
      try {
        savedInfo = await saveWorkoutFile();
      } catch (err) {
        log("Failed to save workout file: " + err);
      }
    }
    workoutRunning = false;
    workoutPaused = false;
    workoutStarting = false;
    elapsedSec = 0;
    intervalElapsedSec = 0;
    liveSamples = [];
    pauseEvents = [];
    totalPausedMs = 0;
    pauseStartedAtMs = null;
    zeroPowerSeconds = 0;
    autoPauseDisabledUntilSec = 0;
    manualPauseAutoResumeBlockedUntilMs = 0;
    stopTicker();
    persistIdleState();
    emitStateChanged();
    onWorkoutEnded(savedInfo);
  }

  // --------- BLE sample handlers ---------

  function handleBikeSample(sample) {
    lastSamplePower = sample.power;
    lastSampleCadence = sample.cadence;
    if (sample.hrFromBike != null && lastSampleHr == null) {
      lastSampleHr = sample.hrFromBike;
    }
    maybeAutoStartFromPower(lastSamplePower || 0);
    emitStateChanged();
  }

  function handleHrSample(bpm) {
    lastSampleHr = bpm;
    emitStateChanged();
  }

  // --------- view model ---------

  function getViewModel() {
    const t = workoutRunning || elapsedSec > 0 ? elapsedSec : 0;
    const segInfo = getCurrentSegmentAtTime(t);
    return {
      canonicalWorkout,
      workoutTotalSec,
      currentFtp,
      mode,
      freeRideMode,
      isFreeRideActive: !!segInfo.segment?.isFreeRide,
      manualErgTarget,
      manualResistance,
      workoutRunning,
      workoutPaused,
      workoutStarting,
      workoutStartedAt,
      elapsedSec,
      intervalElapsedSec,
      currentIntervalIndex,
      lastSamplePower,
      lastSampleHr,
      lastSampleCadence,
      liveSamples,
      pauseEvents,
      pauseStartedAtMs,
      totalPausedMs,
      lastTickWallMs,
    };
  }

  // --------- public API ---------

  async function init({onStateChanged: onChange, onLog: onLogCb, onWorkoutEnded: onEnd} = {}) {
    if (onChange) onStateChanged = onChange;
    if (onLogCb) onLog = onLogCb;
    if (onEnd) onWorkoutEnded = onEnd;

    log("Workout engine init…");

    BleManager.on("bikeSample", handleBikeSample);
    BleManager.on("hrSample", handleHrSample);
    BleManager.init({autoReconnect: true});

    const selected = await loadSelectedWorkout();
    if (selected) {
      canonicalWorkout = selected;
      recomputeWorkoutTotalSec();
    }

    const active = await loadActiveState();
    if (active) {
      log("Restoring previous active workout state.");

      canonicalWorkout = active.canonicalWorkout || canonicalWorkout;
      currentFtp = Number.isFinite(active.currentFtp)
        ? active.currentFtp
        : currentFtp;
      if (active.freeRideMode === "erg" || active.freeRideMode === "resistance") {
        freeRideMode = active.freeRideMode;
      } else if (active.mode === "erg" || active.mode === "resistance") {
        freeRideMode = active.mode;
      }
      mode = "workout";
      manualErgTarget = Number.isFinite(active.manualErgTarget)
        ? active.manualErgTarget
        : manualErgTarget;
      manualResistance = Number.isFinite(active.manualResistance)
        ? active.manualResistance
        : manualResistance;
      workoutRunning = !!active.workoutRunning;
      // If we were mid-workout, resume in a paused state for safety.
      // Otherwise, respect the persisted paused flag to avoid blocking
      // workout selection when nothing is actually running.
      workoutPaused = workoutRunning ? true : !!active.workoutPaused;
      elapsedSec = active.elapsedSec || 0;
      currentIntervalIndex = active.currentIntervalIndex || 0;
      liveSamples = active.liveSamples || [];
      zeroPowerSeconds = active.zeroPowerSeconds || 0;
      autoPauseDisabledUntilSec = active.autoPauseDisabledUntilSec || 0;
      manualPauseAutoResumeBlockedUntilMs =
        active.manualPauseAutoResumeBlockedUntilMs || 0;
      pauseEvents = Array.isArray(active.pauseEvents) ? active.pauseEvents : [];
      pauseStartedAtMs =
        typeof active.pauseStartedAtMs === "number"
          ? active.pauseStartedAtMs
          : null;
      totalPausedMs = active.totalPausedMs || 0;
      lastTickWallMs = active.lastTickWallMs || null;
      workoutStartedAt = active.workoutStartedAt
        ? new Date(active.workoutStartedAt)
        : null;

      recomputeWorkoutTotalSec();
    }

    if (workoutRunning) {
      startTicker();
      setPaused(true);
    }

    emitStateChanged();
  }

  return {
    init,
    getViewModel,

    setMode(newMode) {
      if (newMode !== "workout" || workoutStarting) return;
      mode = "workout";
      scheduleSaveActiveState();
      sendTrainerState(true).catch((err) =>
        log("Trainer state send on mode change failed: " + err)
      );
      emitStateChanged();
    },

    setFreeRideMode(newMode) {
      if (newMode !== "erg" && newMode !== "resistance") return;
      if (newMode === freeRideMode || workoutStarting) return;
      freeRideMode = newMode;
      scheduleSaveActiveState();
      sendTrainerState(true).catch((err) =>
        log("Trainer state send on free ride mode change failed: " + err)
      );
      emitStateChanged();
    },

    setFtp(newFtp) {
      currentFtp = newFtp || DEFAULT_FTP;
      scheduleSaveActiveState();
      sendTrainerState(true).catch((err) =>
        log("Trainer state send after FTP change failed: " + err)
      );
      emitStateChanged();
    },

    adjustManualErg(delta) {
      manualErgTarget = Math.max(50, Math.min(1500, manualErgTarget + delta));
      scheduleSaveActiveState();
      sendTrainerState(true).catch(() => {});
      emitStateChanged();
    },

    adjustManualResistance(delta) {
      manualResistance = Math.max(0, Math.min(100, manualResistance + delta));
      scheduleSaveActiveState();
      sendTrainerState(true).catch(() => {});
      emitStateChanged();
    },

    /**
     * Accept a CanonicalWorkout from the picker / builder.
     */
    setWorkoutFromPicker(canonical) {
      if (workoutRunning || workoutPaused || workoutStarting) {
        alert("Please end your current workout first.");
        return;
      }

      if (!canonical || !Array.isArray(canonical.rawSegments)) {
        console.warn("[WorkoutEngine] Invalid CanonicalWorkout payload:", canonical);
        return;
      }

      canonicalWorkout = canonical;

      if (!currentFtp || !Number.isFinite(currentFtp)) {
        currentFtp = DEFAULT_FTP;
      }

      elapsedSec = 0;
      currentIntervalIndex = 0;
      liveSamples = [];
      zeroPowerSeconds = 0;
      autoPauseDisabledUntilSec = 0;
      manualPauseAutoResumeBlockedUntilMs = 0;

      recomputeWorkoutTotalSec();

      persistIdleState();
      emitStateChanged();
    },

    handleBikeSample,
    handleHrSample,

    startWorkout,
    endWorkout,
  };
}
