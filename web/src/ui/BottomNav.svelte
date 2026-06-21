<script lang="ts">
  import type { EngineViewModel, WorkoutEngine } from '../core/engine.js';
  import type { WebBluetoothTransport } from '../ports/web/WebBluetoothTransport.js';
  import type { DialogStore } from '../state/dialog.svelte.js';
  import { DEFAULT_FTP } from '../core/metrics.js';
  import { CadenceCoach, computeCoachingTitle } from './hud-coaching.js';
  import { isWebBluetoothAvailable } from '../app/compat.js';

  let {
    vm,
    engine,
    transport,
    dialogs,
    bikeStatus,
    hrStatus,
    bikeStatusMessage = '',
    hrStatusMessage = '',
    hrBatteryPercent,
    onOpenSettings,
    onOpenPicker,
    onOpenPlanner,
    activeOverlay = 'none',
  }: {
    vm: EngineViewModel;
    engine: WorkoutEngine;
    transport: WebBluetoothTransport;
    dialogs: DialogStore;
    bikeStatus: 'connecting' | 'connected' | 'error' | 'idle';
    hrStatus: 'connecting' | 'connected' | 'error' | 'idle';
    bikeStatusMessage?: string;
    hrStatusMessage?: string;
    hrBatteryPercent: number | null;
    onOpenSettings?: () => void;
    onOpenPicker?: () => void;
    onOpenPlanner?: () => void;
    activeOverlay?: string;
  } = $props();

  const workoutActive = $derived(vm.workoutRunning || vm.workoutPaused || vm.workoutStarting);
  const freeRideUiActive = $derived(workoutActive && vm.isFreeRideActive);

  // Playback button visibility.
  const showCalendar = $derived(!workoutActive);
  const showStart = $derived(!vm.workoutRunning && !!vm.canonicalWorkout);
  const showStop = $derived(vm.workoutRunning);
  const showPlay = $derived(vm.workoutRunning && vm.workoutPaused);
  const showPause = $derived(vm.workoutRunning && !vm.workoutPaused);

  // Workout title center (shown while running/starting).
  const showTitleCenter = $derived(vm.workoutRunning || vm.workoutStarting);

  // Live coaching title: per-segment instruction ("Maintain N watts for D at C
  // RPM" / "Ramp up/down to N watts" / "Free ride at N watts"), the "In N - "
  // lookahead, and "Speed up/Slow down" cadence coaching. The CadenceCoach
  // accrues off-cadence seconds across renders, so it persists outside the
  // $derived.
  const coach = new CadenceCoach();
  const coaching = $derived(computeCoachingTitle(vm, coach));
  // Plain string for the title= tooltip / the simple-text branch.
  const titleText = $derived(
    coaching.text ?? (coaching.parts ?? []).map((p) => p.text).join(''),
  );
  const nameLabelText = $derived(
    vm.canonicalWorkout
      ? vm.canonicalWorkout.workoutTitle || 'Selected workout'
      : 'Click here to select a workout',
  );

  const dotClass = (s: string) =>
    s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : s === 'error' ? 'error' : '';

  function onStartLike(): void {
    engine.startWorkout();
  }
  // Stop must confirm before ending + saving.
  async function onStop(): Promise<void> {
    const sure = await dialogs.confirm('End current workout and save it?');
    if (!sure) return;
    await engine.endWorkout();
  }
  // Warn + open Settings when Web Bluetooth is unavailable. When available, the
  // picker connect runs; a user cancel/failure is handled inside the transport
  // (status → idle/error).
  async function ensureBluetooth(): Promise<boolean> {
    if (isWebBluetoothAvailable()) return true;
    await dialogs.alert(
      "Your browser doesn't support Bluetooth. Let's open Settings for options.",
    );
    onOpenSettings?.();
    return false;
  }
  async function onConnectBike(): Promise<void> {
    if (!(await ensureBluetooth())) return;
    transport.connectBikeViaPicker().catch(() => {});
  }
  async function onConnectHr(): Promise<void> {
    if (!(await ensureBluetooth())) return;
    transport.connectHrViaPicker().catch(() => {});
  }
  function onSetMode(m: 'erg' | 'resistance'): void {
    engine.setFreeRideMode(m);
  }
  function onManualDelta(delta: number): void {
    if (vm.freeRideMode === 'erg') engine.adjustManualErg(delta);
    else engine.adjustManualResistance(delta);
  }

  const manualValue = $derived(
    vm.freeRideMode === 'erg' ? vm.manualErgTarget || 0 : vm.manualResistance || 0,
  );
  const manualUnit = $derived(vm.freeRideMode === 'erg' ? 'W' : '%');

  // Manual input commit. Parse the typed value, clamp it (ERG: [50, ftp*2.5];
  // resistance [0,100]), and push the diff to the engine. Reverts the input to
  // the current value if unchanged (the engine is the source of truth for the
  // displayed number).
  function normaliseErg(raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return vm.manualErgTarget || vm.currentFtp || DEFAULT_FTP;
    const ftp = vm.currentFtp || DEFAULT_FTP;
    return Math.min(ftp * 2.5, Math.max(50, Math.round(n)));
  }
  function normaliseResistance(raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return vm.manualResistance || 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  function commitManualInput(el: HTMLInputElement): void {
    const active = vm.workoutRunning || vm.workoutPaused || vm.workoutStarting;
    if (!active || !vm.isFreeRideActive) return;
    const raw = el.value.trim();
    if (vm.freeRideMode === 'erg') {
      const next = normaliseErg(raw);
      const current = vm.manualErgTarget || 0;
      const delta = next - current;
      if (delta) engine.adjustManualErg(delta);
      else el.value = String(current);
    } else {
      const next = normaliseResistance(raw);
      const current = vm.manualResistance || 0;
      const delta = next - current;
      if (delta) engine.adjustManualResistance(delta);
      else el.value = String(current);
    }
  }
  function onManualKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      const el = e.currentTarget as HTMLInputElement;
      commitManualInput(el);
      el.blur();
    }
  }
  function onManualBlur(e: FocusEvent): void {
    commitManualInput(e.currentTarget as HTMLInputElement);
  }

  // Sync the displayed value from the engine, but never overwrite while the
  // user is typing.
  let manualInputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    const v = manualValue; // track
    const el = manualInputEl;
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = String(v);
  });
