// engine.ts
//
// The DOM-free ride state machine: tick-counting, ERG control,
// auto-pause/resume, countdown→onDone start, view-model shape. Dependencies are
// INJECTED ({ transport, fileStore, beeper, now, setInterval, clearInterval,
// setTimeout }) so the virtual clock + fakes can drive it under the harness; all
// default to the real platform globals.

import { DEFAULT_FTP } from './metrics.js';
import { buildFitFile, type FitSample } from './fit.js';
import { getRawCadence, isFreeRideSegment, segDurationSec } from './segments.js';
import type { CanonicalWorkout } from './model.js';
import type { TrainerTransport, BikeSample, TrainerState } from '../ports/TrainerTransport.js';
import type { FileStore, ActiveState } from '../ports/FileStore.js';
import type { BeeperLike } from './beeper.js';

export interface LiveSample {
  t: number;
  power: number | null;
  hr: number | null;
  cadence: number | null;
  targetPower: number | null;
}

export interface PauseEvent {
  type: 'start' | 'stop' | 'stop_all';
  at: string;
}

export interface EngineViewModel {
  canonicalWorkout: CanonicalWorkout | null;
  workoutTotalSec: number;
  currentFtp: number;
  mode: string;
  freeRideMode: 'erg' | 'resistance';
  isFreeRideActive: boolean;
  manualErgTarget: number;
  manualResistance: number;
  workoutRunning: boolean;
  workoutPaused: boolean;
  workoutStarting: boolean;
  workoutStartedAt: Date | null;
  elapsedSec: number;
  intervalElapsedSec: number;
  currentIntervalIndex: number;
  lastSamplePower: number | null;
  lastSampleHr: number | null;
  lastSampleCadence: number | null;
  liveSamples: LiveSample[];
  pauseEvents: PauseEvent[];
  pauseStartedAtMs: number | null;
  totalPausedMs: number;
  lastTickWallMs: number | null;
}

export interface EngineDeps {
  transport: TrainerTransport;
  fileStore: FileStore;
  beeper: BeeperLike;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  saveWorkoutFile?: boolean; // default true; the HUD test doesn't require it
}

export interface EngineInitCallbacks {
  onStateChanged?: (vm: EngineViewModel) => void;
  onLog?: (msg: string) => void;
  onWorkoutEnded?: (info: { fileName: string; startedAt: Date; endedAt: Date } | null) => void;
  // User-facing alert sink (themed Dialog) for the two reachable engine
  // warnings ("No workout selected", "Please end your current workout first").
  // Falls back to onLog.
  onAlert?: (msg: string) => void;
}

interface SegmentInfo {
  segment: {
    durationSec: number;
    startTimeSec: number;
    endTimeSec: number;
    pStartRel: number;
    pEndRel: number;
    isFreeRide: boolean;
    cadenceRpm: number | null;
  } | null;
  target: number | null;
  index: number;
}

export class WorkoutEngine {
  private canonicalWorkout: CanonicalWorkout | null = null;
  private workoutTotalSec = 0;

  private currentFtp = DEFAULT_FTP;
  private mode = 'workout';
  private freeRideMode: 'erg' | 'resistance' = 'erg';
  private manualErgTarget = 200;
  private manualResistance = 30;

  private autoStartSuppressed = false;
  private workoutRunning = false;
  private workoutPaused = false;
  private workoutStarting = false;
  private workoutStartedAt: Date | null = null;
  private pauseEvents: PauseEvent[] = [];
  private pauseStartedAtMs: number | null = null;
  private totalPausedMs = 0;
  private lastTickWallMs: number | null = null;
  private elapsedSec = 0;
  private currentIntervalIndex = 0;
  private intervalElapsedSec = 0;

  private lastSamplePower: number | null = null;
  private lastSampleHr: number | null = null;
  private lastSampleCadence: number | null = null;

  private zeroPowerSeconds = 0;
  // Dedup key so the text-event cue fires once per active text event.
  private lastTextEventKey: string | null = null;
  private autoPauseDisabledUntilSec = 0;
  private manualPauseAutoResumeBlockedUntilMs = 0;

  private liveSamples: LiveSample[] = [];
  private workoutTicker: number | null = null;
  private saveStateTimer: number | null = null;
  // Idempotency guard for endWorkout (it awaits the FIT save, so the ticker
  // auto-finalizing can race a user Stop and double-save).
  private ending = false;
  private activeStateSaveFailed = false;

  private onStateChanged: (vm: EngineViewModel) => void = () => {};
  private onLog: (msg: string) => void = () => {};
  private onAlert: ((msg: string) => void) | null = null;
  private onWorkoutEnded: (
    info: { fileName: string; startedAt: Date; endedAt: Date } | null,
  ) => void = () => {};

