<script lang="ts">
  // App shell — boots the composition root, mounts the riding (HUD) view, and
  // hosts the overlay layer (welcome/settings), the dialog host, and the global
  // keymap. Reproduces the legacy riding-view DOM/classes so the re-hosted
  // global CSS applies unchanged.
  import { bootApp, type AppContext } from '../app/app.js';
  import HudView from './HudView.svelte';
  import SettingsView from './SettingsView.svelte';
  import PickerView from './PickerView.svelte';
  import PlannerView from './PlannerView.svelte';
  import WelcomeView from './WelcomeView.svelte';
  import StatusOverlay from './StatusOverlay.svelte';
  import Dialog from './Dialog.svelte';
  import { UiStore } from '../state/ui.svelte.js';
  import { DialogStore } from '../state/dialog.svelte.js';
  import { isPlatformIncompatible, isWebBluetoothAvailable } from '../app/compat.js';

  let ctx = $state<AppContext | null>(null);
  const ui = new UiStore();
  const dialogs = new DialogStore();

  // Expose the UI/dialog stores so e2e tests can drive overlays that have no
  // on-screen entry point (e.g. open the welcome tour for its visual diff).
  // `getVm` lets behavior tests inspect the engine view-model (manual targets,
  // free-ride state) without reaching into internals.
  const appBridge = {
    ui,
    dialogs,
    getVm: () => ctx?.store.vm ?? null,
    // Diagnostic for behavior tests: how many FIT files the planner stats cache
    // has parsed (cache misses). A second open of an unchanged history adds 0.
    getHistoryParseCount: () => ctx?.fileStore.historyParseCount ?? 0,
  };
  (window as unknown as { __VELO_APP__: unknown }).__VELO_APP__ = appBridge;

  const welcomeActive = $derived(ui.activeOverlay === 'welcome');

  $effect(() => {
    let cancelled = false;
    bootApp({
      // Finishing a ride opens the planner to the saved ride (mirrors the
      // legacy onWorkoutEnded follow-up in docs/workout.js:1368).
      onWorkoutEnded: (info) => {
        const date = info?.endedAt || info?.startedAt || new Date();
        ui.openPlannerForRide(info?.fileName ?? null, date);
      },
    })
      .then((c) => {
        if (cancelled) return;
        ctx = c;
        void maybeAutoOpenSettings(c);
      })
      .catch((err) => {
        console.error('[App] boot failed:', err);
      });
    return () => {
      cancelled = true;
    };
  });

  // Boot-time auto-open (mirrors docs/settings.js startupNeedsAttention +
  // shouldAutoOpen): if the root data folder is missing, OR Web Bluetooth is
  // unavailable, OR the platform/browser is unsupported, auto-open Settings to
  // the relevant help section. In the hermetic tests the root dir is seeded,
  // the FTMS sim provides navigator.bluetooth.getDevices, and the runner is
  // Chromium — so all three conditions are false and this never fires.
  async function maybeAutoOpenSettings(c: AppContext): Promise<void> {
    let missingRootDir = false;
    try {
      const root = await c.fileStore.loadRootDirHandle();
      missingRootDir = !root;
    } catch {
      missingRootDir = true;
    }
    const missingBt = !isWebBluetoothAvailable();
    const incompatible = isPlatformIncompatible();

    if (!missingRootDir && !missingBt && !incompatible) return;
    // Force the most relevant help section open, then open Settings.
    if (missingRootDir) ui.forceHelpSection = 'settingsFoldersHelp';
    else if (missingBt) ui.forceHelpSection = 'settingsEnvHelp';
    ui.open('settings');
  }

  // Hide the HUD behind the welcome overlay exactly like legacy
  // (`body.welcome-active .page-root/.bottom-nav { visibility:hidden }`).
  $effect(() => {
    document.body.classList.toggle('welcome-active', welcomeActive);
  });

  function isEditable(el: EventTarget | null): boolean {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  // Per-overlay keydown hooks. When an overlay is open, global hotkeys are
  // suppressed and the keydown is routed to that overlay's handler instead
  // (picker/planner/builder register their own in later waves). A handler
  // returns true if it consumed the key. This is the single routing convention
  // the other waves hook into — overlays populate ui.overlayKeyHandlers on mount
  // (see UiStore.registerOverlayKeyHandler / PickerView).
  const overlayKeyHandlers = ui.overlayKeyHandlers;

  function onKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      // Give the active overlay's handler first crack at Escape (e.g. the
      // planner pops its ride-detail sub-view back to the calendar, or the
      // picker clears its search). If it consumes the key, stop; otherwise fall
      // back to the default disposition (handleEscape → close the overlay).
      if (ui.activeOverlay !== 'none') {
        const handler = overlayKeyHandlers[ui.activeOverlay];
        if (handler && handler(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (ui.handleEscape()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // When an overlay is open, route the key to that overlay (if it has a
    // handler) and never fall through to the global HUD hotkeys. Welcome
    // suppresses everything (no handler), matching legacy `isWelcomeActive`.
    if (ui.activeOverlay !== 'none') {
      const handler = overlayKeyHandlers[ui.activeOverlay];
      if (handler && handler(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Global HUD hotkeys — only with no overlay open and not typing in a field.
    if (isEditable(e.target)) return;
    if (!ctx) return;
    const vm = ctx.store.vm;

    // Space → start / pause / resume (only when a workout is selected). Use
    // e.code so it's layout-independent, mirroring legacy.
    if (e.code === 'Space') {
      if (!vm?.canonicalWorkout) return;
      e.preventDefault();
      ctx.engine.startWorkout();
      return;
    }

    const key = (e.key || '').toLowerCase();

    // Manual ±10 (ArrowUp/k = +10, ArrowDown/j = -10) — only when a free-ride
    // segment is active. Routes to erg or resistance per the current mode.
    if (
      vm?.isFreeRideActive &&
      (key === 'arrowup' || key === 'k' || key === 'arrowdown' || key === 'j')
    ) {
      const delta = key === 'arrowup' || key === 'k' ? 10 : -10;
      e.preventDefault();
      if (vm.freeRideMode === 'erg') ctx.engine.adjustManualErg(delta);
      else ctx.engine.adjustManualResistance(delta);
      return;
    }

    // e / r → switch free-ride mode (only while a free-ride segment is active).
    if (key === 'e' || key === 'r') {
      e.preventDefault();
      const active = !!(vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting);
      if (active && vm?.isFreeRideActive) {
        ctx.engine.setFreeRideMode(key === 'e' ? 'erg' : 'resistance');
      }
      return;
    }

    if (key === 's') {
      e.preventDefault();
      ui.open('settings');
      return;
    }
    if (key === 'w') {
      e.preventDefault();
      openPicker();
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      openPlanner();
    }
  }

  // Open the workout picker, guarding against an active workout (matches legacy
  // openPickerWithGuard in docs/workout.js).
  function openPicker(): void {
    if (!ctx) return;
    const vm = ctx.store.vm;
    if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return;
    ui.open('picker');
  }

  // Open the planner (calendar), guarded against an active workout (matches the
  // legacy #calendarBtn / 'c' handlers in docs/workout.js).
  function openPlanner(): void {
    if (!ctx) return;
    const vm = ctx.store.vm;
    if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return;
    ui.open('planner');
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if ctx}
  <HudView
    store={ctx.store}
    engine={ctx.engine}
    transport={ctx.transport}
    {dialogs}
    onOpenSettings={() => ui.open('settings')}
    onOpenPicker={openPicker}
    onOpenPlanner={openPlanner}
  />

  <SettingsView
    store={ctx.store}
    engine={ctx.engine}
    fileStore={ctx.fileStore}
    beeper={ctx.beeper}
    logs={ctx.logs}
    {ui}
    open={ui.activeOverlay === 'settings'}
  />

  <PickerView
    store={ctx.store}
    engine={ctx.engine}
    fileStore={ctx.fileStore}
    {ui}
    {dialogs}
    open={ui.activeOverlay === 'picker'}
  />

  <PlannerView
    store={ctx.store}
    engine={ctx.engine}
    fileStore={ctx.fileStore}
    {ui}
    {dialogs}
    open={ui.activeOverlay === 'planner'}
  />
{/if}

<WelcomeView {ui} open={welcomeActive} />

<StatusOverlay />

<Dialog {dialogs} />
