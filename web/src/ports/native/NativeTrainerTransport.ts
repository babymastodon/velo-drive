// NativeTrainerTransport — the Tauri (native) implementation of the
// TrainerTransport seam. Drives the Rust BLE connector (src-tauri/src/ble.rs)
// via Tauri commands and re-emits its events as TransportEvents, so the engine
// and UI are identical to the Web Bluetooth path.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  TrainerTransport,
  TransportEvents,
  TransportEventType,
  TrainerState,
  DeviceStatus,
} from '../TrainerTransport.js';

// Throttle control-point writes like the web transport (the engine calls
// setTrainerState every tick; only push on change or after this interval).
const TRAINER_SEND_MIN_INTERVAL_SEC = 10;

// Payload shapes emitted by the Rust side (serde; Option<T> -> T | null).
interface BleBikeSample {
  power: number | null;
  cadence: number | null;
  speed: number | null;
  hr: number | null;
}
interface BleStatus {
  role: 'bike' | 'hr' | string;
  state: string;
  message: string;
  deviceId: string | null;
  deviceName: string | null;
}

export interface BleDevice {
  id: string;
  name: string;
  rssi: number | null;
}

function shortErr(err: unknown): string {
  const s = String((err as { message?: string })?.message ?? err ?? '').trim();
  return s.length > 140 ? s.slice(0, 140) + '…' : s || 'unknown error';
}

/** Map the Rust connector states onto the interface's DeviceStatus states. */
function mapState(s: string): DeviceStatus['state'] {
  switch (s) {
    case 'connected':
      return 'connected';
    case 'connecting':
    case 'scanning':
      return 'connecting';
    case 'idle':
      return 'idle';
    default:
      // 'disconnected' / 'error' both surface as an error dot.
      return 'error';
  }
}

export class NativeTrainerTransport implements TrainerTransport {
  private listeners: { [K in TransportEventType]: Set<(payload: TransportEvents[K]) => void> } = {
    bikeSample: new Set(),
    hrSample: new Set(),
    bikeStatus: new Set(),
    hrStatus: new Set(),
    hrBattery: new Set(),
    log: new Set(),
  };

  private savedBikeId: string | null = null;
  private savedHrId: string | null = null;
  private persistBikeId: ((id: string | null) => void) | null = null;
  private persistHrId: ((id: string | null) => void) | null = null;

  private lastMode: 'erg' | 'resistance' | null = null;
  private lastTarget = NaN;
  private lastSendSec = -Infinity;

  constructor() {
    // Bridge the Rust events onto the TransportEvents the engine/UI consume.
    void listen<BleBikeSample>('ble://bike-sample', (e) => {
      const p = e.payload;
      this.emit('bikeSample', {
        power: p.power,
        cadence: p.cadence,
        speedKph: p.speed,
        hrFromBike: p.hr,
      });
    });
    void listen<{ hr: number }>('ble://hr-sample', (e) => {
      this.emit('hrSample', e.payload.hr);
    });
    void listen<BleStatus>('ble://status', (e) => this.onStatus(e.payload));
    void listen<string>('ble://log', (e) => this.emit('log', e.payload));
  }

  private onStatus(p: BleStatus): void {
    const event: 'bikeStatus' | 'hrStatus' = p.role === 'hr' ? 'hrStatus' : 'bikeStatus';
    this.emit(event, { state: mapState(p.state), message: p.message });
    // Remember a newly connected device so we can reconnect on next launch.
    if (p.state === 'connected' && p.deviceId) {
      if (p.role === 'hr') this.persistHrId?.(p.deviceId);
      else this.persistBikeId?.(p.deviceId);
    }
  }

