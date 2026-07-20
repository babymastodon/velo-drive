// beeper.ts
//
// The HUD needs the start countdown (3-2-1-Start) whose onDone callback starts
// the ride, plus the basic audio cue primitive (so the fake AudioContext
// records oscillator-start events for the harness). Reads `window.setTimeout` /
// `window.AudioContext` so the platform shim (virtual clock + fake audio) can
// drive it.
//
// Overlay DOM (#statusOverlay/#statusText) is optional: when present the
// countdown shows the big "3/2/1/Start" labels; when absent the countdown still
// runs on the (virtual) clock and fires onDone.

type AudioContextCtor = new (opts?: { latencyHint?: 'interactive' | 'balanced' | 'playback' | number }) => AudioContext;

export interface BeeperLike {
  setEnabled(flag: boolean): void;
  keepAwake(): void;
  releaseKeepAwake(): void;
  stopAll(): void;
  runStartCountdown(onDone: () => void): void;
  showPausedOverlay(): void;
  showResumedOverlay(): void;
  playBeepPattern(): void;
  playDangerDanger(): void;
  playTextEventTaps(gain?: number): void;
}

export class Beeper implements BeeperLike {
  private enabled = false;
  private volume = 1; // 0..1, scales beep gain (0 = silent)
  private audioCtx: AudioContext | null = null;
  private timeouts: number[] = [];
  private countdownRunning = false;
  // Inaudible node that holds the AudioContext (and its GStreamer/PulseAudio
  // output pipeline) in the `running` state for the duration of a ride. On
  // WebKitGTK (the Tauri webview) an idle context spins its pipeline down, and
  // resuming it on-demand at cue time costs SECONDS — so mid-ride beeps land late.
  // Keeping this silent source alive prevents the spin-down. See keepAwake().
  private keepAliveNode: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  // Audible oscillators are retained until they end so stopAll() can disconnect
  // them before closing the context. This is the synchronous backstop if a
  // platform delays AudioContext.close().
  private activeOscillators = new Set<OscillatorNode>();

  constructor() {
    this.installAudioPrimer();
  }