  /** Surface a user-facing warning via the themed Dialog (or log it). */
  private alertUser(message: string): void {
    if (this.onAlert) this.onAlert(message);
    else this.onLog(message);
  }

  private readonly transport: TrainerTransport;
  private readonly fileStore: FileStore;
  private readonly beeper: BeeperLike;
  private readonly now: () => number;
  private readonly _setInterval: (fn: () => void, ms: number) => number;
  private readonly _clearInterval: (id: number) => void;
  private readonly _setTimeout: (fn: () => void, ms: number) => number;
  private readonly shouldSaveFit: boolean;

  constructor(deps: EngineDeps) {
    this.transport = deps.transport;
    this.fileStore = deps.fileStore;
    this.beeper = deps.beeper;
    this.now = deps.now ?? (() => Date.now());
    this._setInterval =
      deps.setInterval ?? ((fn, ms) => window.setInterval(fn, ms) as unknown as number);
    this._clearInterval = deps.clearInterval ?? ((id) => window.clearInterval(id));
    this._setTimeout =
      deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms) as unknown as number);
    this.shouldSaveFit = deps.saveWorkoutFile !== false;
  }

  private log(msg: string): void {
    this.onLog(msg);
  }

  private recordPauseEvent(type: PauseEvent['type']): void {
    if (!this.workoutStartedAt) return;
    this.pauseEvents.push({ type, at: new Date(this.now()).toISOString() });
  }

  // --------- helpers for rawSegments ---------

  private recomputeWorkoutTotalSec(): void {
    if (!this.canonicalWorkout) {
      this.workoutTotalSec = 0;
      return;
    }
    this.workoutTotalSec = this.canonicalWorkout.rawSegments.reduce(
      (sum, seg) => sum + segDurationSec(seg[0] || 0),
      0,
    );
  }

  private getCurrentSegmentAtTime(tSec: number): SegmentInfo {
    if (!this.canonicalWorkout || !this.workoutTotalSec) {
      return { segment: null, target: null, index: -1 };
    }
    const ftp = this.currentFtp || DEFAULT_FTP;
    const t = Math.min(Math.max(0, tSec), this.workoutTotalSec);
    const raws = this.canonicalWorkout.rawSegments;

    let acc = 0;
    for (let i = 0; i < raws.length; i++) {
      const seg = raws[i]!;
      const minutes = seg[0];
      const startPct = seg[1];
      const endPct = seg[2];
      const dur = segDurationSec(minutes || 0);
      const start = acc;
      const end = acc + dur;
      const isFreeRide = isFreeRideSegment(seg);
      const cadenceRpm = getRawCadence(seg);

      if (t < end) {
        const pStartRel = (startPct || 0) / 100;
        const pEndRel = (endPct != null ? endPct : startPct || 0) / 100;
        const rel = (t - start) / dur;
        const startW = pStartRel * ftp;
        const endW = pEndRel * ftp;
        const target = isFreeRide
          ? this.freeRideMode === 'erg'
            ? this.manualErgTarget
            : null
          : Math.round(startW + (endW - startW) * Math.min(1, Math.max(0, rel)));

        this.currentIntervalIndex = i;
        return {
          segment: {
            durationSec: dur,
            startTimeSec: start,
            endTimeSec: end,
            pStartRel,
            pEndRel,
            isFreeRide,
            cadenceRpm,
          },
          target,
          index: i,
        };
      }
      acc = end;
    }
    return { segment: null, target: null, index: -1 };
  }

  private desiredTrainerState(): TrainerState | null {
    const t = this.workoutRunning || this.elapsedSec > 0 ? this.elapsedSec : 0;
    const { segment, target } = this.getCurrentSegmentAtTime(t);
    if (segment?.isFreeRide) {
      return this.freeRideMode === 'erg'
        ? { kind: 'erg', value: this.manualErgTarget }
        : { kind: 'resistance', value: this.manualResistance };
    }
    return target == null ? null : { kind: 'erg', value: target };
  }

  private async sendTrainerState(force = false): Promise<void> {
    const st = this.desiredTrainerState();
    if (!st) return;
    await this.transport.setTrainerState(st, { force });
  }

  // --------- persistence ---------

  private scheduleSaveActiveState(): void {
    if (this.saveStateTimer) return;
    this.saveStateTimer = this._setTimeout(() => {
      this.saveStateTimer = null;
      void this.persistActiveState();
    }, 500);
  }

  private persistActiveState(): Promise<void> {
    // Surface a silent active-state write failure (structured-clone /
    // quota) instead of losing the in-progress ride invisibly. Logged once per
    // failure streak (cleared on the next successful save) to avoid log spam.
    return this.fileStore.saveActiveState(this.buildActiveSnapshot()).then(
      () => {
        this.activeStateSaveFailed = false;
      },
      (err) => {
        if (this.activeStateSaveFailed) return;
        this.activeStateSaveFailed = true;
        this.log('Failed to persist active workout state (will retry next tick): ' + err);
      },
    );
  }

  private buildActiveSnapshot(): ActiveState {
    return {
      canonicalWorkout: this.canonicalWorkout,
      currentFtp: this.currentFtp,
      mode: this.mode,
      freeRideMode: this.freeRideMode,
      manualErgTarget: this.manualErgTarget,
      manualResistance: this.manualResistance,
      workoutRunning: this.workoutRunning,
      workoutPaused: this.workoutPaused,
      elapsedSec: this.elapsedSec,
      currentIntervalIndex: this.currentIntervalIndex,
      liveSamples: this.liveSamples,
      zeroPowerSeconds: this.zeroPowerSeconds,
      autoPauseDisabledUntilSec: this.autoPauseDisabledUntilSec,
      manualPauseAutoResumeBlockedUntilMs: this.manualPauseAutoResumeBlockedUntilMs,
      pauseEvents: this.pauseEvents,
      pauseStartedAtMs: this.pauseStartedAtMs,
      totalPausedMs: this.totalPausedMs,
      lastTickWallMs: this.lastTickWallMs,
      workoutStartedAt: this.workoutStartedAt ? this.workoutStartedAt.toISOString() : null,
    };
  }

  private persistIdleState(): Promise<void> {
    return this.fileStore.saveActiveState({
      currentFtp: this.currentFtp,
      mode: 'workout',
      freeRideMode: this.freeRideMode,
      manualErgTarget: this.manualErgTarget,
      manualResistance: this.manualResistance,
      workoutRunning: false,
      workoutPaused: false,
      workoutStarting: false,
      elapsedSec: 0,
      currentIntervalIndex: 0,
      liveSamples: [],
    });
  }

  private async saveWorkoutFile(): Promise<{
    fileName: string;
    startedAt: Date;
    endedAt: Date;
  } | null> {
    if (!this.shouldSaveFit) return null;
    if (!this.canonicalWorkout || !this.liveSamples.length) return null;

    const dir = await this.fileStore.loadWorkoutDirHandle();
    if (!dir) return null;

    const now = new Date(this.now());
    const lastSampleT = this.liveSamples.length
      ? this.liveSamples[this.liveSamples.length - 1]!.t || 0
      : this.elapsedSec;
    const startDate =
      this.workoutStartedAt || new Date(now.getTime() - Math.max(0, lastSampleT) * 1000);
    const endDate = this.lastTickWallMs
      ? new Date(this.lastTickWallMs)
      : new Date(startDate.getTime() + Math.max(0, lastSampleT) * 1000);
    const totalElapsedSec = Math.max(
      0,
      Math.round((endDate.getTime() - startDate.getTime()) / 1000),
    );

    const nameSafe =
      this.canonicalWorkout.workoutTitle?.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 60) || 'workout';
    const timestamp = startDate
      .toISOString()
      .replace(/[:]/g, '-')
      .replace(/\.\d+Z$/, 'Z');
    const fileName = `${timestamp} - ${nameSafe}.fit`;

    const fitBytes = buildFitFile({
      canonicalWorkout: this.canonicalWorkout,
      samples: this.liveSamples as FitSample[],
      ftp: this.currentFtp,
      startedAt: startDate,
      endedAt: endDate,
      pauseEvents: this.pauseEvents,
      totalElapsedSec,
    });

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(fitBytes);
    await writable.close();

    this.log(`Workout saved to ${fileName}`);
    return { fileName, startedAt: startDate, endedAt: endDate };
  }

  // --------- auto-start / beeps ---------

  private maybeAutoStartFromPower(power: number): void {
    if (!power || power <= 0) return;
    if (this.autoStartSuppressed) return;
    if (this.workoutRunning || this.workoutStarting) return;
    if (this.elapsedSec > 0 || this.liveSamples.length) return;
    if (!this.canonicalWorkout) return;

    const first = this.canonicalWorkout.rawSegments[0];
    if (!first) return; // guard empty rawSegments
    const startPct = first[1];
    const ftp = this.currentFtp || DEFAULT_FTP;
    const pStartRel = (startPct || 50) / 100;
    const startTarget = ftp * pStartRel;
    const threshold = Math.max(75, 0.5 * startTarget);

    if (power >= threshold) {
      this.log(`Auto-start: power ${power.toFixed(1)}W ≥ threshold ${threshold.toFixed(1)}W`);
      this.startWorkout();
    }
  }

  private handleIntervalBeep(currentT: number): void {
    if (!this.canonicalWorkout) return;
    const { segment, index } = this.getCurrentSegmentAtTime(currentT);
    if (!segment || index < 0) return;
    if (segment.isFreeRide) return;

    const ftp = this.currentFtp || DEFAULT_FTP;
    const raws = this.canonicalWorkout.rawSegments;
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
      this.beeper.playDangerDanger();
    }
    if (secsToEndInt === 3) {
      this.beeper.playBeepPattern();
    }
  }

  // --------- ticker ---------

  private startTicker(): void {
    if (this.workoutTicker) return;
    this.lastTickWallMs = this.now();
    this.workoutTicker = this._setInterval(() => {
      void this.tick();
    }, 1000);
  }

  private async tick(): Promise<void> {
    // NOTE: tick() awaits a real BLE write, so a >1s stall can let the
    // 1s interval fire an overlapping tick. The serious symptom of that — a
    // double FIT save / double onWorkoutEnded if two ticks both auto-finalize —
    // is handled by endWorkout()'s `ending` idempotency guard. We deliberately
    // do NOT add a skip-guard here: the engine counts ride time in ticks,
    // and the virtual-clock harness fires interval callbacks synchronously, so
    // a skip-guard would drop legitimate ticks and desync elapsedSec. The only
    // residual is a possible duplicate sample during a genuine multi-second BLE
    // stall — cosmetic in the FIT.
    this.lastTickWallMs = this.now();
    // TODO (known limitation — do not "fix" casually): ride time is COUNTED IN
    // TICKS (elapsedSec += 1 per fired interval), not derived from wall-clock.
    // Browsers throttle background-tab setInterval (fires far slower than 1 Hz),
    // so a backgrounded ride under-counts elapsed time and delays the 0-power
    // auto-pause. lastTickWallMs is captured here but NOT used to catch elapsed
    // up. Fixing it (wall-clock reconciliation or a Web Worker ticker) changes
    // the engine's core time source and the virtual-clock test harness, and
    // naive catch-up causes timer jumps + skipped interval cues — so left as-is
    // intentionally. Screen Wake Lock would address the common screen-sleep case
    // but not tab-switch throttling.
    const shouldAdvance = this.workoutRunning && !this.workoutPaused;

    if (!this.workoutRunning && !this.workoutPaused) {
      this.emitStateChanged();
      return;
    }

    if (shouldAdvance) {
      this.elapsedSec += 1;
      const { segment, target } = this.getCurrentSegmentAtTime(this.elapsedSec);
      this.intervalElapsedSec = segment ? segment.endTimeSec - this.elapsedSec : 0;
      const currentTarget = target;

      {
        const inGrace = this.elapsedSec < this.autoPauseDisabledUntilSec;
        if (!this.lastSamplePower || this.lastSamplePower <= 0) {
          if (!inGrace) this.zeroPowerSeconds++;
          else this.zeroPowerSeconds = 0;
          if (!this.workoutPaused && !inGrace && this.zeroPowerSeconds >= 1) {
            this.log('Auto-pause: power at 0 for 1s.');
            this.setPaused(true, { showOverlay: true });
          }
        } else {
          this.zeroPowerSeconds = 0;
        }
      }

      await this.sendTrainerState(false);

      this.liveSamples.push({
        t: this.elapsedSec,
        power: this.lastSamplePower,
        hr: this.lastSampleHr,
        cadence: this.lastSampleCadence,
        targetPower: currentTarget || null,
      });

      if (this.workoutRunning && this.workoutTotalSec > 0 && this.elapsedSec >= this.workoutTotalSec) {
        await this.endWorkout();
        return;
      }

      if (this.workoutRunning && !this.workoutPaused) {
        this.handleIntervalBeep(this.elapsedSec);
      }

      this.scheduleSaveActiveState();
    }

    if (this.workoutRunning && this.workoutPaused) {
      const now = this.now();
      const autoResumeBlocked = now < this.manualPauseAutoResumeBlockedUntilMs;
      const { segment, target: currentTarget } = this.getCurrentSegmentAtTime(this.elapsedSec);
      const tgt = currentTarget ?? 0;
      const hasPower = !!this.lastSamplePower && this.lastSamplePower > 0;
      // Normal structured segments auto-resume at >=90% of target. But that
      // threshold is unreachable from a dead stop for (a) ANY free-ride —
      // resistance (no numeric target) OR a high manual-ERG free-ride — and
      // (b) a segment whose target rounds to <=0W. Those would trap the rider
      // on the pause overlay, so resume on any positive power instead.
      const shouldAutoResume =
        segment?.isFreeRide || tgt <= 0
          ? hasPower
          : hasPower && this.lastSamplePower! >= 0.9 * tgt;
      if (!autoResumeBlocked && shouldAutoResume) {
        this.log('Auto-resume: power high vs target (>=90%).');
        this.autoPauseDisabledUntilSec = this.elapsedSec + 15;
        // Clear the manual-pause auto-resume block for symmetry with the
        // manual resume path, so snapshots don't carry a stale block timestamp.
        this.manualPauseAutoResumeBlockedUntilMs = 0;
        this.beeper.showResumedOverlay();
        await this.resumeFromPause();
      }
    }

    this.emitStateChanged();
  }

  private stopTicker(): void {
    if (!this.workoutTicker) return;
    this._clearInterval(this.workoutTicker);
    this.workoutTicker = null;
  }

  // --------- state transitions ---------

  private emitStateChanged(): void {
    this.maybePlayTextEvent();
    // Keep the trainer's target synced with the current selection even before
    // the workout starts: selecting a workout — or connecting the bike while one
    // is already selected (the first bikeSample lands here) — pushes its starting
    // power to the device. This is the single sync point, not per-event triggers.
    // During a ride the tick loop drives sends instead (so we don't double-drive
    // or fight the paused/grace logic); the transport dedupes idle re-emits, and
    // desiredTrainerState() is null with no workout selected (so nothing is sent).
    if (!this.workoutRunning) void this.sendTrainerState(false);
    this.onStateChanged(this.getViewModel());
  }

  /**
   * Fire the text-event audio cue once when a text event becomes active during a
   * running (non-paused) ride. Deduped by idx/offset/text so a given event taps
   * once for its whole window.
   */
  private maybePlayTextEvent(): void {
    const cw = this.canonicalWorkout;
    const events = cw?.textEvents;
    if (!this.workoutRunning || this.workoutPaused || !events || !events.length) {
      this.lastTextEventKey = null;
      return;
    }
    const t = Math.max(0, this.elapsedSec || 0);
    let activeIdx = -1;
    let activeOffset = 0;
    let activeText = '';
    for (let idx = 0; idx < events.length; idx += 1) {
      const evt = events[idx];
      const offsetSec = Math.max(0, Number(evt?.offsetSec) || 0);
      const durationSec = Math.max(1, Math.round(Number(evt?.durationSec) || 10));
      if (t >= offsetSec && t <= offsetSec + durationSec) {
        activeIdx = idx;
        activeOffset = offsetSec;
        activeText = evt?.text || '';
      }
    }
    if (activeIdx < 0 || !activeText) {
      this.lastTextEventKey = null;
      return;
    }
    const key = `${activeIdx}:${activeOffset}:${activeText}`;
    if (key === this.lastTextEventKey) return;
    this.lastTextEventKey = key;
    this.beeper.playTextEventTaps(0.5);
  }

  private setRunning(running: boolean): void {
    this.workoutRunning = running;
    this.workoutPaused = !running;
    if (running && !this.workoutTicker) this.startTicker();
    this.emitStateChanged();
  }

  private setPaused(paused: boolean, opts?: { showOverlay?: boolean }): void {
    const showOverlay = opts?.showOverlay ?? false;
    if (paused === this.workoutPaused) return;
    const nowMs = this.now();
    if (paused) {
      if (this.workoutRunning && this.pauseStartedAtMs == null) {
        this.pauseStartedAtMs = nowMs;
        this.recordPauseEvent('stop');
      }
    } else {
      if (this.pauseStartedAtMs != null) {
        this.totalPausedMs += nowMs - this.pauseStartedAtMs;
        this.pauseStartedAtMs = null;
      }
      if (this.workoutRunning) this.recordPauseEvent('start');
    }
    this.workoutPaused = paused;
    if (paused && showOverlay) this.beeper.showPausedOverlay();
    this.emitStateChanged();
    this.scheduleSaveActiveState();
  }

  /**
   * Resume from a paused ride (paused→running) and immediately force-re-send the
   * held target to the trainer. Without the force-send, re-application is
   * left to the throttled next tick (sendTrainerState(false)) and can be a no-op
   * if the target is unchanged and <10s have elapsed on the transport clock.
   * No-op if we are not actually paused, so the force-send only fires on a real
   * resume transition.
   */
  private async resumeFromPause(): Promise<void> {
    if (!this.workoutPaused) return;
    this.setPaused(false);
    await this.sendTrainerState(true);
  }

  startWorkout(): void {
    if (!this.canonicalWorkout) {
      this.alertUser('No workout selected. Choose a workout first.');
      return;
    }

    // During the 3-2-1 countdown workoutStarting is true; ignore Start/Space
    // so we don't fall through to the pause/resume else-branch and flip a stray
    // workoutPaused (which beginRun would otherwise self-heal).
    if (this.workoutStarting) return;

    this.autoStartSuppressed = false;

    if (!this.workoutRunning && !this.workoutStarting) {
      this.workoutStarting = true;
      this.log('Starting workout (countdown)...');
      this.emitStateChanged();
      this.beeper.runStartCountdown(() => {
        void this.beginRun();
      });
      return;
    }

    if (this.workoutPaused) {
      this.log('Manual resume requested.');
      this.autoPauseDisabledUntilSec = this.elapsedSec + 15;
      this.manualPauseAutoResumeBlockedUntilMs = 0;
      this.beeper.showResumedOverlay();
      // Force-re-send the held target on resume (fire-and-forget; startWorkout
      // is sync). resumeFromPause no-ops if we're not actually paused.
      void this.resumeFromPause();
    } else {
      this.log('Manual pause requested.');
      this.manualPauseAutoResumeBlockedUntilMs = this.now() + 10_000;
      this.beeper.showPausedOverlay();
      this.setPaused(true);
    }
  }

  private async beginRun(): Promise<void> {
    // The start-countdown's onDone lands here ~3s after startWorkout.
    // If the ride was ended/cancelled during the countdown, workoutStarting was
    // cleared — bail so we never resurrect a ghost ride.
    if (!this.workoutStarting) return;
    this.liveSamples = [];
    this.elapsedSec = 0;
    const first = this.canonicalWorkout!.rawSegments[0];
    if (!first) return; // guard empty rawSegments
    const minutes = first[0];
    this.intervalElapsedSec = segDurationSec(minutes || 0);
    this.currentIntervalIndex = 0;
    this.workoutStartedAt = new Date(this.now());
    this.pauseEvents = [];
    this.pauseStartedAtMs = null;
    this.totalPausedMs = 0;
    this.lastTickWallMs = this.workoutStartedAt.getTime();
    this.recordPauseEvent('start');
    this.zeroPowerSeconds = 0;
    this.autoPauseDisabledUntilSec = 15;
    this.manualPauseAutoResumeBlockedUntilMs = 0;
    this.workoutStarting = false;
    this.setRunning(true);
    this.setPaused(false);
    this.emitStateChanged();
    await this.sendTrainerState(true);
    this.scheduleSaveActiveState();
  }

  async endWorkout(): Promise<void> {
    // Idempotent: endWorkout awaits the FIT save, so it can be
    // entered twice — e.g. the ticker auto-finalizing at the same instant the
    // user confirms Stop — which would double-save the FIT and fire
    // onWorkoutEnded twice. The second entrant is a no-op.
    if (this.ending) return;
    this.ending = true;
    try {
      await this.endWorkoutInner();
    } finally {
      this.ending = false;
    }
  }

  private async endWorkoutInner(): Promise<void> {
    this.log('Ending workout, stopping ticker, then writing FIT if samples exist.');
    this.autoStartSuppressed = true;

    const endWallMs = this.now();
    if (this.pauseStartedAtMs != null) {
      this.totalPausedMs += endWallMs - this.pauseStartedAtMs;
      this.pauseStartedAtMs = null;
    }
    if (this.workoutRunning) this.recordPauseEvent('stop_all');
    this.stopTicker();

    let savedInfo: { fileName: string; startedAt: Date; endedAt: Date } | null = null;
    if (this.liveSamples.length) {
      try {
        savedInfo = await this.saveWorkoutFile();
      } catch (err) {
        this.log('Failed to save workout file: ' + err);
      }
    }

    this.workoutRunning = false;
    this.workoutPaused = false;
    this.workoutStarting = false;
    this.elapsedSec = 0;
    this.intervalElapsedSec = 0;
    this.liveSamples = [];
    this.pauseEvents = [];
    this.totalPausedMs = 0;
    this.pauseStartedAtMs = null;
    this.zeroPowerSeconds = 0;
    this.autoPauseDisabledUntilSec = 0;
    this.manualPauseAutoResumeBlockedUntilMs = 0;
    this.stopTicker();
    void this.persistIdleState();
    this.emitStateChanged();
    this.onWorkoutEnded(savedInfo);
  }

  // --------- BLE sample handlers ---------

  handleBikeSample = (sample: BikeSample): void => {
    this.lastSamplePower = sample.power;
    this.lastSampleCadence = sample.cadence;
    if (sample.hrFromBike != null && this.lastSampleHr == null) {
      this.lastSampleHr = sample.hrFromBike;
    }
    this.maybeAutoStartFromPower(this.lastSamplePower || 0);
    this.emitStateChanged();
  };

  handleHrSample = (bpm: number | null): void => {
    this.lastSampleHr = bpm;
    this.emitStateChanged();
  };

  // --------- view model ---------

  getViewModel(): EngineViewModel {
    const t = this.workoutRunning || this.elapsedSec > 0 ? this.elapsedSec : 0;
    const segInfo = this.getCurrentSegmentAtTime(t);
    return {
      canonicalWorkout: this.canonicalWorkout,
      workoutTotalSec: this.workoutTotalSec,
      currentFtp: this.currentFtp,
      mode: this.mode,
      freeRideMode: this.freeRideMode,
      isFreeRideActive: !!segInfo.segment?.isFreeRide,
      manualErgTarget: this.manualErgTarget,
      manualResistance: this.manualResistance,
      workoutRunning: this.workoutRunning,
      workoutPaused: this.workoutPaused,
      workoutStarting: this.workoutStarting,
      workoutStartedAt: this.workoutStartedAt,
      elapsedSec: this.elapsedSec,
      intervalElapsedSec: this.intervalElapsedSec,
      currentIntervalIndex: this.currentIntervalIndex,
      lastSamplePower: this.lastSamplePower,
      lastSampleHr: this.lastSampleHr,
      lastSampleCadence: this.lastSampleCadence,
      liveSamples: this.liveSamples,
      pauseEvents: this.pauseEvents,
      pauseStartedAtMs: this.pauseStartedAtMs,
      totalPausedMs: this.totalPausedMs,
      lastTickWallMs: this.lastTickWallMs,
    };
  }

  // --------- public API ---------

  async init(callbacks: EngineInitCallbacks = {}): Promise<void> {
    if (callbacks.onStateChanged) this.onStateChanged = callbacks.onStateChanged;
    if (callbacks.onLog) this.onLog = callbacks.onLog;
    if (callbacks.onAlert) this.onAlert = callbacks.onAlert;
    if (callbacks.onWorkoutEnded) this.onWorkoutEnded = callbacks.onWorkoutEnded;

    this.log('Workout engine init…');

    this.transport.on('bikeSample', this.handleBikeSample);
    this.transport.on('hrSample', this.handleHrSample);
    this.transport.init({ autoReconnect: true });

    const selected = await this.fileStore.loadSelectedWorkout();
    if (selected) {
      this.canonicalWorkout = selected;
      this.recomputeWorkoutTotalSec();
    }

    const active = await this.fileStore.loadActiveState();
    if (active) {
      this.log('Restoring previous active workout state.');
      this.restoreActiveState(active);
      this.recomputeWorkoutTotalSec();
    }

    if (this.workoutRunning) {
      // A ride that crashed at/after completion would otherwise be restored
      // as paused — and the end check (elapsedSec >= workoutTotalSec) lives inside
      // the running-&-not-paused tick block, so it sits stuck forever. Finalize
      // immediately instead of arming a paused ticker.
      if (this.workoutTotalSec > 0 && this.elapsedSec >= this.workoutTotalSec) {
        await this.endWorkout();
      } else {
        this.startTicker();
        this.setPaused(true);
      }
    }

    this.emitStateChanged();
  }

  private restoreActiveState(active: ActiveState): void {
    const a = active as Record<string, unknown>;
    this.canonicalWorkout = (a.canonicalWorkout as CanonicalWorkout) || this.canonicalWorkout;
    if (Number.isFinite(a.currentFtp as number)) this.currentFtp = a.currentFtp as number;
    if (a.freeRideMode === 'erg' || a.freeRideMode === 'resistance') {
      this.freeRideMode = a.freeRideMode;
    } else if (a.mode === 'erg' || a.mode === 'resistance') {
      this.freeRideMode = a.mode;
    }
    this.mode = 'workout';
    if (Number.isFinite(a.manualErgTarget as number)) this.manualErgTarget = a.manualErgTarget as number;
    if (Number.isFinite(a.manualResistance as number)) {
      this.manualResistance = a.manualResistance as number;
    }
    this.workoutRunning = !!a.workoutRunning;
    this.workoutPaused = this.workoutRunning ? true : !!a.workoutPaused;
    this.elapsedSec = (a.elapsedSec as number) || 0;
    this.currentIntervalIndex = (a.currentIntervalIndex as number) || 0;
    this.liveSamples = (a.liveSamples as LiveSample[]) || [];
    this.zeroPowerSeconds = (a.zeroPowerSeconds as number) || 0;
    this.autoPauseDisabledUntilSec = (a.autoPauseDisabledUntilSec as number) || 0;
    // Do NOT carry the prior session's wall-clock pause-start / block ms. The
    // app-closed gap is not "paused riding"; restoring pauseStartedAtMs as an
    // absolute prior-session ms would flow the whole closed-app interval into
    // totalPausedMs → FIT totalElapsedSec on the next resume/end. We keep the
    // restored workoutPaused (above) but start a fresh pause window.
    this.manualPauseAutoResumeBlockedUntilMs = 0;
    this.pauseEvents = Array.isArray(a.pauseEvents) ? (a.pauseEvents as PauseEvent[]) : [];
    this.pauseStartedAtMs = null;
    this.totalPausedMs = (a.totalPausedMs as number) || 0;
    this.lastTickWallMs = (a.lastTickWallMs as number) || null;
    this.workoutStartedAt = a.workoutStartedAt ? new Date(a.workoutStartedAt as string) : null;
  }

  setMode(newMode: string): void {
    if (newMode !== 'workout' || this.workoutStarting) return;
    this.mode = 'workout';
    this.scheduleSaveActiveState();
    this.sendTrainerState(true).catch((err) => this.log('Trainer state send on mode change failed: ' + err));
    this.emitStateChanged();
  }

  setFreeRideMode(newMode: string): void {
    if (newMode !== 'erg' && newMode !== 'resistance') return;
    if (newMode === this.freeRideMode || this.workoutStarting) return;
    this.freeRideMode = newMode;
    this.scheduleSaveActiveState();
    // Don't force a fresh setpoint to the wheel while paused; the resume
    // re-send re-asserts the target. State still updates + persists.
    if (!this.workoutPaused) {
      this.sendTrainerState(true).catch((err) =>
        this.log('Trainer state send on free ride mode change failed: ' + err),
      );
    }
    this.emitStateChanged();
  }

  setFtp(newFtp: number): void {
    this.currentFtp = newFtp || DEFAULT_FTP;
    this.scheduleSaveActiveState();
    // Skip the forced send while paused (state still updates + persists).
    if (!this.workoutPaused) {
      this.sendTrainerState(true).catch((err) => this.log('Trainer state send after FTP change failed: ' + err));
    }
    this.emitStateChanged();
  }

  adjustManualErg(delta: number): void {
    this.manualErgTarget = Math.max(50, Math.min(1500, this.manualErgTarget + delta));
    this.scheduleSaveActiveState();
    // Skip the forced send while paused (state still updates + persists).
    if (!this.workoutPaused) {
      this.sendTrainerState(true).catch(() => {});
    }
    this.emitStateChanged();
  }

  adjustManualResistance(delta: number): void {
    this.manualResistance = Math.max(0, Math.min(100, this.manualResistance + delta));
    this.scheduleSaveActiveState();
    // Skip the forced send while paused (state still updates + persists).
    if (!this.workoutPaused) {
      this.sendTrainerState(true).catch(() => {});
    }
    this.emitStateChanged();
  }

  setWorkoutFromPicker(canonical: CanonicalWorkout): void {
    if (this.workoutRunning || this.workoutPaused || this.workoutStarting) {
      this.alertUser('Please end your current workout first.');
      return;
    }
    if (!canonical || !Array.isArray(canonical.rawSegments)) {
      console.warn('[WorkoutEngine] Invalid CanonicalWorkout payload:', canonical);
      return;
    }
    // Reject zero-length workouts — beginRun/maybeAutoStartFromPower read
    // rawSegments[0] and an empty array (reachable via the planner scheduled-load
    // `entry.rawSegments || []`) would TypeError on every sample + on Start.
    if (!canonical.rawSegments.length) {
      this.alertUser('This workout has no segments.');
      return;
    }
    this.canonicalWorkout = canonical;
    if (!this.currentFtp || !Number.isFinite(this.currentFtp)) this.currentFtp = DEFAULT_FTP;
    this.elapsedSec = 0;
    this.currentIntervalIndex = 0;
    this.liveSamples = [];
    this.zeroPowerSeconds = 0;
    this.autoPauseDisabledUntilSec = 0;
    this.manualPauseAutoResumeBlockedUntilMs = 0;
    // A freshly selected workout is an intentional workout action, so lift
    // the auto-start suppression set by a prior endWorkout — otherwise pedaling
    // never auto-starts the new ride until a manual Start.
    this.autoStartSuppressed = false;
    this.recomputeWorkoutTotalSec();
    void this.persistIdleState();
    this.emitStateChanged();
  }

  setFtpInitial(ftp: number): void {
    // Set FTP at boot without forcing a trainer send (used by composition root).
    if (Number.isFinite(ftp) && ftp > 0) this.currentFtp = ftp;
  }
}
