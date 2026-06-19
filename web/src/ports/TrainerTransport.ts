// TrainerTransport.ts
//
// Port interface for the BLE trainer/HR transport. Mirrors the public surface
// of docs/ble-manager.js (the legacy singleton). The web implementation
// (WebBluetoothTransport) reads `navigator.bluetooth` so the harness fake drives
// it exactly like the legacy app.

export interface BikeSample {
  power: number | null;
  cadence: number | null;
  speedKph: number | null;
  hrFromBike: number | null;
}

export interface DeviceStatus {
  // 'idle' is emitted when a connect attempt is cancelled by the user (the
  // device chooser AbortError) and nothing was previously connected — the dot
  // returns to its neutral/idle color rather than showing a connect error.
  state: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
}

export type TrainerState =
  | { kind: 'erg'; value: number }
  | { kind: 'resistance'; value: number };

export interface TransportEvents {
  bikeSample: BikeSample;
  hrSample: number | null;
  bikeStatus: DeviceStatus;
  hrStatus: DeviceStatus;
  hrBattery: number | null;
  log: string;
}

export type TransportEventType = keyof TransportEvents;

export interface TrainerTransport {
  init(opts?: { autoReconnect?: boolean }): void;
  connectBikeViaPicker(): Promise<void>;
  connectHrViaPicker(): Promise<void>;
  setTrainerState(state: TrainerState, opts?: { force?: boolean }): Promise<void>;
  on<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): () => void;
  off<T extends TransportEventType>(type: T, fn: (payload: TransportEvents[T]) => void): void;
}