  /**
   * Warm/resume the AudioContext on the first user gesture and whenever the tab
   * returns to the foreground. Browsers start an AudioContext SUSPENDED until a
   * gesture resumes it, so without this
   * the first countdown/cue beep (often fired from a tick, not a click) is
   * silently dropped. Best-effort + harness-safe (no AudioContext → no-op).
   */
  private installAudioPrimer(): void {
    if (typeof window === 'undefined') return;
    const prime = (): void => this.warmUp();
    try {
      window.addEventListener('pointerdown', prime, { passive: true });
      window.addEventListener('keydown', prime);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.warmUp();
        });
      }
    } catch {
      /* ignore */
    }
  }

  /** Create (if needed) and resume the AudioContext. Safe to call repeatedly. */
  warmUp(): void {
    this.ensureAudioContext();
  }

  /**
   * Keep the AudioContext's output pipeline alive so mid-ride cues fire instantly
   * instead of paying WebKitGTK's multi-second pipeline-resume latency. Call when
   * a ride starts. Attaches a permanently-silent oscillator (gain 0) to the
   * destination — inaudible, but enough to stop the engine from idling the
   * pipeline. Idempotent and harness-safe (no AudioContext → no-op). Survives
   * mute: this is about latency, not loudness, so it ignores `enabled`/`volume`.
   */
  keepAwake(): void {
    const ctx = this.ensureAudioContext();
    if (!ctx || this.keepAliveNode) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0; // fully silent
      osc.frequency.value = 20; // sub-audible; gain 0 makes it inaudible anyway
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      this.keepAliveNode = osc;
      this.keepAliveGain = g;
    } catch {
      /* ignore — best effort */
    }
  }

  /** Tear down the keep-alive node (call when the ride ends), letting the context
   *  idle normally. Safe to call when nothing is running. */
  releaseKeepAwake(): void {
    try {
      this.keepAliveNode?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.keepAliveNode?.disconnect();
      this.keepAliveGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.keepAliveNode = null;
    this.keepAliveGain = null;
  }

  private get statusOverlay(): HTMLElement | null {
    return document.getElementById('statusOverlay');
  }
  private get statusText(): HTMLElement | null {
    return document.getElementById('statusText');
  }

  setEnabled(flag: boolean): void {
    this.enabled = !!flag;
    // AUDIO-E1 / AUDIO-R4: muting must NOT tear down an in-flight start
    // countdown. playBeep() already early-returns when disabled, so future beeps
    // go silent on their own. Calling stopAll() here would clearTimeouts() the
    // countdown's chained steps so its onDone never fires — soft-locking the
    // engine in workoutStarting (Start dead until reload). Muting only silences
    // sound; it must never abort the ride start.
  }

  private addTimeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    this.timeouts.push(id as unknown as number);
  }

  private clearTimeouts(): void {
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      const Ctor = (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext;
      if (!Ctor) return null;
      try {
        // `interactive` requests the lowest-latency output buffer (WebKitGTK
        // otherwise picks a higher-latency default). Fall back to the no-arg
        // ctor if the options form isn't accepted.
        try {
          this.audioCtx = new Ctor({ latencyHint: 'interactive' });
        } catch {
          this.audioCtx = new Ctor();
        }
      } catch {
        this.audioCtx = null;
      }
    }
    const ctx = this.audioCtx;
    // Browsers create the context SUSPENDED under the autoplay policy (and
    // re-suspend it when the tab is hidden). Resume so a beep fired from a tick
    // (not a click) — or after backgrounding — isn't silently dropped (AUDIO-R1/E2).
    if (ctx && ctx.state === 'suspended') {
      try {
        void (ctx as { resume?: () => Promise<void> }).resume?.();
      } catch {
        /* ignore */
      }
    }
    return ctx;
  }

  /**
   * Return a context only when its media clock is advancing. ensureAudioContext()
   * requests resume(), but resume is asynchronous; scheduling against the context
   * before it reaches `running` queues the cue on a frozen currentTime and lets
   * WebKitGTK replay it when the context wakes, potentially hours after the ride.
   */
  private runningAudioContext(): AudioContext | null {
    const ctx = this.ensureAudioContext();
    return ctx?.state === 'running' ? ctx : null;
  }

  private trackOscillator(osc: OscillatorNode): void {
    this.activeOscillators.add(osc);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
      try {
        osc.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  private stopOscillators(): void {
    for (const osc of this.activeOscillators) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        osc.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.activeOscillators.clear();
  }

  private closeAudioContext(): void {
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (!ctx) return;
    try {
      void ctx.close().catch(() => {});
    } catch {
      /* already closed */
    }
  }

  setVolume(v: number): void {
    // Gain multiplier where 1.0 is the reference loudness (the settings slider's
    // 70% mark). Allow a modest boost above 1.0; playBeep caps the final gain at
    // 1.0 so the boost never clips.
    this.volume = Math.max(0, Math.min(1.5, Number.isFinite(v) ? v : 1));
  }

  private playBeep(durationMs: number, freq: number, gain: number): void {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.runningAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const durSec = durationMs / 1000;
      const attack = 0.005;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(Math.min(1, gain * this.volume), now + attack);
      g.gain.linearRampToValueAtTime(0.0001, now + durSec);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durSec + 0.05);
      this.trackOscillator(osc);
    } catch {
      /* ignore audio errors */
    }
  }

  playBeepPattern(): void {
    // 3-2-1 countdown into an interval change: 3 short beeps spaced 1s apart,
    // then a longer "go" beep at the change.
    // Scheduled via timers (not a synchronous loop, which stacked all three into
    // a single audible blip) so each beep also re-checks `enabled` — muting
    // mid-pattern silences the rest.
    const spacingMs = 1000;
    for (let i = 0; i < 3; i++) {
      this.addTimeout(() => this.playBeep(240, 880, 0.75), i * spacingMs);
    }
    this.addTimeout(() => this.playBeep(500, 660, 0.75), 3 * spacingMs);
  }

  playDangerDanger(): void {
    this.playBeep(500, 660, 0.75);
  }

  /**
   * Soft triple-tap cue played once when a text event becomes active during a
   * ride. Three layered triangle+sine taps through a low-pass filter. No-op when
   * sound is disabled or no AudioContext is available.
   */
  playTextEventTaps(gain = 0.6): void {
    if (!this.enabled) return;
    const ctx = this.runningAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const tapSpacing = 0.12;
      const tapDuration = 0.09;

      const scheduleTap = (startTime: number): void => {
        const master = ctx.createGain();
        master.gain.value = 0.0001;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, startTime);
        filter.Q.setValueAtTime(0.7, startTime);
        filter.connect(ctx.destination);
        master.connect(filter);

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc2.type = 'sine';

        const base1 = 250;
        const base2 = 370;
        osc1.frequency.setValueAtTime(base1 * 1.06, startTime);
        osc1.frequency.linearRampToValueAtTime(base1, startTime + 0.035);
        osc2.frequency.setValueAtTime(base2 * 1.02, startTime);
        osc2.frequency.linearRampToValueAtTime(base2, startTime + 0.03);

        osc1.detune.value = -8;
        osc2.detune.value = 6;

        osc1.connect(master);
        osc2.connect(master);

        const attack = 0.003;
        const release = tapDuration;
        master.gain.setValueAtTime(0.0001, startTime);
        master.gain.linearRampToValueAtTime(gain, startTime + attack);
        master.gain.exponentialRampToValueAtTime(0.0001, startTime + release);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + release + 0.05);
        osc2.stop(startTime + release + 0.05);
        this.trackOscillator(osc1);
        this.trackOscillator(osc2);
      };

      for (let i = 0; i < 3; i += 1) {
        scheduleTap(now + i * tapSpacing);
      }
    } catch {
      /* ignore audio errors */
    }
  }

  private showOverlay(label: string, fontSize: number): void {
    const overlay = this.statusOverlay;
    const text = this.statusText;
    if (!overlay || !text) return;
    text.textContent = label;
    text.style.fontSize = `${fontSize}px`;
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
  }

  showPausedOverlay(): void {
    this.showStatusMessage('Workout Paused');
  }

  showResumedOverlay(): void {
    this.showStatusMessage('Workout Resumed');
  }

  private showStatusMessage(textValue: string, durationMs = 1600): void {
    const overlay = this.statusOverlay;
    const text = this.statusText;
    if (!overlay || !text) return;
    const fontSize = Math.floor((window.innerHeight || 800) * 0.18);
    text.textContent = textValue;
    text.style.fontSize = `${fontSize}px`;
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    this.addTimeout(() => {
      overlay.style.opacity = '0';
      this.addTimeout(() => {
        overlay.style.display = 'none';
      }, 300);
    }, durationMs);
  }

  private clearTransientState(): void {
    this.clearTimeouts();
    this.countdownRunning = false;
    const overlay = this.statusOverlay;
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.display = 'none';
    }
  }

  stopAll(): void {
    this.clearTransientState();
    this.releaseKeepAwake();
    this.stopOscillators();
    // Closing releases WebKitGTK/GStreamer pipeline state and invalidates every
    // scheduled node. A later primer creates a fresh context instead of waking a
    // context that still owns stale cues from the completed ride.
    this.closeAudioContext();
  }

  runStartCountdown(onDone: () => void): void {
    if (!this.statusOverlay || !this.statusText) {
      // No overlay DOM: still drive onDone on the (virtual) clock so the engine
      // start sequence runs deterministically under the harness.
      this.addTimeout(() => onDone && onDone(), 0);
      return;
    }

    // Reset an earlier countdown without closing the context primed by the user
    // gesture that started this one.
    this.clearTransientState();
    this.countdownRunning = true;

    const seq = ['3', '2', '1', 'Start'];
    const totalHeight = window.innerHeight || 800;
    const fontSize = Math.floor(totalHeight * 0.25);

    const step = (idx: number): void => {
      if (!this.countdownRunning) return;

      if (idx >= seq.length) {
        const overlay = this.statusOverlay;
        if (overlay) overlay.style.opacity = '0';
        this.addTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          this.countdownRunning = false;
          onDone && onDone();
        }, 200);
        return;
      }

      const label = seq[idx]!;
      this.showOverlay(label, fontSize);

      if (label === 'Start') this.playBeep(220, 660, 0.75);
      else this.playBeep(120, 880, 0.75);

      this.addTimeout(() => {
        const overlay = this.statusOverlay;
        if (overlay) overlay.style.opacity = '0';
      }, 500);
      this.addTimeout(() => step(idx + 1), 1000);
    };

    step(0);
  }
}
