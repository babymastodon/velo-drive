<script lang="ts">
  import type { EngineStore } from '../state/engine.svelte.js';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { WebBluetoothTransport } from '../ports/web/WebBluetoothTransport.js';
  import type { DialogStore } from '../state/dialog.svelte.js';
  import StatCards from './StatCards.svelte';
  import LiveChart from './LiveChart.svelte';
  import BottomNav from './BottomNav.svelte';

  let {
    store,
    engine,
    transport,
    dialogs,
    onOpenSettings,
    onOpenPicker,
    onOpenPlanner,
  }: {
    store: EngineStore;
    engine: WorkoutEngine;
    transport: WebBluetoothTransport;
    dialogs: DialogStore;
    onOpenSettings?: () => void;
    onOpenPicker?: () => void;
    onOpenPlanner?: () => void;
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
    {dialogs}
    {onOpenSettings}
    {onOpenPicker}
    {onOpenPlanner}
    bikeStatus={store.bikeStatus}
    hrStatus={store.hrStatus}
    hrBatteryPercent={store.hrBatteryPercent}
  />
{/if}
