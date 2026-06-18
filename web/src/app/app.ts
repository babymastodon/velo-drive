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

export interface AppContext {
  store: EngineStore;
  engine: WorkoutEngine;
  transport: WebBluetoothTransport;
}

export async function bootApp(): Promise<AppContext> {
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

  // Tell the transport which saved devices to auto-reconnect.
  const { bikeId, hrId } = await fileStore.loadBleDeviceIds();
  transport.setSavedDeviceIds({ bikeId, hrId });

  await engine.init({
    onStateChanged: store.set,
    onLog: () => {},
  });

  return { store, engine, transport };
}
