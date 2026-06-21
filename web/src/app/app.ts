// app/app.ts
//
// Composition root. Wires the ports (WebBluetoothTransport, WebFileStore),
// the Beeper, and the WorkoutEngine together, loads boot state (FTP, selected
// workout, saved devices), connects saved devices, and exposes the reactive
// store + engine to the UI.

import { WebBluetoothTransport } from '../ports/web/WebBluetoothTransport.js';
import { WebFileStore } from '../ports/web/WebFileStore.js';
import { Beeper } from '../core/beeper.js';
import { WorkoutEngine } from '../core/engine.js';
import { EngineStore } from '../state/engine.svelte.js';
import { LogsStore } from '../state/logs.svelte.js';
import { DEFAULT_FTP } from '../core/metrics.js';
import { applyThemeMode, loadThemeMode } from './theme.js';

export interface AppContext {
  store: EngineStore;
  engine: WorkoutEngine;
  transport: WebBluetoothTransport;
  fileStore: WebFileStore;
  beeper: Beeper;
  logs: LogsStore;
}

export interface BootOptions {
  // Called when a ride finishes (after the FIT is written). The shell uses it to
  // open the planner to the saved ride. `info` is null when nothing was saved.
  onWorkoutEnded?: (info: { fileName: string; startedAt: Date; endedAt: Date } | null) => void;
  // Surfaces the important WebFileStore failures (no folder, permission revoked,
  // save/delete failed) to the UI via a themed Dialog alert. Wired to
  // dialogs.alert.
  onFileError?: (message: string) => void;
  // Surfaces the engine's two reachable warnings (no workout / end current
  // workout first) via the themed Dialog.
  onEngineAlert?: (message: string) => void;
}

export async function bootApp(opts: BootOptions = {}): Promise<AppContext> {
  const transport = new WebBluetoothTransport();
  const fileStore = new WebFileStore();
  const beeper = new Beeper();
  const store = new EngineStore();
  const logs = new LogsStore();

  const engine = new WorkoutEngine({ transport, fileStore, beeper });

  // Route the important file-op failures to the themed Dialog.
  if (opts.onFileError) fileStore.onError = opts.onFileError;

  // Surface transport device status into the store (drives the bottom-nav).
  transport.on('bikeStatus', (s) => {
    store.bikeStatus = s.state;
    store.bikeStatusMessage = s.message;
  });
  transport.on('hrStatus', (s) => {
    store.hrStatus = s.state;
    store.hrStatusMessage = s.message;
  });
  transport.on('hrBattery', (pct) => {
    store.hrBatteryPercent = pct;
  });
  // Surface BLE/transport logs in the Settings logs sub-view.
  transport.on('log', logs.append);

  // Load persisted FTP + sound preference before init (the engine reads the
  // selected workout + active state itself in init()).
  const ftp = await fileStore.getSetting<number>('ftp', DEFAULT_FTP);
  // Default audible — SettingsView agrees.
  const soundEnabled = await fileStore.getSetting<boolean>('soundEnabled', true);
  beeper.setEnabled(!!soundEnabled);
  // Volume level (0..1) for the settings slider; independent of the on/off flag.
  // Default 50/70 → the slider's 50% default (70% == reference gain 1.0).
  beeper.setVolume(await fileStore.getSetting<number>('soundVolume', 50 / 70));
  engine.setFtpInitial(ftp);

  // Apply the persisted theme to <html>. The inline anti-FOUC script in
  // index.html only reads localStorage; the store (IDB) is authoritative for the
  // harness, so re-apply here.
  applyThemeMode(await loadThemeMode(fileStore));

  // Tell the transport which saved devices to auto-reconnect, and how to persist
  // a newly paired device id for next-load reconnect.
  const { bikeId, hrId } = await fileStore.loadBleDeviceIds();
  transport.setSavedDeviceIds({ bikeId, hrId });
  transport.setPersistDeviceIds({
    saveBikeId: (id) => fileStore.putSetting('lastBikeDeviceId', id),
    saveHrId: (id) => fileStore.putSetting('lastHrDeviceId', id),
  });

  await engine.init({
    onStateChanged: store.set,
    onLog: logs.append,
    onWorkoutEnded: opts.onWorkoutEnded,
    onAlert: opts.onEngineAlert,
  });

  return { store, engine, transport, fileStore, beeper, logs };
}
