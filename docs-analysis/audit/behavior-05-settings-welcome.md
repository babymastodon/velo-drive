# Behavior Audit 05 — Settings + Welcome + Theme

Legacy: `docs/settings.js` (681), `docs/welcome.js` (791), `docs/theme.js` (33), `docs/theme-init.js` (15).
New: `web/src/ui/SettingsView.svelte`, `web/src/ui/WelcomeView.svelte`, `web/src/ui/welcome-scene.ts`, `web/src/app/theme.ts`, `web/src/state/{ui,dialog}.svelte.ts`, `web/src/ui/App.svelte`, `web/src/app/app.ts`, `web/index.html`.

Method: every behavior in the four legacy files enumerated, each mapped to a new-code `file:LINE` or marked **GAP**.

## Table

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| **SETTINGS — FTP** |
| 1 | `ftpInput` keydown Enter | settings.js:576-582 | Enter → preventDefault, save, blur input | SettingsView.svelte:65-71 (`onFtpKeydown`) + 339 | OK | Identical |
| 2 | `ftpInput` blur save | settings.js:584-586 | blur → handleFtpSave | SettingsView.svelte:62-64 (`onFtpCommit`) + 340 | OK | Identical |
| 3 | `[data-ftp-delta]` ±10 buttons | settings.js:589-597, 375-384 | Parse delta attr, apply normalised base+delta | SettingsView.svelte:59-61, 322-352 | OK | Buttons hard-coded -10/+10 with matching `data-ftp-delta`; `onFtpDelta` reads `ftpValue` not engine. See note row 4 |
| 4 | `handleFtpDelta` base = parsed input or engine | settings.js:378-381 | Base from input value, falls back to engine | SettingsView.svelte:59-60 | PARTIAL | New base = `ftpValue` (local state), never falls back to engineFtp. Legacy fell back to engine when input unparseable. `ftpValue` is always a number via `bind:value`, so divergence only on NaN input — minor |
| 5 | `normaliseFtpValue` clamp 50-500, round, NaN→250 | settings.js:339-344 | Finite check, clamp, round | SettingsView.svelte:43-47 (`normaliseFtp`) | OK | Identical |
| 6 | `applyFtpValue` no-op if unchanged, setFtp + persist | settings.js:346-365 | Skip if ==current, engine.setFtp, save | SettingsView.svelte:49-57 (`applyFtp`) | OK | Persists via `fileStore.putSetting('ftp', next)` vs legacy `saveFtp` |
| 7 | `refreshFtpFromEngine` seed input on open | settings.js:333-337, 645 | Set input from engine current FTP | SettingsView.svelte:35-41 (`$effect` on open) | OK | `$derived engineFtp` + effect reseeds when `open` |
| 8 | `getCurrentFtpFromEngine` default DEFAULT_FTP | settings.js:327-331 | vm.currentFtp ?? DEFAULT_FTP | SettingsView.svelte:35 | OK | |
| **SETTINGS — Sound** |
| 9 | `refreshSoundToggle` load pref (default true) | settings.js:388-392 | loadSoundPreference(true) → checkbox | SettingsView.svelte:74-81 | OK | `getSetting('soundEnabled', true)` on open |
| 10 | `soundCheckbox` change handler | settings.js:599-603, 394-400 | Save sound preference | SettingsView.svelte:82-87 (`onSoundChange`) + 399 | OK | Also calls `beeper.setEnabled(enabled)` — new code wires the live beeper (legacy did this elsewhere). Improvement |
| **SETTINGS — Theme toggle** |
| 11 | `[data-theme-mode]` buttons click | settings.js:605-610, 467-479 | saveAndApplyThemeMode + active/aria-pressed | SettingsView.svelte:94-97 (`onThemeClick`) + 446-478 | OK | Active class + aria-pressed bound reactively to `themeMode` |
| 12 | `refreshThemeToggle` set active on open | settings.js:456-465, 642 | loadThemeMode → mark active button | SettingsView.svelte:90-93 (`$effect`) | OK | `loadThemeMode(fileStore)` |
| 13 | auto default when no data-theme-mode | settings.js:461 | `!val && mode==='auto'` active | SettingsView.svelte:448-449 | OK | Buttons explicitly carry `data-theme-mode="auto"` so equality match suffices |
| **SETTINGS — Root dir** |
| 14 | `#rootDirButton` click → pickRootDir | settings.js:568-572, 303-316 | Choose folder, refresh status | SettingsView.svelte:117-120 (`onChooseRootDir`) + 269-277 | PARTIAL | New code does NOT call `refreshDirectoryStatuses` (only sets name from returned handle); error path differs (see row 15) |
| 15 | `handleChooseRootDir` alert on missing/failed picker | settings.js:304-315 | `alert(...)` on no picker / failure | SettingsView.svelte:117-120 | GAP | No try/catch, no `alert()` fallback, no "not available in this build" guard. Rejections are unhandled |
| 16 | `refreshDirectoryStatuses` name/ok/missing classes | settings.js:273-301, 640 | Load handle → status text + ok/missing class + startupNeedsAttention | SettingsView.svelte:100-116, 258-268 | PARTIAL | Loads on open, sets name + ok/missing classes. Does NOT set `startupNeedsAttention.missingRootDir` (no auto-open in new app — see row 33). Error → name=null/"Not configured" (legacy showed "Error loading folder") |
| **SETTINGS — Logs view** |
| 17 | `showLogsView` / `View logs` btn | settings.js:556-560, 225-247 | Switch to logs view, title, back btn, scroll bottom | SettingsView.svelte:148-149 (`openLogs`), 199, 222-223, 608-617 | OK | `ui.settingsLogsOpen=true`; title + display toggled reactively. No scroll-to-bottom rAF (content is empty — see row 19) |
| 18 | `showMainView` / back btn | settings.js:562-566, 206-223 | Back to main, title, hide back btn | SettingsView.svelte:151-153 (`backFromLogs`) + 173-194 | OK | |
| 19 | `addLogLineToSettings` selection-preserving append | settings.js:254-269 | Append text node w/o resetting textContent; preserve selection; auto-scroll if at bottom | (none) — `#settingsLogsContent` div at SettingsView.svelte:628 | **GAP** | No export/consumer. `onLog: () => {}` no-op at app.ts:90. Logs pane is permanently empty; the entire selection-preserving / auto-scroll-at-bottom append logic is absent |
| 20 | `logs-active` class on modal | settings.js:213, 232 | Toggle modal class in logs mode | SettingsView.svelte:166 (`class:logs-active`) | OK | |
| **SETTINGS — Environment / compat** |
| 21 | `isWebBluetoothAvailable` | settings.js:95-101 | navigator.bluetooth.getDevices check | SettingsView.svelte:123-130 | OK | Identical |
| 22 | `refreshEnvironmentStatus` BT status text + ok/missing | settings.js:404-416, 646 | Set BT text + classes + startupNeedsAttention.missingBtSupport | SettingsView.svelte:138 (`btAvailable`), 510-516 | PARTIAL | Status text + ok/missing classes OK; `startupNeedsAttention.missingBtSupport` not set (no auto-open) |
| 23 | `isRunningAsPwa` (standalone + navigator.standalone + chrome-extension) | settings.js:103-130 | 3-way PWA detection | SettingsView.svelte:131-137 | PARTIAL | Only checks `display-mode: standalone`. Drops `navigator.standalone` (iOS) and `chrome-extension:` protocol checks |
| 24 | `refreshOfflineStatus` PWA text + ok/missing | settings.js:442-452, 648 | Installed/not text + classes | SettingsView.svelte:139 (`pwaInstalled`), 569-575 | OK | (subject to row 23 detection gap) |
| 25 | `detectOs` (Win/Android/macOS/Linux/iOS) | settings.js:132-155 | OS name + supported flag | (none) | **GAP** | No OS detection in new code |
| 26 | `detectBrowser` (Chrome/Edge/Opera/Brave/Safari/FF, userAgentData) | settings.js:157-186 | Browser name + Chromium-supported flag | (none) | **GAP** | No browser detection in new code |
| 27 | `refreshCompatibilityAlert` show warning on unsupported OS/browser | settings.js:418-440, 647 | Build message, show/hide `#settingsCompatibilityAlert`, set incompatiblePlatform | SettingsView.svelte:226-231 | **GAP** | Alert div is present but permanently `hidden` with empty `#settingsCompatibilityText`. No detection, no message, never shown |
| **SETTINGS — Help toggles** |
| 28 | `[data-settings-help-toggle]` click toggle | settings.js:501-525, 503-524 | Toggle hidden attr + `settings-help-content--visible`, reflow to replay anim | SettingsView.svelte:142-145 (`toggleHelp`), 282-291 etc. | PARTIAL | Toggles `hidden` + `--visible` class reactively per-section. No forced reflow (`el.offsetWidth`) to replay the fade/slide animation — transition may not replay on re-show |
| 29 | `showHelpSectionById` force-open a help section | settings.js:484-499 | Force section visible w/ anim (used by auto-open) | (none) | **GAP** | Only used by startup auto-open, which is itself a gap (row 33) |
| **SETTINGS — Open/close + wiring** |
| 30 | `settingsOpenBtn` (#settingsBtn) click → open | settings.js:530-534 | Open settings modal | HudView/BottomNav → `onOpenSettings` → App.svelte:111 `ui.open('settings')` | OK | Plus 's' key at App.svelte:69-72 |
| 31 | `settingsCloseBtn` click → close | settings.js:536-540 | Close modal | SettingsView.svelte:209 `ui.close()` | OK | |
| 32 | Overlay pointerdown/pointerup backdrop dismiss | settings.js:542-554 | Press-started-AND-ended on backdrop → close | OverlayModal.svelte:28-35, 47-48 | OK | Faithful gesture reproduction; reused for all overlays |
| 33 | Auto-open on startup (`startupNeedsAttention`) | settings.js:87-91, 650-671 | Auto-open settings + force file/BT help when root dir missing / no BT / incompatible | (none) | **GAP** | `startupNeedsAttention` object, `shouldAutoOpen` logic, and `showHelpSectionById` force-open all absent. New app boots to `activeOverlay:'none'` (ui.svelte.ts:12). No startup attention behavior |
| 34 | ESC: logs→main else close | settings.js:613-624 | Escape: exit logs view first, else close settings; ignore w/ modifiers | ui.svelte.ts:43-51 (`handleEscape`) + App.svelte:53-62 | OK | Modifier guard at App.svelte:54; logs-first disposition preserved |
| 35 | `openSettings`/`actuallyCloseSettings`/`closeSettings` | settings.js:188-204 | display flex/none, isOpen flag, reset to main view on close | ui.svelte.ts:22-36 + OverlayModal `{#if open}` | OK | `close()` resets `settingsLogsOpen=false` (ui.svelte.ts:34) = "show main view on close" |
| 36 | `openSettingsModal` / `isSettingsModalOpen` exports | settings.js:675-681 | Public open + is-open query | ui.svelte.ts:22 `open('settings')` / `activeOverlay` | OK | Store-based equivalent |
| 37 | `initSettings` idempotent guard | settings.js:629-631 | Run-once flag | n/a (Svelte component lifecycle) | OK | Component model makes guard unnecessary |
| **WELCOME** |
| 38 | `SLIDES` (4: splash/trainers/offline/workouts) | welcome.js:4-41 | Slide data | WelcomeView.svelte:20-57 | OK | Identical titles + bodyLines |
| 39 | `initWelcomeTour` + DOM-missing fallback | welcome.js:415-444 | Init, no-op API if DOM missing | WelcomeView.svelte (component) | OK | Component renders only `{#if open}` |
| 40 | keydown ArrowRight / PageDown → next | welcome.js:729-733 | Advance slide | (none) | **GAP** | No welcome keyboard handler. App.svelte:66 returns early when an overlay is open, so arrow/page keys do nothing in welcome |
| 41 | keydown ArrowLeft / PageUp → prev | welcome.js:734-738 | Previous slide | (none) | **GAP** | Same — no handler |
| 42 | keydown Space / Enter (when overlay/body focused) → next | welcome.js:739-747 | Advance if focus on overlay/body | (none) | **GAP** | Same — no handler |
| 43 | keydown Escape → close (full + splash) | welcome.js:718-728 | Close overlay | ui.svelte.ts handleEscape via App.svelte:56-62 | OK | Escape closes any active overlay incl. welcome |
| 44 | `stopImmediatePropagation` input-swallow | welcome.js:709-710, 715-717, 726-747 | Swallow keys so app shortcuts don't fire under welcome | App.svelte:66 (`activeOverlay !== 'none'` early return) | PARTIAL | Net effect (app shortcuts suppressed) achieved via early-return, but ALL nav keys are swallowed including the ones welcome should act on (rows 40-42). No per-key stopImmediatePropagation |
| 45 | overlay click-to-advance | welcome.js:686-704, 750 | Click overlay (not nav/close) → next; splash swallows | WelcomeView.svelte:138-146 (`onOverlayClick`) + 158 | OK | splash stopPropagation at :139-141; nav/close ignored at :144 |
| 46 | prev button click | welcome.js:752-757 | stopPropagation + goToPrev | WelcomeView.svelte:203-206 | OK | |
| 47 | next button click | welcome.js:759-764 | stopPropagation + goToNext | WelcomeView.svelte:217-220 | OK | |
| 48 | close button click | welcome.js:766-771 | stopPropagation + close | WelcomeView.svelte:167-170 | OK | |
| 49 | `goToNext` (splash bail, last→close) | welcome.js:669-677 | Bail in splash; close after last slide | WelcomeView.svelte:103-110 (`goNext`) | OK | |
| 50 | `goToPrev` (splash bail, first guard) | welcome.js:679-684 | Bail in splash; no-op at index 0 | WelcomeView.svelte:111-115 (`goPrev`) | OK | |
| 51 | prev btn visibility hidden at index 0 | welcome.js:531-533 | Hide prev on first slide | WelcomeView.svelte:202 | OK | |
| 52 | next btn always visible | welcome.js:534-536 | Show next | WelcomeView.svelte:211-223 | OK | Always rendered visible |
| 53 | `renderSlide` title/body/classes | welcome.js:494-539 | Set title, body HTML, slide classes, scene | WelcomeView.svelte:96-101 (`goToIndex`) + 183/193 | OK | |
| 54 | `computeBodyHtml` span+`<br>` | welcome.js:479-484 | Wrap lines in spans joined by `<br>` | WelcomeView.svelte:120-122 (`bodyHtml`) + 193 `{@html}` | OK | Identical |
| 55 | `applySlideClasses` splash/icon-only | welcome.js:486-492 | Toggle splash + icon-only classes | WelcomeView.svelte:177-178 | OK | |
| 56 | Splash text-hidden 1000ms reveal + nav hidden | welcome.js:514-523 | Hide text 1s on first splash render, then reveal; hide nav | WelcomeView.svelte:82-94 (`applyTextReveal`) + 179-180 | PARTIAL | Text hide/reveal at 1000ms reproduced. But nav buttons (`welcome-nav-hidden`) are NOT hidden during the 1s splash delay (legacy hid prev/next/close); new code only toggles text classes |
| 57 | splash vs full mode (`setOverlayMode`, splash-only class) | welcome.js:471-477, 639-667 | splash-only overlay class, splash bails nav | WelcomeView.svelte:59 (`splashMode`), 153 | OK | `ui.welcomeMode` drives it (ui.svelte.ts:18) |
| 58 | `openOverlay` (display, visible class, autoClose) | welcome.js:639-667 | Show, rAF visible class, optional autoClose timer | WelcomeView.svelte:126-136 (`$effect`/`onMount`) + 152 | PARTIAL | Open/visible reproduced. `autoCloseMs` timer NOT implemented (only used by playSplash — row 61) |
| 59 | `closeOverlay` (hiding class, transitionend finalize, fallback timer, onFinished) | welcome.js:605-637 | Animate out, hide, fire onFinished | WelcomeView.svelte:116-118 (`close` → ui.close()) | PARTIAL | Closes via `{#if open}` removal. No `welcome-overlay--hiding` exit animation, no transitionend finalize, no `onFinished` callback |
| 60 | `notifyVisibility` / `onVisibilityChanged` callback | welcome.js:455-462, 627, 656 | Report open/close + mode to host | (none) | GAP | No visibility callback. App toggles `body.welcome-active` reactively (App.svelte:42-44) covering the main side effect |
| 61 | `playSplash(durationMs)` API | welcome.js:778-780 | Open splash mode w/ autoClose | (none) | GAP | `ui.openWelcome('splash', …)` exists (ui.svelte.ts:27) but no auto-close timer; splash never auto-dismisses |
| 62 | `goToSlide(index)` API | welcome.js:781-789 | Jump to slide (open or animate) | ui.welcomeStartIndex (ui.svelte.ts:20) + WelcomeView.svelte:129 | PARTIAL | Start index honored at open; no live "jump to slide while open" entry point |
| 63 | `animateSlideChange` (out/in transitions, transitionend) | welcome.js:541-603 | Slide-out/in animation w/ transitionend + 330ms fallback | WelcomeView.svelte:96-101 (`goToIndex`) | GAP | No slide transition animation — index swaps instantly. (Harness disables animations, so pixel-diff stable, but real-app slide animation is absent) |
| **WELCOME — Scene builder** |
| 64 | `createSvgEl` | welcome.js:43-45 | createElementNS helper | welcome-scene.ts:48-50 (`svgEl`) | OK | |
| 65 | `loadSvgGroupAsset` (fetch, parse, defs+groups, cache) | welcome.js:49-84 | Fetch SVG, extract viewBox/defs/top-level g's, cache | welcome-scene.ts:52-79 | OK | Faithful; same `svgGroupCache` map |
| 66 | `SCENE_LAYOUTS` | welcome.js:86-118 | Per-slide layout config | welcome-scene.ts:34-46 | OK | Identical srcs/sizes |
| 67 | `createSceneFromLayout` root svg + classes | welcome.js:120-134 | Build root svg, enter/steady/exit classes | welcome-scene.ts:86-96 (`createScene`) | OK | |
| 68 | content group offset centering | welcome.js:136-141 | translate by (viewbox-base)/2 | welcome-scene.ts:98-103 | OK | |
| 69 | `addDelay` (--delay, scene-piece) | welcome.js:145-151 | Set delay var, track maxDelay | welcome-scene.ts:105-108 | PARTIAL | Sets `--delay` + `scene-piece`. Does NOT track/return `maxDelay` (legacy used it to time steady transition — moot since new harness marks steady immediately, WelcomeView.svelte:78) |
| 70 | `applyFlyOffset` (--fly-scale/x/y) | welcome.js:153-178 | Compute fly start scale + offsets | welcome-scene.ts:109-122 | OK | Simplified options dropped (growRadius/distScale fixed at legacy defaults 0.25/0.9) |
| 71 | `setFloatProps` (--float-ms/amp/x, randomized) | welcome.js:180-187 | Per-asset random float vars | welcome-scene.ts:123-127 | PARTIAL | New code uses FIXED values (2600ms/6px/0) instead of legacy randomized amp/ms/driftX. Deterministic by design for pixel-diff; animation variety lost |
| 72 | image asset rendering (splash logo) | welcome.js:202-251 | Build image asset, center, fly offset | welcome-scene.ts:132-163 | OK | |
| 73 | group asset rendering + bbox measure (CTM-aware) | welcome.js:254-341 | Load groups, measure bbox in temp svg, position by center | welcome-scene.ts:165-235 | OK | Faithful CTM transform-corner measurement |
| 74 | `ready` promise + `cleanup`/`destroyed` | welcome.js:189-200, 348-353 | Resolve when async assets laid out; cleanup guard | welcome-scene.ts:129-130, 230-234 | PARTIAL | `ready` promise reproduced. No `cleanup()`/`destroyed` flag (legacy guarded against late async append after scene swap). Minor leak risk on rapid slide change |
| 75 | `createSceneManager` (showScene, enter/steady timing, prev removal) | welcome.js:356-413 | Manage scene transitions, ENTER_MS timing, steady class | WelcomeView.svelte:70-80 (`renderScene`) | PARTIAL | Removes prev, appends next. Marks `welcome-scene--steady` immediately (no enter→steady timed transition, no ENTER_MS+maxDelay settle). Enter animation absent |
| **THEME** |
| 76 | `applyThemeMode` (toggle theme-light/dark + data-theme) | theme.js:6-20 | Remove both classes, add one, set dataset.theme | theme.ts:22-31 | OK | Identical; also returns normalized mode |
| 77 | `initThemeFromStorage` | theme.js:22-26 | loadThemeMode → applyThemeMode on boot | app.ts:50-53 (`applyThemeMode(await loadThemeMode(...))`) | OK | Inlined at boot |
| 78 | `saveAndApplyThemeMode` (apply + persist) | theme.js:28-33 | applyThemeMode + saveThemeMode | theme.ts:47-55 | OK | Persists to BOTH localStorage + store.putSetting (legacy storage.js saved to localStorage + IDB) |
| 79 | `loadThemeMode` source | (storage.js) | Read persisted mode | theme.ts:34-44 | OK | localStorage first, then store; normalizes |
| **THEME-INIT (anti-FOUC)** |
| 80 | Inline sync anti-FOUC script | theme-init.js:1-15 | Before paint: read localStorage themeMode, toggle html classes + data-theme, swallow errors | web/index.html:8-18 (inline `<head>` script) | OK | Byte-for-byte equivalent; inlined in `<head>` |
| 81 | matchMedia listener (system theme live-update) | (none in legacy) | — | (none) | OK | Legacy had NO matchMedia listener; 'auto' relies on CSS `prefers-color-scheme` (workout-base.css:91 etc.). New app matches — no live JS listener, CSS handles it. No gap |

## Gaps

### GAP (functionality absent)

- **#19 — Connection logs never populated (MEDIUM).** `addLogLineToSettings` (settings.js:254-269) and its selection-preserving / auto-scroll-when-at-bottom append are entirely absent. The new `onLog` callback is a no-op (`app.ts:90`), so `#settingsLogsContent` (SettingsView.svelte:628) is always empty. The whole logs feature is non-functional.

- **#25/#26/#27 — Compatibility detection + alert absent (MEDIUM).** `detectOs` (settings.js:132-155), `detectBrowser` (settings.js:157-186), and `refreshCompatibilityAlert` (settings.js:418-440) have no port. `#settingsCompatibilityAlert` (SettingsView.svelte:226) is hard-`hidden` with empty text — the unsupported-OS / non-Chrome warning never appears.

- **#33/#29 — Startup auto-open absent (MEDIUM).** `startupNeedsAttention` (settings.js:87-91) and the `shouldAutoOpen` block (settings.js:650-671) — auto-opening settings and force-expanding file/BT help when root-dir missing / no Web Bluetooth / incompatible platform — are gone. `showHelpSectionById` (settings.js:484-499) is unused/absent. New app boots to `activeOverlay:'none'`. First-run users get no nudge to configure.

- **#15 — Root-dir picker error handling absent (LOW).** `handleChooseRootDir` had try/catch with `alert()` fallbacks and a "not available in this build" guard (settings.js:304-315). `onChooseRootDir` (SettingsView.svelte:117-120) has none; picker rejections are unhandled.

- **#40/#41/#42 — Welcome keyboard navigation absent (MEDIUM).** ArrowRight/PageDown→next, ArrowLeft/PageUp→prev, Space/Enter→next (welcome.js:729-747) have NO handler. App.svelte:66 early-returns whenever any overlay is open, so the welcome tour is mouse/Escape-only. Escape (#43) still works.

- **#63 — Welcome slide transition animation absent (LOW).** `animateSlideChange` (welcome.js:541-603, out/in transforms + transitionend) is not ported; `goToIndex` swaps instantly. Cosmetic; harness disables animations anyway.

- **#59/#75 — Welcome enter/exit scene + overlay animations absent (LOW).** `closeOverlay` hiding/transitionend/onFinished (welcome.js:605-637) and `createSceneManager` enter→steady timing (welcome.js:356-413) are reduced to instant show/steady. Cosmetic.

- **#61 — playSplash auto-close absent (LOW).** Splash mode can be opened (`ui.openWelcome('splash')`) but the `autoCloseMs` timer (welcome.js:662-666, 778-780) is missing — a splash never auto-dismisses.

- **#60/#74 — Visibility callback + scene cleanup absent (LOW).** `onVisibilityChanged` (welcome.js:455-462) and scene `cleanup()`/`destroyed` guard (welcome.js:348-353) dropped. Body `.welcome-active` toggle is covered reactively (App.svelte:42-44); cleanup gap is a minor late-async leak risk on rapid slide changes.

### PARTIAL (behavior diverges)

- **#23 — PWA detection narrowed (LOW).** New `isRunningAsPwa` (SettingsView.svelte:131-137) checks only `display-mode: standalone`; drops `navigator.standalone` (iOS home-screen) and `chrome-extension:` protocol checks (settings.js:103-130). iOS/extension installs misreport as "Not installed."

- **#28 — Help-toggle animation may not replay (LOW).** `toggleHelp` (SettingsView.svelte:142-145) omits the forced reflow (`el.offsetWidth`, settings.js:516-517) used to replay the fade/slide on re-show. Class toggles correctly; the entry animation may not re-trigger.

- **#56 — Splash nav not hidden during 1s reveal (LOW).** Legacy hid prev/next/close via `welcome-nav-hidden` during the 1000ms splash text delay (welcome.js:517-522); new code (WelcomeView.svelte:82-94) only toggles text classes, so nav buttons show immediately.

- **#44 — Key swallowing is coarse (LOW).** Legacy welcome `stopImmediatePropagation` per-key (welcome.js:709-747) both consumed app shortcuts AND acted on nav keys. New App.svelte:66 blanket-suppresses all keys when an overlay is open — correct for not leaking shortcuts, but it is also why #40-42 don't work.

- **#71/#69 — Scene float/delay values fixed not randomized (LOW).** `setFloatProps` uses constant 2600ms/6px/0 (welcome-scene.ts:123-127) vs legacy randomized amp/ms/driftX (welcome.js:180-187); `maxDelay` no longer tracked. Intentional for deterministic pixel-diff; animation variety lost.

- **#14/#16 — Root-dir refresh path differs (LOW).** `onChooseRootDir` sets the name directly instead of re-running `refreshDirectoryStatuses`; error state shows "Not configured" rather than "Error loading folder" (settings.js:294). `startupNeedsAttention.missingRootDir` not set (tied to #33).

- **#22 — startupNeedsAttention.missingBtSupport not set (LOW).** BT status text/classes render correctly (SettingsView.svelte:510-516) but the attention flag is unused (tied to #33).
