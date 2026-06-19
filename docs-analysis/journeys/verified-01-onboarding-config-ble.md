# Verified — Onboarding/Welcome, Config/Settings, Hardware/BLE

Read-only verification pass against the new rewrite in `web/src` vs the legacy
PWA in `docs/`. Status legend: **OK** (faithful) / **PARTIAL** (present but
diverges) / **GAP** (missing) / **WRONG** (present but incorrect).

Paths are relative to `/home/babymastodon/code/velo-drive/`.

---

## Onboarding / Welcome

| ID | Journey / interaction / state | Legacy code (file:line) | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|---|
| J-WEL-01 | First-run full 4-slide welcome tour | welcome.js:4-41,415,639; workout.js:1223 | web/src/ui/WelcomeView.svelte:21-58; ui/App.svelte:83-114 | OK | 4 slides (splash/trainers/offline/workouts). Boot-gating in App.maybeShowWelcome: full tour when !PWA or missing root. |
| J-WEL-02 | `shouldForceFullWelcome()` decision (root-dir + PWA) | workout.js:184-207,152-182 | ui/App.svelte:95-102 | OK | `forceFullWelcome = !runningAsPwa \|\| missingRootDir`; reproduced verbatim. |
| J-WEL-03 | PWA + configured → 1.1s splash only (`playSplash`) | welcome.js:778-780; workout.js:1272 | ui/App.svelte:112 (openWelcome('splash')); WelcomeView.svelte:60,158-172 | **PARTIAL** | Splash mode renders and swallows nav keys, BUT there is **no auto-close timer**. Legacy `playSplash(1100)` auto-closes after 1100ms; the new splash stays open until the user dismisses it. |
| J-WEL-04 | Welcome skipped entirely if a workout is active | welcome.js; workout.js:1223 | ui/App.svelte:92-93 | OK | Skips on `workoutRunning/Paused/Starting`. |
| J-WEL-05 | `body.welcome-active` hides content pre-tour | workout.js:135 | ui/App.svelte:148-150 | OK | `document.body.classList.toggle('welcome-active', welcomeActive)`. |
| J-WEL-06 | Welcome nav: Prev/Next/Close buttons | welcome.js:752-771 | WelcomeView.svelte:104-119,244-271 | OK | Next on last slide closes (goNext). |
| J-WEL-07 | Welcome click-anywhere-to-advance | welcome.js:686-704,750 | WelcomeView.svelte:139-147 | OK | Full mode only; ignored on splash and on nav/close controls. |
| J-WEL-08 | Welcome keys →/PageDown next, ←/PageUp prev | welcome.js:729-738 | WelcomeView.svelte:173-180 | OK | Full mode; swallowed on splash (158-172). |
| J-WEL-09 | Welcome Space/Enter advance | welcome.js:739-747 | WelcomeView.svelte:181-184 | OK | Legacy guards focus==overlay/body; the new welcome has no focusable inputs so the guard is moot — same visible behavior. |
| J-WEL-10 | Welcome Escape closes | welcome.js:706-748 | WelcomeView.svelte:154-157; App.svelte:184-191 | OK | Welcome handler returns true for Escape; App preventDefault+stopPropagation. |
| J-WEL-11 | Modifier guard — keys ignored with meta/ctrl/alt | welcome.js:708 | ui/App.svelte:168 | OK | App.onKeydown returns early on meta/ctrl/alt before routing to the welcome handler. |
| J-WEL-12 | Welcome tour absent (no overlay) → disabled, continues | workout.js:1225-1227 | n/a (WelcomeView always present) | OK | N/A in the rewrite (component always mounted); no crash path. |
| J-WEL-13 | Welcome illustration SVGs low-contrast in dark | img/*.svg; welcome.css | ui/welcome-scene.ts | n/a (dark-mode area) | Dark-mode contrast deferred to the Dark-mode section (out of scope here). |

---

## Config / Settings

| ID | Journey / interaction / state | Legacy code (file:line) | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|---|
| J-CFG-01 | Settings auto-open on startup attention | settings.js:629-672,650-655 | ui/App.svelte:128-144 | OK | Opens settings when missing root OR missing BT OR incompatible. |
| J-CFG-02 | Auto-expand relevant help section on auto-open | settings.js:484-525,650-664 | ui/App.svelte:141-142; SettingsView.svelte:149-155 | **PARTIAL** | Uses `if/else if`, forcing only ONE help section (folders takes priority). Legacy `showHelpSectionById` opens folder help AND BT help when both are missing. |
| J-CFG-03 | Open settings (gear / `S`) | settings.js:188,530-534; workout.js:1731 | BottomNav.svelte:201-214; App.svelte:250-254 | OK | Gear button + `s` key. |
| J-CFG-04 | Close settings | settings.js:536-540 | SettingsView.svelte:236-248 | OK | |
| J-CFG-05 | Settings click-outside backdrop closes | settings.js:542-554 | ui/OverlayModal.svelte:28-35 | OK | pointerdown+up both on backdrop, left button only. Faithful. |
| J-CFG-06 | Settings Escape: logs→main, else close | settings.js:613-624 | state/ui.svelte.ts:93-109; App.svelte:179-197 | OK | settingsLogsOpen → main view first, else close. |
| J-CFG-07 | Help/"What's this?" toggles per row | settings.js:501-525 | SettingsView.svelte:142-145 | OK | Per-row toggleHelp. |
| J-CFG-08 | View logs button → logs view; Back-from-logs | settings.js:556-566 | SettingsView.svelte:178-186 | OK | |
| J-CFG-09 | Configure FTP — Enter/blur commit, clamp 50–500 | settings.js:333-384; storage.js:358-360 | SettingsView.svelte:48-76 | OK | normaliseFtp clamps [50,500]; commit on Enter+blur. |
| J-CFG-10 | FTP +10/−10 delta (base = currently-typed value) | settings.js:367-384,589-597 | SettingsView.svelte:64-66 | OK | `onFtpDelta` uses live `ftpValue`. |
| J-CFG-11 | Theme Auto/Dark/Light toggle | settings.js:456-479; theme.js:6-33 | SettingsView.svelte:95-102; app/theme.ts:22-56 | OK | saveAndApplyThemeMode → localStorage + IDB + html classes. |
| J-CFG-12 | Anti-FOUC theme init (inline, pre-paint) | theme-init.js:1-15 | web/index.html:13-17 | OK | Inline script reads localStorage('themeMode') and toggles classes before paint. |
| J-CFG-13 | Auto theme re-renders on OS `prefers-color-scheme` change | workout.js:1402-1415 | state/theme.svelte.ts:24-33; ui/LiveChart.svelte:77 | **WRONG** | Theme reactivity is driven ONLY by a `<html>` class/data-theme MutationObserver. In **Auto** mode an OS scheme flip does NOT change the html class, so `themeVersion` never bumps and the chart keeps **stale colors**. Legacy added a dedicated `matchMedia('(prefers-color-scheme: dark)')` change listener → `rerenderThemeSensitive()` for exactly this case; it is missing. |
| J-CFG-14 | Theme localStorage failure → fallback to IDB/auto | storage.js:338-339,352-353 | app/theme.ts:34-44 | OK | try/catch around localStorage, falls back to store.getSetting. |
| J-CFG-15 | Sound toggle (checkbox, default ON) | settings.js:388-400; beeper.js:9,75-78 | SettingsView.svelte:79-92; app/app.ts:59-60 | **PARTIAL** | Settings checkbox defaults ON (getSetting('soundEnabled', **true**)), but boot wiring reads getSetting('soundEnabled', **false**) and calls beeper.setEnabled(false). On a fresh install the new app boots **muted** (legacy boots audible, beeper `enabled=true` + loadSoundPreference(true)), and the toggle UI shows ON while audio is actually off until toggled. Default mismatch. |
| J-CFG-16 | Choose root folder (FSA) | settings.js:303-316; storage.js:497-540 | SettingsView.svelte:122-125; WebFileStore.ts:223-264 | OK | showDirectoryPicker + ensureDirPermission + create 3 subdirs. |
| J-CFG-17 | Seed 6 default `.zwo` into empty `workouts/` | storage.js:446-487 | WebFileStore.ts:223-264 (absent) | **GAP** | `pickRootDir` creates the subdirs but never seeds the default workouts. Legacy `maybeSeedDefaultWorkouts`→`copyDefaultWorkoutsToDir` fetches 6 bundled `.zwo` into an empty `workouts/`. A first-run user gets an empty library. |
| J-CFG-18 | Create `workouts/`/`history/`/`trash/` subdirs | storage.js:497-540 | WebFileStore.ts:250-255 (+284-315 derive-on-load) | OK | Created on pick and re-derived from root on later loads. |
| J-CFG-19 | Default-workout seeding per-file failure → silent | storage.js:473-478 | n/a (no seeding) | **GAP** | Moot because seeding (J-CFG-17) is absent; the silent-continue error path does not exist. |
| J-CFG-20 | Data persistence (IndexedDB `velo-drive`/`settings`) | storage.js:14-32,44-113 | WebFileStore.ts:32-217 | OK | Same DB/store name + keyed config (ftp/sound/theme/selected/state/devices/handles/statsCache). |
| J-CFG-21 | `schedule.json` persisted in root folder (file) | storage.js:217-248 | WebFileStore.ts:610-640 | OK | loadSchedule/saveSchedule read/write schedule.json in root. |
| J-CFG-22 | Bluetooth / PWA status text (display-only) | settings.js:404-452 | SettingsView.svelte:130-139,543-612 | OK | BT/PWA/compat status reflect compat.ts + display-mode; refreshed on open. |

---

## Hardware / BLE

| ID | Journey / interaction / state | Legacy code (file:line) | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|---|
| J-BLE-01 | Connect trainer (FTMS 0x1826) via picker | workout.js:1525-1544; ble-manager.js:549-561,581-767 | WebBluetoothTransport.ts:302-343,385-468 | OK | requestControl(0x00) then startOrResume(0x07) handshake (419-420). |
| J-BLE-02 | Control Point (0x2AD9) missing → fatal | ble-manager.js:439-452 | WebBluetoothTransport.ts:395,454-467 | OK | getCharacteristic(CP) throwing → catch sets error + rethrows; ERG control impossible without it. |
| J-BLE-03 | Connect HRM (Heart Rate 0x180D) via picker | workout.js:1546-1565; ble-manager.js:773-932 | WebBluetoothTransport.ts:345-381,543-615 | OK | Separate HR connect button + path. |
| J-BLE-04 | HR battery read once at connect (non-fatal) | ble-manager.js:818-847; workout.js:669-670 | WebBluetoothTransport.ts:558-573 | OK | Single readValue, try/catch non-fatal, emits hrBattery; no live notify. |
| J-BLE-05 | Auto-reconnect backoff (1s→×2→10s) + suppress-once | ble-manager.js:208-276,704-738 | WebBluetoothTransport.ts:248-300,470-498 | OK | MIN 1000 / MAX 10000, ×2; suppress-once + autoReconnectEnabled gate reproduced. |
| J-BLE-06 | Auto re-pair saved bike/HR on load (`getDevices`) | ble-manager.js:938-986 | WebBluetoothTransport.ts:177-232; engine.ts:691; app/app.ts:72,78 | OK | setSavedDeviceIds runs before engine.init→transport.init({autoReconnect}); maybeReconnectSavedDevices matches saved ids. |
| J-BLE-07 | Backoff resets on manual reconnect / fresh disconnect | ble-manager.js:728-731,1012,1037 | WebBluetoothTransport.ts:335,374,491,633 | OK | Delay reset to MIN on picker connect and on disconnect. |
| J-BLE-08 | Bike status dot idle/connecting/connected/error | workout.js:612-641 | state/engine.svelte.ts:13; BottomNav.svelte:65-66,175 | OK | dotClass maps connected/connecting/error; idle = no class (grey). |
| J-BLE-09 | Progressive connecting messages in button `title` | ble-manager.js:598-625; workout.js:627-629 | WebBluetoothTransport.ts:389,738-742 | **PARTIAL** | Only ONE connecting status ("Connecting to bike…") is emitted at the top of connectToBike. Legacy emits 4+ progressive tooltips ("…GATT server…", "…discovering FTMS service…", "…discovering characteristics…") during connection. |
| J-BLE-10 | HR status dot mirrors bike | workout.js:643-660 | BottomNav.svelte:180-187 | OK | Same dotClass; no HR chart empty-state. |
| J-BLE-11 | Battery NORMAL label "N%" | workout.js:669-670 | BottomNav.svelte:191-197 | OK | `${pct}%`. |
| J-BLE-12 | Battery LOW ≤20% → orange color-only | workout.js:670; workout-base.css:622-624 | BottomNav.svelte:195 | OK | `battery-low` class when `pct <= 20`; re-hosted CSS keeps orange. |
| J-BLE-13 | Battery UNKNOWN/none → label cleared | workout.js:664-667 | BottomNav.svelte:196 | OK | Empty string + no battery-low class when null. |
| J-BLE-14 | Bike connect — no Web Bluetooth → alert + Settings | workout.js:1531; ble-manager.js:1007 | ui/HudView/BottomNav onConnectBike → HudView.svelte:80-91 | OK | isWebBluetoothAvailable() gate → alert "Your browser doesn't support Bluetooth…" + onOpenSettings. |
| J-BLE-15 | HRM connect — no Web Bluetooth → alert + Settings | workout.js:1552; ble-manager.js:1049 | HudView.svelte:92-95,80-87 | OK | Same ensureBluetooth path. |
| J-BLE-16 | Bike picker cancel/fail → status, reconnect if connect-fail | ble-manager.js:1019-1027; workout.js:1540 | WebBluetoothTransport.ts:315-342; HudView.svelte:88-91 | OK | Cancel-with-nothing-connected → idle (grey dot); cancel-while-connected suppresses one reconnect; connect-fail → scheduleBikeAutoReconnect. Legacy's bare-string `setBikeStatus("error")` BUG (which reverted the dot to grey not red) is not reproduced, but the new visible outcome (grey dot on cancel) matches; the new code is cleaner. |
| J-BLE-17 | HR picker cancel/fail → status | workout.js:1561-1562 | WebBluetoothTransport.ts:357-380; HudView.svelte:92-95 | OK | Same as J-BLE-16 for HR (idle on cancel). |
| J-BLE-18 | Auto-reconnect skipped if `getDevices` unavailable | ble-manager.js:939 | WebBluetoothTransport.ts:178-182 | OK | Logs + returns when no getDevices. |
| J-BLE-19 | `showDirectoryPicker`/BLE picker needs user gesture | storage.js:508,534-537 | WebFileStore.ts:226-263; connect handlers in click | OK | Picker calls run inside click handlers; AbortError silent, other → alert. |

---

## Gaps & defects

| ID | Severity | Defect | Legacy ref |
|---|---|---|---|
| J-CFG-17 | **High** | `WebFileStore.pickRootDir` never seeds the 6 default `.zwo` files into an empty `workouts/`. A brand-new user finishes onboarding with an **empty workout library** (legacy seeds a starter set). | storage.js:446-487,525 |
| J-CFG-13 | **Med** | Auto-theme chart redraw on OS scheme change is broken. Theme reactivity only watches `<html>` class/data-theme mutations; in Auto mode an OS dark/light flip changes no class, so the chart keeps stale colors. Legacy installs a dedicated `matchMedia('(prefers-color-scheme: dark)')` listener. | workout.js:1402-1406 |
| J-CFG-15 | **Med** | Sound default diverges: boot reads `soundEnabled` defaulting to **false** and mutes the beeper, while the Settings checkbox defaults to **true**. Fresh installs boot muted (legacy boots audible) and the UI shows ON while audio is off. | settings.js:390; beeper.js:9; storage.js:321 |
| J-WEL-03 | **Med** | Splash welcome (PWA + configured) has no 1.1s auto-close; the splash stays up until manually dismissed. Legacy `playSplash(1100)` auto-closes. | welcome.js:778-780; workout.js:1272 |
| J-BLE-09 | **Low** | Only a single "Connecting…" status is emitted; the legacy progressive connect tooltips (GATT / discovering FTMS / discovering characteristics) are dropped. Cosmetic (tooltip text only). | ble-manager.js:598-625 |
| J-CFG-02 | **Low** | Boot auto-open forces only one help section (`if/else if`, folders-priority). Legacy opens folder help AND Bluetooth help when both conditions are missing. | settings.js:657-670 |
| J-CFG-19 | **Low** | Per-file seeding-failure silent-continue path absent — moot consequence of J-CFG-17 (no seeding at all). | storage.js:473-478 |
