<script lang="ts">
  // App shell — boots the composition root, mounts the riding (HUD) view, and
  // hosts the overlay layer (welcome/settings), the dialog host, and the global
  // keymap.
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
  import { themeStore, themeVersion } from '../state/theme.svelte.js';
  import { isPlatformIncompatible, isWebBluetoothAvailable } from '../app/compat.js';
  import { formatDateKey } from '../core/date-keys.js';
  import { isEditableTarget } from './dom-utils.js';
  import { ScreenWakeLock } from './wake-lock.js';

  let ctx = $state<AppContext | null>(null);
  // Keep the screen awake while a ride is in progress.
  const wakeLock = new ScreenWakeLock();
  const ui = new UiStore();
  const dialogs = new DialogStore();

  // Expose the UI/dialog stores so e2e tests can drive overlays that have no
  // on-screen entry point (e.g. open the welcome tour directly).
  // `getVm` lets behavior tests inspect the engine view-model (manual targets,
  // free-ride state) without reaching into internals.
  const appBridge = {
    ui,
    dialogs,
    getVm: () => ctx?.store.vm ?? null,
    // Diagnostic for behavior tests: how many FIT files the planner stats cache
    // has parsed (cache misses). A second open of an unchanged history adds 0.
    getHistoryParseCount: () => ctx?.fileStore.historyParseCount ?? 0,
    // Diagnostic for the theme-redraw test: the shared theme version counter,
    // bumped on a manual toggle OR an Auto-mode OS color-scheme flip.
    getThemeVersion: () => themeStore.version,
  };
  // Ensure the theme observer + OS-flip listener are installed at boot (charts
  // do this lazily on first render; this guarantees it even before any chart).
  themeVersion();
  (window as unknown as { __VELO_APP__: unknown }).__VELO_APP__ = appBridge;

  const welcomeActive = $derived(ui.activeOverlay === 'welcome');

  // Persist the open overlay so a page reload stays on the same screen (workout
  // library, planner, settings). Restored at boot in maybeRestoreLastOverlay,
  // after the higher-priority boot auto-opens (welcome / attention / today's
  // ride) have had their say.
  const LAST_OVERLAY_KEY = 'lastOverlay';
  let bootRestoreDone = $state(false);
  $effect(() => {
    const overlay = ui.activeOverlay;
    if (!ctx || !bootRestoreDone) return;
    // Welcome is first-run gated — never let it become the restored screen.
    if (overlay === 'welcome') return;
    void ctx.fileStore.putSetting(LAST_OVERLAY_KEY, overlay);
  });

  // Hold a screen wake lock whenever a ride is in progress (running, the 3-2-1
  // countdown, or an auto/manual pause). Released automatically when idle.
  $effect(() => {
    const vm = ctx?.store.vm;
    wakeLock.setWanted(!!(vm?.workoutRunning || vm?.workoutStarting || vm?.workoutPaused));
  });

  $effect(() => {
    let cancelled = false;
    bootApp({
      // Finishing a ride opens the planner to the saved ride.
      onWorkoutEnded: (info) => {
        const date = info?.endedAt || info?.startedAt || new Date();
        // Remove the just-completed scheduled entry for the ride's day.
        const finishedTitle = ctx?.store.vm?.canonicalWorkout?.workoutTitle;
        if (finishedTitle) {
          const dateKey = formatDateKey(date);
          void ctx?.fileStore.removeScheduledByTitle(dateKey, finishedTitle);
        }
        // Open the planner to the saved ride; the planner consumes
        // ui.pendingHistoryFile to auto-open the ride detail.
        ui.openPlannerForRide(info?.fileName ?? null, date);
      },
      // Surface the important file-op failures as a themed Dialog alert
      // instead of failing silently / native alert().
      onFileError: (message) => {
        void dialogs.alert(message, { title: 'VeloDrive' });
      },
      onEngineAlert: (message) => {
        void dialogs.alert(message, { title: 'VeloDrive' });
      },
    })
      .then((c) => {
        if (cancelled) return;
        ctx = c;
        // Wire the native BLE device chooser to a themed dialog (web uses the
        // browser's built-in requestDevice picker, so this is native-only).
        const t = c.transport as unknown as {
          onPickDevice?: (
            role: 'bike' | 'hr',
            scan: () => Promise<{ id: string; name: string; rssi?: number | null }[]>,
          ) => Promise<string | null>;
        };
        if ('onPickDevice' in t) {
          t.onPickDevice = (role, scan) =>
            dialogs.pickDevice(
              role === 'hr' ? 'Heart-rate monitor' : 'Trainer',
              `Select your ${role === 'hr' ? 'heart-rate monitor' : 'trainer'} from the devices found nearby.`,
              scan,
            );
        }
        void maybeShowWelcomeThenAttention(c);
      })
      .catch((err) => {
        console.error('[App] boot failed:', err);
      });
    return () => {
      cancelled = true;
    };
  });

  // Native (Tauri) window shortcuts: F11 fullscreen, Ctrl/Cmd+W or Ctrl/Cmd+Q close.
  $effect(() => {
    if (!(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)) return;
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F11') {
        e.preventDefault();
        void (async () => {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const w = getCurrentWindow();
          await w.setFullscreen(!(await w.isFullscreen()));
        })();
      } else if (mod && (e.key === 'w' || e.key === 'q')) {
        e.preventDefault();
        void (async () => {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().close();
        })();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // PWA / standalone detection.
  function isRunningAsPwa(): boolean {
    try {
      return !!(
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  }

  // Boot-time welcome gating. Shows the first-run tour for a fresh real user,
  // then falls through to startupNeedsAttention only when welcome was NOT shown.
  // Gating:
  //   * Persisted `hasSeenWelcome` flag → never show again (this is what the
  //     hermetic harness seeds, so configured test state never triggers it).
  //   * An active workout → never show (resuming a ride).
  //   * Otherwise show: FULL tour when on the web (not a PWA) OR the root folder
  //     is missing; a SPLASH when running as a configured PWA.
  // Returns true if it showed welcome (so the caller skips the settings auto-open).
  async function maybeShowWelcome(c: AppContext): Promise<boolean> {
    let seen = false;
    try {
      seen = await c.fileStore.getSetting<boolean>('hasSeenWelcome', false);
    } catch {
      seen = false;
    }
    if (seen) return false;

    const vm = c.store.vm;
    if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return false;

    let missingRootDir = false;
    try {
      missingRootDir = !(await c.fileStore.loadRootDirHandle());
    } catch {
      missingRootDir = true;
    }
    const runningAsPwa = isRunningAsPwa();
    const forceFullWelcome = !runningAsPwa || missingRootDir;

    // Mark seen now so a reload doesn't re-show it (persisted on first show).
    try {
      await c.fileStore.putSetting('hasSeenWelcome', true);
    } catch {
      /* ignore */
    }

    if (forceFullWelcome) ui.openWelcome('full', 0);
    else ui.openWelcome('splash', 0);
    return true;
  }

  async function maybeShowWelcomeThenAttention(c: AppContext): Promise<void> {
    const shown = await maybeShowWelcome(c);
    if (!shown) {
      await maybeAutoOpenSettings(c);
      // If settings didn't claim the screen, auto-open the planner to today's
      // scheduled ride.
      if (ui.activeOverlay === 'none') await maybeOpenPlannerForTodaySchedule(c);
      // Otherwise, restore whatever overlay was open before a reload.
      if (ui.activeOverlay === 'none') await maybeRestoreLastOverlay(c);
    }
    // From here on, overlay changes are persisted (see the effect above).
    bootRestoreDone = true;
  }

  // Reopen the overlay that was showing before a reload (workout library /
  // planner / settings) so the user lands back where they left off.
  async function maybeRestoreLastOverlay(c: AppContext): Promise<void> {
    try {
      const vm = c.store.vm;
      if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return;
      const last = await c.fileStore.getSetting<string>(LAST_OVERLAY_KEY, 'none');
      if (last === 'planner' || last === 'settings') {
        ui.open(last);
      } else if (last === 'picker') {
        // The picker needs a configured folder; otherwise stay on the HUD.
        const root = await c.fileStore.loadRootDirHandle().catch(() => null);
        if (root) ui.open('picker');
      }
    } catch (err) {
      console.warn('[App] Failed to restore last overlay:', err);
    }
  }

  // Boot-time auto-open of the planner when TODAY has a scheduled workout.
  // Suppressed when a workout is active or the scheduled workout is already the
  // loaded one.
  async function maybeOpenPlannerForTodaySchedule(c: AppContext): Promise<void> {
    try {
      const vm = c.store.vm;
      if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return;

      const d = new Date();
      const todayKey = formatDateKey(d);
      const schedule = await c.fileStore.loadSchedule();
      if (!Array.isArray(schedule) || !schedule.length) return;
      const todayEntry = schedule.find((e) => e && e.date === todayKey && e.workoutTitle);
      if (!todayEntry) return;

      // Already loaded? (case-insensitive trimmed title match) → don't reopen.
      const loadedTitle = (vm?.canonicalWorkout?.workoutTitle || '').trim().toLowerCase();
      if (loadedTitle && loadedTitle === todayEntry.workoutTitle.trim().toLowerCase()) return;

      ui.open('planner');
    } catch (err) {
      console.warn('[App] Failed to auto-open planner for today:', err);
    }
  }

  // Boot-time auto-open: if the root data folder is missing, OR Web Bluetooth is
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

  // Hide the HUD behind the welcome overlay
  // (`body.welcome-active .page-root/.bottom-nav { visibility:hidden }`).
  $effect(() => {
    document.body.classList.toggle('welcome-active', welcomeActive);
  });

  // Per-overlay keydown hooks. When an overlay is open, global hotkeys are
  // suppressed and the keydown is routed to that overlay's handler instead
  // (picker/planner/builder register their own in later waves). A handler
  // returns true if it consumed the key. This is the single routing convention
  // the other waves hook into — overlays populate ui.overlayKeyHandlers on mount
  // (see UiStore.registerOverlayKeyHandler / PickerView).
  const overlayKeyHandlers = ui.overlayKeyHandlers;

  function onKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // A modal dialog (alert/confirm/prompt) traps the keyboard: Escape cancels,
    // Enter confirms (alert/confirm), and every other key is swallowed so it
    // can't leak to the overlay or builder behind it. For a prompt, let typing +
    // the input's own Enter/Escape handler through (bail without swallowing).
    if (dialogs.current) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dialogs.resolve(false);
        return;
      }
      if (dialogs.current.kind === 'prompt') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        dialogs.resolve(true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // While the picker's in-place builder is open it owns the ENTIRE keymap
    // (insert/edit/undo/Escape-deselect/Escape-back). The BuilderView has its
    // own window keydown handler; the App must stay completely out of the way —
    // do NOT route to the picker handler, do NOT preventDefault, and CRUCIALLY
    // do NOT close the overlay on Escape. Bailing here (without preventDefault)
    // lets the BuilderView's handler run with e.defaultPrevented still false.
    if (ui.pickerBuilderMode) return;

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
    // suppresses everything (no handler).
    if (ui.activeOverlay !== 'none') {
      const handler = overlayKeyHandlers[ui.activeOverlay];
      if (handler && handler(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Global HUD hotkeys — only with no overlay open and not typing in a field.
    if (isEditableTarget(e.target)) return;
    if (!ctx) return;
    const vm = ctx.store.vm;

    // Space → start / pause / resume (only when a workout is selected). Use
    // e.code so it's layout-independent.
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
      void openPicker();
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      openPlanner();
    }
  }

  // Guard the picker/save flows on a configured VeloDrive folder: no folder →
  // warn + open Settings to the folders help section, and do NOT proceed.
  async function ensureRootDirConfigured(): Promise<boolean> {
    if (!ctx) return false;
    let hasRoot = false;
    try {
      hasRoot = !!(await ctx.fileStore.loadRootDirHandle());
    } catch {
      hasRoot = false;
    }
    if (hasRoot) return true;
    await dialogs.alert('Choose a VeloDrive folder first, then pick a workout.');
    ui.forceHelpSection = 'settingsFoldersHelp';
    ui.open('settings');
    return false;
  }

  // Open the workout picker, guarding against an active workout AND requiring a
  // configured folder.
  async function openPicker(): Promise<void> {
    if (!ctx) return;
    const vm = ctx.store.vm;
    if (vm?.workoutRunning || vm?.workoutPaused || vm?.workoutStarting) return;
    if (!(await ensureRootDirConfigured())) return;
    ui.open('picker');
  }

  // Open the planner (calendar), guarded against an active workout.
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
    fileStore={ctx.fileStore}
    onOpenSettings={() => ui.open('settings')}
    onOpenPicker={openPicker}
    onOpenPlanner={openPlanner}
    activeOverlay={ui.activeOverlay}
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
