// harness/audio-recorder.ts
//
// A fake `AudioContext` that satisfies docs/beeper.js and RECORDS audio cue
// activity for assertions. Beeper schedules audio purely through Web Audio
// nodes and drives its countdown / pattern timing through `setTimeout` — which
// the virtual clock owns. So the countdown `onDone` (the callback that STARTS a
// ride, per Part X) fires automatically once the clock advances ~4s through
// beeper's timer cascade; this recorder just has to be a working-enough audio
// backend so `ensureAudioContext()` returns non-null and beep scheduling runs.
//
// Recording: every oscillator `start()` is logged with its time + frequency, so
// the test can assert "3 short beeps + 1 long" (playBeepPattern), countdown
// beeps, danger siren/honk, and text-event taps by counting/inspecting events.

export interface AudioCueEvent {
  type: "oscillator-start";
  freq: number;
  oscType: string;
  /** ctx.currentTime at scheduling (virtual seconds). */
  at: number;
}

export interface AudioRecorder {
  /** Constructor to install as window.AudioContext. */
  AudioContextClass: new () => FakeAudioContext;
  /** All recorded oscillator starts, in order. */
  events: AudioCueEvent[];
  /** Convenience: count of oscillator starts (≈ number of tones scheduled). */
  toneCount: () => number;
  reset: () => void;
}

function makeParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
  };
}

class FakeAudioNode {
  connect(): FakeAudioNode {
    return this;
  }
  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = makeParam(1);
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = "lowpass";
  frequency = makeParam(350);
  Q = makeParam(1);
}

class FakeOscillatorNode extends FakeAudioNode {
  type = "sine";
  frequency = makeParam(440);
  detune = makeParam(0);
  onended: (() => void) | null = null;
  private ctx: FakeAudioContext;
  constructor(ctx: FakeAudioContext) {
    super();
    this.ctx = ctx;
  }
  start(when = this.ctx.currentTime): void {
    this.ctx._record({
      type: "oscillator-start",
      freq: this.frequency.value,
      oscType: this.type,
      at: when,
    });
  }
  stop(): void {
    if (this.onended) {
      try {
        this.onended();
      } catch {
        /* ignore */
      }
    }
  }
}

export class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "running";
  currentTime = 0;
  destination = new FakeAudioNode();
  private recorder: { events: AudioCueEvent[] };

  // Each instance shares the active recorder via a module-level binding set up
  // by createAudioRecorder().
  constructor() {
    this.recorder = activeRecorder ?? {events: []};
  }
  _record(ev: AudioCueEvent): void {
    this.recorder.events.push(ev);
  }
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode(this);
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode();
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
}

// Module-level so all FakeAudioContext instances feed the same recorder.
let activeRecorder: { events: AudioCueEvent[] } | null = null;

export function createAudioRecorder(): AudioRecorder {
  const rec = {events: [] as AudioCueEvent[]};
  activeRecorder = rec;
  return {
    AudioContextClass: FakeAudioContext,
    events: rec.events,
    toneCount: () => rec.events.length,
    reset: () => {
      rec.events.length = 0;
    },
  };
}