  private emit<T extends TransportEventType>(type: T, payload: TransportEvents[T]): void {
    for (const fn of Array.from(this.listeners[type])) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[native-transport]', err);
      }
    }
  }

  on<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): () => void {
    if (!this.listeners[type]) throw new Error('Unknown event type: ' + type);
    this.listeners[type].add(fn);
    return () => this.off(type, fn);
  }

  off<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): void {
    this.listeners[type]?.delete(fn);
  }

  init(opts?: { autoReconnect?: boolean }): void {
    if (opts?.autoReconnect === false) return;
    // Reconnect saved devices on boot; the Rust side soft-fails if they're
    // absent (off / out of range / used by another app).
    void invoke('ble_reconnect', { bikeId: this.savedBikeId, hrId: this.savedHrId }).catch((err) =>
      this.emit('log', 'auto-reconnect failed: ' + String(err)),
    );
  }

  setSavedDeviceIds(ids: { bikeId?: string | null; hrId?: string | null }): void {
    this.savedBikeId = ids.bikeId || null;
    this.savedHrId = ids.hrId || null;
  }

  setPersistDeviceIds(cb: {
    saveBikeId: (id: string | null) => void;
    saveHrId: (id: string | null) => void;
  }): void {
    this.persistBikeId = cb.saveBikeId;
    this.persistHrId = cb.saveHrId;
  }

  // Set by the composition root: shows the device-chooser UI and resolves with
  // the picked device id (or null if cancelled). When unset, falls back to the
  // legacy auto-pick-first behavior.
  onPickDevice: ((role: 'bike' | 'hr', devices: BleDevice[]) => Promise<string | null>) | null =
    null;

  async connectBikeViaPicker(): Promise<void> {
    await this.connectViaPicker('bike');
  }

  async connectHrViaPicker(): Promise<void> {
    await this.connectViaPicker('hr');
  }

  private async connectViaPicker(role: 'bike' | 'hr'): Promise<void> {
    const evt: 'bikeStatus' | 'hrStatus' = role === 'hr' ? 'hrStatus' : 'bikeStatus';
    const label = role === 'hr' ? 'heart-rate monitor' : 'trainer';

    this.emit(evt, { state: 'connecting', message: `Scanning for your ${label}…` });
    let devices: BleDevice[];
    try {
      devices = await invoke<BleDevice[]>('ble_scan', { secs: 4 });
    } catch (err) {
      this.emit(evt, {
        state: 'error',
        message: `Bluetooth scan failed — ${shortErr(err)}. Is Bluetooth turned on?`,
      });
      return;
    }

    const named = devices
      .filter((d) => (d.name || '').trim())
      .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    if (!named.length) {
      this.emit(evt, {
        state: 'error',
        message: `No Bluetooth devices found. Turn your ${label} on, wake it (pedal / touch the strap), and make sure it isn't connected to another app.`,
      });
      return;
    }

    if (!this.onPickDevice) {
      // No chooser wired — fall back to auto-pick-first.
      await invoke(role === 'hr' ? 'ble_connect_hr' : 'ble_connect_bike').catch((err) =>
        this.emit(evt, { state: 'error', message: `Connect failed — ${shortErr(err)}.` }),
      );
      return;
    }

    let id: string | null;
    try {
      id = await this.onPickDevice(role, named);
    } catch {
      id = null;
    }
    if (!id) {
      // Cancelled — back to a neutral dot, not an error.
      this.emit(evt, { state: 'idle', message: '' });
      return;
    }

    const dev = named.find((d) => d.id === id);
    this.emit(evt, { state: 'connecting', message: `Connecting to ${dev?.name || 'device'}…` });
    try {
      await invoke('ble_connect_device', { role, id });
    } catch (err) {
      this.emit(evt, {
        state: 'error',
        message: `Couldn't connect to ${dev?.name || 'the device'} — ${shortErr(err)}.`,
      });
    }
  }

  async setTrainerState(state: TrainerState, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    if (!Number.isFinite(state.value)) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const target = Math.round(state.value);
    const needsSend =
      force ||
      this.lastMode !== state.kind ||
      this.lastTarget !== target ||
      now - this.lastSendSec >= TRAINER_SEND_MIN_INTERVAL_SEC;
    if (!needsSend) return;
    try {
      if (state.kind === 'erg') {
        const watts = Math.max(0, Math.min(2000, target));
        await invoke('ble_set_target_power', { watts });
      } else {
        const level = Math.max(0, Math.min(100, target));
        await invoke('ble_set_resistance', { tenths: level * 10 });
      }
      // Only commit dedupe state on success, so a failed write is retried.
      this.lastMode = state.kind;
      this.lastTarget = target;
      this.lastSendSec = now;
    } catch (err) {
      this.emit('log', 'set trainer state failed: ' + String(err));
    }
  }
}
