<script lang="ts">
  import type { EngineStore } from '../state/engine.svelte.js';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { WebBluetoothTransport } from '../ports/web/WebBluetoothTransport.js';
  import StatCards from './StatCards.svelte';
  import LiveChart from './LiveChart.svelte';
  import BottomNav from './BottomNav.svelte';

  let {
    store,
    engine,
    transport,
    onOpenSettings,
  }: {
    store: EngineStore;
    engine: WorkoutEngine;
    transport: WebBluetoothTransport;
    onOpenSettings?: () => void;
  } = $props();

  const vm = $derived(store.vm);
  const bikeConnected = $derived(store.bikeStatus === 'connected');
</script>

{#if vm}
  <div class="page-root" data-testid="hud-page-root">
    <StatCards {vm} />
    <LiveChart {vm} {bikeConnected} />
  </div>
  <BottomNav
    {vm}
    {engine}
    {transport}
    {onOpenSettings}
    bikeStatus={store.bikeStatus}
    hrStatus={store.hrStatus}
    hrBatteryPercent={store.hrBatteryPercent}
  />
{/if}
