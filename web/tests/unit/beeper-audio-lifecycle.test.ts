import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Beeper} from '../../src/core/beeper.js';

class FakeNode {
  disconnectCalls = 0;

  connect(): FakeNode {
    return this;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

function makeParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = makeParam(440);
  detune = {value: 0};
  onended: (() => void) | null = null;
  startCalls: number[] = [];
  stopCalls: Array<number | undefined> = [];

  start(at = 0): void {
    this.startCalls.push(at);
  }

  stop(at?: number): void {
    this.stopCalls.push(at);
    if (at == null) this.onended?.();
  }
}

class FakeAudioContext {
  static initialState: AudioContextState = 'running';
  static instances: FakeAudioContext[] = [];

  state = FakeAudioContext.initialState;
  currentTime = 42;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return Object.assign(new FakeNode(), {gain: makeParam(1)});
  }

  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'lowpass',
      frequency: makeParam(350),
      Q: makeParam(1),
    });
  }

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    // Deliberately remain suspended: this models WebKitGTK waiting for the
    // pipeline/user activation while ensureAudioContext() returns synchronously.
    return new Promise(() => {});
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

function setGlobal(name: 'window' | 'document', value: unknown): void {
  Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
}

function restoreGlobal(name: 'window' | 'document', descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe('Beeper audio lifecycle', () => {
  beforeEach(() => {
    FakeAudioContext.initialState = 'running';
    FakeAudioContext.instances = [];
    setGlobal('window', {
      AudioContext: FakeAudioContext,
      addEventListener() {},
      setTimeout,
      clearTimeout,
    });
    setGlobal('document', {
      addEventListener() {},
      getElementById() {
        return null;
      },
      visibilityState: 'visible',
    });
  });

  afterEach(() => {
    restoreGlobal('window', originalWindow);
    restoreGlobal('document', originalDocument);
  });

  it('drops audible cues while AudioContext resume is still pending', () => {
    FakeAudioContext.initialState = 'suspended';
    const beeper = new Beeper();
    beeper.setEnabled(true);

    beeper.playTextEventTaps(0.5);
    beeper.playDangerDanger();

    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.state).toBe('suspended');
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('stops scheduled oscillators, closes the context, and starts fresh afterward', () => {
    const beeper = new Beeper();
    beeper.setEnabled(true);
    beeper.playTextEventTaps(0.5);

    const oldCtx = FakeAudioContext.instances[0]!;
    expect(oldCtx.oscillators).toHaveLength(6);
    oldCtx.state = 'suspended';

    beeper.stopAll();

    expect(oldCtx.closeCalls).toBe(1);
    expect(oldCtx.state).toBe('closed');
    for (const osc of oldCtx.oscillators) {
      expect(osc.stopCalls.at(-1)).toBeUndefined();
      expect(osc.disconnectCalls).toBeGreaterThan(0);
    }

    beeper.playDangerDanger();
    const newCtx = FakeAudioContext.instances[1]!;
    expect(newCtx).not.toBe(oldCtx);
    expect(newCtx.oscillators).toHaveLength(1);
  });
});
