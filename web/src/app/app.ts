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
  // Called when a ride finishes (after the FIT is written). Mirrors the legacy
  // onWorkoutEnded follow-up (docs/workout.js:1368) — the shell uses it to open
  // the planner to the saved ride. `info` is null when nothing was saved.
  onWorkoutEnded?: (info: { fileName: string; startedAt: Date; endedAt: Date } | null) => void;
}

export async function bootApp(opts: BootOptions = {}): Promise<AppContext> {
  const transport = new WebBluetoothTransport();
  const fileStore = new WebFileStore();
  const beeper = new Beeper();
  const store = new EngineStore();
  const logs = new LogsStore();

  const engine = new WorkoutEngine({ transport, fileStore, beeper });

  // Surface transport device status into the store (mirrors legacy bottom-nav).
  transport.on('bikeStatus', (s) => {
    store.bikeStatus = s.state;
  });
  transport.on('hrStatus', (s) => {
    store.hrStatus = s.state;
  });
  transport.on('hrBattery', (pct) => {
    store.hrBatteryPercent = pct;
  });
  // Surface BLE/transport logs in the Settings logs sub-view (mirrors legacy
  // workout.js `BleManager.on("log", logDebug)` → addLogLineToSettings).
  transport.on('log', logs.append);

  // Load persisted FTP + sound preference before init (the engine reads the
  // selected workout + active state itself in init()).
  const ftp = await fileStore.getSetting<number>('ftp', DEFAULT_FTP);
  const soundEnabled = await fileStore.getSetting<boolean>('soundEnabled', false);
  beeper.setEnabled(!!soundEnabled);
  engine.setFtpInitial(ftp);

  // Apply the persisted theme to <html> (mirrors legacy initThemeFromStorage).
  // The inline anti-FOUC script in index.html only reads localStorage; the
  // store (IDB) is authoritative for the harness, so re-apply here.
  applyThemeMode(await loadThemeMode(fileStore));

  // Tell the transport which saved devices to auto-reconnect, and how to persist
  // a newly paired device id for next-load reconnect (mirrors legacy
  // saveBikeBleDeviceId/saveHrBleDeviceId via storage.js).
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
  });

  return { store, engine, transport, fileStore, beeper, logs };
}