</script>

<nav class="bottom-nav">
  <div class="nav-left">
    <button
      class="device-group"
      id="bikeConnectBtn"
      data-testid="bike-connect"
      title={bikeStatusMessage}
      onclick={onConnectBike}
    >
      <div class="icon-box">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 16.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0 0 3-6h4l3 6m-4-6 1.5-3M16 7h-3m7 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
          />
        </svg>
        <div id="bikeStatusDot" data-testid="bike-status-dot" class="status-dot {dotClass(bikeStatus)}"></div>
      </div>
      <div class="device-label"><span>Bike</span></div>
    </button>

    <button
      class="device-group"
      id="hrConnectBtn"
      data-testid="hr-connect"
      title={hrStatusMessage}
      onclick={onConnectHr}
    >
      <div class="icon-box">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 20s-4.5-2.9-7-6.1C3.2 12.1 3 10.8 3 9.9 3 7.8 4.7 6 6.9 6c1.3 0 2.6.6 3.4 1.8C11.5 6.6 12.8 6 14.1 6 16.3 6 18 7.8 18 9.9c0 .9-.2 2.2-2 4-2.5 3.2-7 6.1-7 6.1z"
          />
        </svg>
        <div id="hrStatusDot" data-testid="hr-status-dot" class="status-dot {dotClass(hrStatus)}"></div>
      </div>
      <div class="device-label">
        <span>HRM</span>
        <span
          id="hrBatteryLabel"
          data-testid="hr-battery-label"
          class="device-battery"
          class:battery-low={hrBatteryPercent != null && hrBatteryPercent <= 20}
          >{hrBatteryPercent != null ? `${hrBatteryPercent}%` : ''}</span
        >
      </div>
    </button>

    <button
      id="settingsBtn"
      data-testid="settings-btn"
      class="nav-icon-button"
      class:active={activeOverlay === 'settings'}
      title="Settings (S)"
      onclick={() => onOpenSettings?.()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.007 7.007 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.5 2h-4a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L3.1 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.65-.06.94 0 .32.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.24l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h4c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.1.54 0 .68-.24l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
        />
      </svg>
    </button>

    <button
      id="calendarBtn"
      data-testid="calendar-btn"
      class="playback-button calendar-button"
      class:visible={showCalendar}
      class:active={activeOverlay === 'planner'}
      title="Open calendar (C)"
      onclick={() => onOpenPlanner?.()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M 7,3 V 6 M 17,3 v 3" />
        <rect x="4" y="6" width="16" height="14" rx="2" />
        <path d="M 4,10 H 20" />
      </svg>
    </button>
  </div>

  <div class="workout-title-wrapper">
    <div
      id="workoutTitleCenter"
      data-testid="workout-title-center"
      class="workout-title-center"
      style="display: {showTitleCenter ? 'block' : 'none'}"
      title={titleText}
    >
      {#if coaching.parts}{#each coaching.parts as part}{#if part.strong}<strong
            >{part.text}</strong
          >{:else}{part.text}{/if}{/each}{:else}{coaching.text}{/if}
    </div>
  </div>

  <div class="nav-right">
    <div id="workoutControls" class="workout-controls">
      <div
        id="modeToggle"
        data-testid="mode-toggle"
        class="mode-toggle"
        title="Free ride control mode"
        style="display: {freeRideUiActive ? 'inline-flex' : 'none'}"
      >
        <button
          class="mode-toggle-button"
          class:active={vm.freeRideMode === 'erg'}
          data-mode="erg"
          title="Change to ERG (E)"
          onclick={() => onSetMode('erg')}>ERG</button
        >
        <button
          class="mode-toggle-button"
          class:active={vm.freeRideMode === 'resistance'}
          data-mode="resistance"
          title="Change to resistance (R)"
          onclick={() => onSetMode('resistance')}>Resistance</button
        >
      </div>

      <div
        id="manualControls"
        data-testid="manual-controls"
        class="control-group"
        style="display: {freeRideUiActive ? 'inline-flex' : 'none'}"
      >
        <button class="control-btn" data-delta="-10" onclick={() => onManualDelta(-10)}>-</button>
        <div class="control-value">
          <input
            id="manualInput"
            data-testid="manual-input"
            class="settings-ftp-input"
            type="number"
            inputmode="numeric"
            bind:this={manualInputEl}
            onkeydown={onManualKeydown}
            onblur={onManualBlur}
          />
          <span id="manualUnit" class="settings-ftp-unit">{manualUnit}</span>
        </div>
        <button class="control-btn" data-delta="10" onclick={() => onManualDelta(10)}>+</button>
      </div>

      <div
        id="workoutNameLabel"
        data-testid="workout-name-label"
        class="inline-clicktoggle"
        data-clickable="true"
        title="Select a workout (W)"
        role="button"
        tabindex="0"
        style="display: {freeRideUiActive ? 'none' : showTitleCenter ? 'none' : 'flex'}"
        onclick={() => onOpenPicker?.()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPicker?.(); } }}
      >
        {nameLabelText}
      </div>

      <button
        id="startBtn"
        data-testid="start-btn"
        class="playback-button"
        class:visible={showStart}
        title="Start workout (Space)"
        onclick={onStartLike}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10l8-5z" /></svg>
      </button>

      <button
        id="playBtn"
        data-testid="play-btn"
        class="playback-button"
        class:visible={showPlay}
        title="Resume workout"
        onclick={onStartLike}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10l8-5z" /></svg>
      </button>

      <button
        id="pauseBtn"
        data-testid="pause-btn"
        class="playback-button"
        class:visible={showPause}
        title="Pause workout"
        onclick={onStartLike}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10M15 7v10" /></svg>
      </button>

      <button
        id="stopBtn"
        data-testid="stop-btn"
        class="playback-button"
        class:visible={showStop}
        title="End workout"
        onclick={onStop}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="8" height="8" /></svg>
      </button>
    </div>
  </div>
</nav>
