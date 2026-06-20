// beeper.ts
//
// Focused TypeScript port of docs/beeper.js. The HUD needs the start countdown
// (3-2-1-Start) whose onDone callback starts the ride, plus the basic audio
// cue primitive (so the fake AudioContext records oscillator-start events for
// the harness). Reads `window.setTimeout` / `window.AudioContext` so the
// platform shim (virtual clock + fake audio) drives it like the legacy app.
//
// Overlay DOM (#statusOverlay/#statusText) is optional: when present the
// countdown shows the big "3/2/1/Start" labels; when absent the countdown still
// runs on the (virtual) clock and fires onDone, matching legacy behavior.

type AudioContextCtor = new () => AudioContext;

export interface BeeperLike {
  setEnabled(flag: boolean): void;
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
    if (this.audioCtx) return this.audioCtx;
    const Ctor = (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext;
    if (!Ctor) return null;
    try {
      this.audioCtx = new Ctor();
    } catch {
      this.audioCtx = null;
    }
    return this.audioCtx;
  }

  setVolume(v: number): void {
    // Gain multiplier where 1.0 is the reference loudness (the settings slider's
    // 70% mark). Allow a modest boost above 1.0; playBeep caps the final gain at
    // 1.0 so the boost never clips.
    this.volume = Math.max(0, Math.min(1.5, Number.isFinite(v) ? v : 1));
  }

  private playBeep(durationMs: number, freq: number, gain: number): void {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.ensureAudioContext();
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
    } catch {
      /* ignore audio errors */
    }
  }

  playBeepPattern(): void {
    // 3 short beeps; primitive cue only (no precise scheduling needed for HUD).
    for (let i = 0; i < 3; i++) this.playBeep(120, 880, 0.75);
  }

  playDangerDanger(): void {
    this.playBeep(500, 660, 0.75);
  }

  /**
   * Soft triple-tap cue played once when a text event becomes active during a
   * ride (port of docs/beeper.js playTextEventTaps, 387). Three layered
   * triangle+sine taps through a low-pass filter. No-op when sound is disabled
   * or no AudioContext is available.
   */
  playTextEventTaps(gain = 0.6): void {
    if (!this.enabled) return;
    const ctx = this.ensureAudioContext();
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

  stopAll(): void {
    this.clearTimeouts();
    this.countdownRunning = false;
    const overlay = this.statusOverlay;
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.display = 'none';
    }
  }

  runStartCountdown(onDone: () => void): void {
    if (!this.statusOverlay || !this.statusText) {
      // No overlay DOM: still drive onDone on the (virtual) clock so the engine
      // start sequence runs deterministically under the harness.
      this.addTimeout(() => onDone && onDone(), 0);
      return;
    }

    this.stopAll();
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
