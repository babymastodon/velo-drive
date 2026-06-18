<script lang="ts">
  // SettingsView — faithful re-host of the legacy #settingsOverlay/#settingsModal
  // (docs/index.html ~894-1288 + docs/settings.js behavior). Same classes + IDs
  // so the re-hosted settings.css applies unchanged; data-testids added for
  // behavior assertions. FTP (input + ±10 clamp 50-500, persists via FileStore +
  // engine.setFtp), sound, theme (auto/light/dark — re-applies <html> classes +
  // persists), folder/env/compat (same DOM; FSA parts stubbed via the port),
  // logs sub-view.
  import OverlayModal from './OverlayModal.svelte';
  import type { WorkoutEngine } from '../core/engine.js';
  import type { WebFileStore } from '../ports/web/WebFileStore.js';
  import type { Beeper } from '../core/beeper.js';
  import type { UiStore } from '../state/ui.svelte.js';
  import type { EngineStore } from '../state/engine.svelte.js';
  import { DEFAULT_FTP } from '../core/metrics.js';
  import { saveAndApplyThemeMode, loadThemeMode, type ThemeMode } from '../app/theme.js';

  let {
    store,
    engine,
    fileStore,
    beeper,
    ui,
    open = false,
  }: {
    store: EngineStore;
    engine: WorkoutEngine;
    fileStore: WebFileStore;
    beeper: Beeper;
    ui: UiStore;
    open?: boolean;
  } = $props();

  // ---- FTP ----
  const engineFtp = $derived(store.vm?.currentFtp ?? DEFAULT_FTP);
  // Local editable value, seeded from the engine and re-synced when opened.
  let ftpValue = $state<number>(DEFAULT_FTP);

  $effect(() => {
    if (open) ftpValue = engineFtp;
  });

  function normaliseFtp(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 250;
    return Math.min(500, Math.max(50, Math.round(n)));
  }

  function applyFtp(next: number): void {
    if (next === store.vm?.currentFtp) {
      ftpValue = next;
      return;
    }
    engine.setFtp(next);
    ftpValue = next;
    void fileStore.putSetting('ftp', next);
  }

  function onFtpDelta(delta: number): void {
    applyFtp(normaliseFtp(ftpValue + delta));
  }
  function onFtpCommit(): void {
    applyFtp(normaliseFtp(ftpValue));
  }
  function onFtpKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      onFtpCommit();
      (e.target as HTMLInputElement).blur();
    }
  }

  // ---- Sound ----
  let soundEnabled = $state(false);
  $effect(() => {
    if (open) {
      void fileStore.getSetting<boolean>('soundEnabled', true).then((v) => {
        soundEnabled = !!v;
      });
    }
  });
  function onSoundChange(e: Event): void {
    const enabled = (e.target as HTMLInputElement).checked;
    soundEnabled = enabled;
    beeper.setEnabled(enabled);
    void fileStore.putSetting('soundEnabled', enabled);
  }

  // ---- Theme ----
  let themeMode = $state<ThemeMode>('auto');
  $effect(() => {
    if (open) void loadThemeMode(fileStore).then((m) => (themeMode = m));
  });
  function onThemeClick(mode: ThemeMode): void {
    themeMode = mode;
    void saveAndApplyThemeMode(fileStore, mode);
  }

  // ---- Root directory ----
  let rootDirName = $state<string | null>(null);
  let rootDirLoaded = $state(false);
  $effect(() => {
    if (open) {
      rootDirLoaded = false;
      void fileStore
        .loadRootDirHandle()
        .then((h) => {
          rootDirName = h?.name ?? null;
          rootDirLoaded = true;
        })
        .catch(() => {
          rootDirName = null;
          rootDirLoaded = true;
        });
    }
  });
  async function onChooseRootDir(): Promise<void> {
    const handle = await fileStore.pickRootDir();
    if (handle) rootDirName = handle.name ?? 'Selected folder';
  }

  // ---- Environment / compatibility (stubbed detection; same DOM) ----
  function isWebBluetoothAvailable(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!(navigator as Navigator & { bluetooth?: { getDevices?: unknown } }).bluetooth &&
      typeof (navigator as Navigator & { bluetooth?: { getDevices?: unknown } }).bluetooth
        ?.getDevices === 'function'
    );
  }
  function isRunningAsPwa(): boolean {
    try {
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch {
      return false;
    }
  }
  const btAvailable = $derived(isWebBluetoothAvailable());
  const pwaInstalled = $derived(isRunningAsPwa());

  // ---- Help toggles ----
  let helpOpen = $state<Record<string, boolean>>({});
  function toggleHelp(id: string): void {
    helpOpen = { ...helpOpen, [id]: !helpOpen[id] };
  }

  // ---- Logs sub-view ----
  function openLogs(): void {
    ui.settingsLogsOpen = true;
  }
  function backFromLogs(): void {
    ui.settingsLogsOpen = false;
  }
</script>

<OverlayModal
  overlayClass="settings-overlay"
  overlayId="settingsOverlay"
  ariaLabel="Settings"
  {open}
  onClose={() => ui.close()}
>
  <div
    id="settingsModal"
    class="settings-modal"
    class:logs-active={ui.settingsLogsOpen}
    tabindex="-1"
    data-testid="settings-modal"
  >
    <header class="settings-header">
      <div class="settings-header-actions">
        <button
          id="settingsBackFromLogsBtn"
          class="settings-button"
          type="button"
          data-testid="settings-back-from-logs"
          style="display: {ui.settingsLogsOpen ? 'inline-flex' : 'none'}"
          onclick={backFromLogs}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            style="width: 18px; height: 18px; display: block; stroke-width: 1.8;"
          >
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Back to settings</span>
        </button>
      </div>

      <div class="settings-header-main">
        <div id="settingsTitle" class="settings-title" data-testid="settings-title">
          {ui.settingsLogsOpen ? 'Connection logs' : 'Settings'}
        </div>
      </div>

      <div class="settings-header-actions">
        <button
          id="settingsCloseBtn"
          class="settings-close-btn"
          title="Close settings"
          data-testid="settings-close"
          onclick={() => ui.close()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>

    <div class="settings-body">
      <!-- Main settings view -->
      <div
        id="settingsMainView"
        class="settings-main-view"
        style="display: {ui.settingsLogsOpen ? 'none' : ''}"
      >
        <div
          id="settingsCompatibilityAlert"
          class="settings-alert settings-alert-warning"
          hidden
        >
          <div id="settingsCompatibilityText"></div>
        </div>

        <div class="settings-list">
          <!-- VeloDrive folder -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h6l2 2h8v12H4z" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">
                  VeloDrive folder
                  <button
                    class="settings-help-toggle-btn"
                    type="button"
                    onclick={() => toggleHelp('settingsFoldersHelp')}
                  >
                    Help
                  </button>
                </div>
                <div class="settings-row-description">
                  Workouts, history, and trash live in one folder you pick.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <div class="settings-inline-group">
                <div
                  class="settings-row-status"
                  id="rootDirStatus"
                  data-testid="root-dir-status"
                  class:settings-status-ok={rootDirLoaded && !!rootDirName}
                  class:settings-status-missing={rootDirLoaded && !rootDirName}
                >
                  {rootDirLoaded ? (rootDirName ?? 'Not configured') : ''}
                </div>
                <button
                  id="rootDirButton"
                  class="settings-button"
                  type="button"
                  data-testid="root-dir-button"
                  onclick={onChooseRootDir}
                >
                  Choose…
                </button>
              </div>
            </div>
          </div>

          <div
            id="settingsFoldersHelp"
            class="settings-help-content"
            class:settings-help-content--visible={helpOpen.settingsFoldersHelp}
            hidden={!helpOpen.settingsFoldersHelp}
          >
            Pick a home base for VeloDrive (for example
            <code>~/Dropbox/VeloDrive</code>). We’ll use that one spot to store
            everything and you can reselect it later if you move devices.
          </div>

          <!-- FTP -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 21L5 13h4V3l8 8h-4v10z" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">
                  FTP
                  <button
                    class="settings-help-toggle-btn"
                    type="button"
                    onclick={() => toggleHelp('settingsFtpHelp')}
                  >
                    What’s this?
                  </button>
                </div>
                <div class="settings-row-description">
                  Tweak difficulty if workouts feel too easy or hard.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <div id="settingsFtpControls" class="control-group">
                <button
                  class="control-btn"
                  type="button"
                  data-ftp-delta="-10"
                  data-testid="ftp-minus"
                  onclick={() => onFtpDelta(-10)}
                >
                  -
                </button>
                <div class="control-value">
                  <input
                    id="settingsFtpInput"
                    class="settings-ftp-input"
                    type="number"
                    min="50"
                    max="500"
                    step="1"
                    inputmode="numeric"
                    data-testid="ftp-input"
                    bind:value={ftpValue}
                    onkeydown={onFtpKeydown}
                    onblur={onFtpCommit}
                  />
                  <span class="settings-ftp-unit">W</span>
                </div>
                <button
                  class="control-btn"
                  type="button"
                  data-ftp-delta="10"
                  data-testid="ftp-plus"
                  onclick={() => onFtpDelta(10)}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div
            id="settingsFtpHelp"
            class="settings-help-content"
            class:settings-help-content--visible={helpOpen.settingsFtpHelp}
            hidden={!helpOpen.settingsFtpHelp}
          >
            FTP is the power you can hold for about an hour. If you do not know
            it, multiply your weight in kg by 3 for a quick starting point.
          </div>

          <!-- Sound -->
          <div class="settings-row" id="settingsSoundToggle">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 10v4h3l4 4V6l-4 4H5z" />
                  <path d="M15 9.5c1 .7 1.6 1.9 1.6 3.1 0 1.2-.6 2.4-1.6 3.1" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">
                  Sounds
                  <button
                    class="settings-help-toggle-btn"
                    type="button"
                    onclick={() => toggleHelp('settingsSoundHelp')}
                  >
                    What will I hear?
                  </button>
                </div>
                <div class="settings-row-description">
                  Interval beeps and the start countdown.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <label class="settings-toggle-switch">
                <input
                  id="settingsSoundCheckbox"
                  type="checkbox"
                  data-testid="sound-checkbox"
                  checked={soundEnabled}
                  onchange={onSoundChange}
                />
                <span class="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div
            id="settingsSoundHelp"
            class="settings-help-content"
            class:settings-help-content--visible={helpOpen.settingsSoundHelp}
            hidden={!helpOpen.settingsSoundHelp}
          >
            A short beep before interval changes, a stronger cue before big
            efforts, and a quick countdown when you hit start.
          </div>

          <!-- Theme -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2.5v2" />
                  <path d="M12 19.5v2" />
                  <path d="M4.5 12h-2" />
                  <path d="M21.5 12h-2" />
                  <path d="m5.6 5.6-1.4-1.4" />
                  <path d="m19.8 19.8-1.4-1.4" />
                  <path d="m5.6 18.4-1.4 1.4" />
                  <path d="m19.8 4.2-1.4 1.4" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">Theme</div>
                <div class="settings-row-description">
                  Choose light, dark, or follow your system.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <div
                id="settingsThemeToggle"
                class="mode-toggle"
                role="group"
                aria-label="Theme"
              >
                <button
                  class="mode-toggle-button"
                  class:active={themeMode === 'auto'}
                  aria-pressed={themeMode === 'auto'}
                  type="button"
                  data-theme-mode="auto"
                  data-testid="theme-auto"
                  onclick={() => onThemeClick('auto')}
                >
                  Auto
                </button>
                <button
                  class="mode-toggle-button"
                  class:active={themeMode === 'dark'}
                  aria-pressed={themeMode === 'dark'}
                  type="button"
                  data-theme-mode="dark"
                  data-testid="theme-dark"
                  onclick={() => onThemeClick('dark')}
                >
                  Dark
                </button>
                <button
                  class="mode-toggle-button"
                  class:active={themeMode === 'light'}
                  aria-pressed={themeMode === 'light'}
                  type="button"
                  data-theme-mode="light"
                  data-testid="theme-light"
                  onclick={() => onThemeClick('light')}
                >
                  Light
                </button>
              </div>
            </div>
          </div>

          <!-- Bluetooth -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v18l5-5-3.5-4L17 8l-5-5z" />
                  <path d="M7 8l5 4-5 4" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">
                  Bluetooth
                  <button
                    class="settings-help-toggle-btn"
                    type="button"
                    onclick={() => toggleHelp('settingsEnvHelp')}
                  >
                    Details
                  </button>
                </div>
                <div class="settings-row-description">
                  Web Bluetooth support for trainer and HR pairing.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <div
                id="settingsBtStatusText"
                class="settings-row-status"
                class:settings-status-ok={btAvailable}
                class:settings-status-missing={!btAvailable}
              >
                {btAvailable ? 'Web Bluetooth available.' : 'Web Bluetooth not detected.'}
              </div>
            </div>
          </div>

          <div
            id="settingsEnvHelp"
            class="settings-help-content"
            class:settings-help-content--visible={helpOpen.settingsEnvHelp}
            hidden={!helpOpen.settingsEnvHelp}
          >
            Web Bluetooth is supported only in Google Chrome. If devices will
            not show up, copy/paste these URLs into Chrome's address bar, set
            them to <b>Enabled</b>, restart, and try again:
            <ul style="margin: 6px 0 0 18px; padding-left: 0">
              <li><code>chrome://flags/#enable-web-bluetooth</code></li>
              <li>
                <code>chrome://flags/#enable-web-bluetooth-new-permissions-backend</code>
              </li>
            </ul>
          </div>

          <!-- Offline / PWA -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9.453 20.134h5.253M12.428 4.786H3.234v12.815h17.511v-3.343M20.586 9.244l-3.104 3.104-3.104-3.104m3.104-4.298v7.403"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">
                  Offline Mode (PWA)
                  <button
                    class="settings-help-toggle-btn"
                    type="button"
                    onclick={() => toggleHelp('settingsPwaHelp')}
                  >
                    How do I install it?
                  </button>
                </div>
                <div class="settings-row-description">
                  Install the Progressive Web App for offline workouts.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <div
                id="settingsPwaStatusText"
                class="settings-row-status"
                class:settings-status-ok={pwaInstalled}
                class:settings-status-missing={!pwaInstalled}
              >
                {pwaInstalled ? 'Installed (offline-ready).' : 'Not installed yet.'}
              </div>
            </div>
          </div>

          <div
            id="settingsPwaHelp"
            class="settings-help-content"
            class:settings-help-content--visible={helpOpen.settingsPwaHelp}
            hidden={!helpOpen.settingsPwaHelp}
          >
            In Chrome on desktop, click the install icon in the address bar on
            the right side → <strong>Install VeloDrive</strong>. On Android, open
            Chrome’s menu and select <strong>Add to Home screen</strong>. If
            you’re using the Chrome extension, you’re already set.
          </div>

          <!-- Connection logs -->
          <div class="settings-row">
            <div class="settings-row-main">
              <div class="settings-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5h14M5 9h10M5 13h14M5 17h8" />
                </svg>
              </div>
              <div class="settings-row-text">
                <div class="settings-row-label">Connection logs</div>
                <div class="settings-row-description">
                  Live Bluetooth and device messages.
                </div>
              </div>
            </div>
            <div class="settings-row-right">
              <button
                id="settingsOpenLogsBtn"
                class="settings-button"
                type="button"
                data-testid="settings-open-logs"
                onclick={openLogs}
              >
                View logs
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs view -->
      <div
        id="settingsLogsView"
        class="settings-logs-view"
        style="display: {ui.settingsLogsOpen ? 'flex' : 'none'}"
      >
        <div id="settingsLogsContent" class="settings-logs-body" data-testid="settings-logs-content"></div>
      </div>
    </div>
  </div>
</OverlayModal>
