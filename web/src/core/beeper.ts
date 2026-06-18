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
}

export class Beeper implements BeeperLike {
  private enabled = false;
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
    if (!flag) this.stopAll();
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

  private playBeep(durationMs: number, freq: number, gain: number): void {
    if (!this.enabled) return;
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
      g.gain.linearRampToValueAtTime(gain, now + attack);
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
