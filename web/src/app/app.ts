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
import { DEFAULT_FTP } from '../core/metrics.js';
import { applyThemeMode, loadThemeMode } from './theme.js';

export interface AppContext {
  store: EngineStore;
  engine: WorkoutEngine;
  transport: WebBluetoothTransport;
  fileStore: WebFileStore;
  beeper: Beeper;
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

  // Tell the transport which saved devices to auto-reconnect.
  const { bikeId, hrId } = await fileStore.loadBleDeviceIds();
  transport.setSavedDeviceIds({ bikeId, hrId });

  await engine.init({
    onStateChanged: store.set,
    onLog: () => {},
    onWorkoutEnded: opts.onWorkoutEnded,
  });

  return { store, engine, transport, fileStore, beeper };
}
