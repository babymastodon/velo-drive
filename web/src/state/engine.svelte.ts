// state/engine.svelte.ts
//
// Svelte 5 signals store wrapping the engine view-model. Must be a `.svelte.ts`
// module so the `$state` runes compile. The composition root wires
// engine.init({ onStateChanged: store.set }); components read `store.vm`
// reactively.

import type { EngineViewModel } from '../core/engine.js';

export class EngineStore {
  vm = $state<EngineViewModel | null>(null);
  // Device status surfaced from transport events (not part of the engine VM).
  bikeStatus = $state<'connecting' | 'connected' | 'error' | 'idle'>('idle');
  hrStatus = $state<'connecting' | 'connected' | 'error' | 'idle'>('idle');
  hrBatteryPercent = $state<number | null>(null);

  set = (vm: EngineViewModel): void => {
    this.vm = vm;
  };
}
