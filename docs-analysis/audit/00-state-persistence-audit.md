# VeloDrive — Local State Persistence Audit (Legacy vs. Rewrite)

Read-only audit. **No code was changed.** This document enumerates every piece of
local state the OLD VeloDrive app (oracle: `docs/`) persisted across a browser
refresh, maps each to the new rewrite (`web/src/`), and identifies the exact root
cause of the user-reported regression (select a workout → refresh → workout gone).

- Legacy oracle root: `/home/babymastodon/code/velo-drive/docs`
- New app root: `/home/babymastodon/code/velo-drive/web/src`
- Legacy IndexedDB: db `velo-drive`, version `1`, store `settings`, `keyPath: "key"`.
  Records are `{key, value}` for settings and `{key, handle}` for FSA dir handles.
- New IndexedDB: identical (`WebFileStore.ts:32-34, 193-194, 203-228`).

> **Headline finding (REGRESSION R1):** The persistence *wiring* for the selected
> workout is present and structurally identical to legacy. The bug is that the
> new app passes a **Svelte 5 reactive `$state` proxy** (the picked
> `CanonicalWorkout`) into `IndexedDB.put()`. A real browser's IDB `put` runs the
> structured-clone algorithm, which throws `DataCloneError` on a proxy; the write
> is fired un-awaited (`void putSetting(...)`), so it rejects **silently** and
> `selectedWorkout` is never persisted. The hermetic test harness uses a fake
> IndexedDB whose `put` is a plain `Map.set` with **no structured clone**
> (`web/harness/file-store.ts:186-189`), so every test passes while the real app
> silently loses the workout on reload. Details in **R1** below.

---

## Full state table

| State | Storage (mechanism + key/store/file) | Legacy SAVE (file:line) | Legacy RESTORE-on-load (file:line) | New SAVE (file:line) | New RESTORE-on-load (file:line) | Status | Notes (exact divergence + legacy behavior to restore) |
|---|---|---|---|---|---|---|---|
| **Selected / currently-loaded workout** | IDB `settings` key `selectedWorkout` (full CanonicalWorkout object) | `docs/workout-picker.js:1576` (`doSelectWorkout`→`saveSelectedWorkout`) → `docs/storage.js:367` (`setSetting`); scheduled load `docs/workout.js:1495` | `docs/workout-engine.js:617` (`loadSelectedWorkout`) → `docs/storage.js:363` (`getSetting`) | `web/src/ui/PickerView.svelte:282` (`void fileStore.putSetting('selectedWorkout', canonical)`); scheduled `web/src/ui/PlannerView.svelte:750` → `WebFileStore.ts:263` `putSetting`→`setSetting` (`:203-211`) | `web/src/core/engine.ts:745` (`loadSelectedWorkout`) → `WebFileStore.ts:370-372` | **REGRESSION** | The wiring exists, but `canonical` is a Svelte `$state` proxy (`PickerView.svelte:56` `workouts = $state<…>`). Real-browser `IDB.put` structured-clones → `DataCloneError` → silent reject (un-awaited `void`). Nothing is persisted; reload returns `null`. See **R1**. Legacy stored a plain object, so its clone succeeded. |
| **Active / in-progress ride state (resume-after-crash)** | IDB `settings` key `activeWorkoutState` (full snapshot: elapsedSec, currentIntervalIndex, liveSamples, pause events, FTP, modes, workoutStartedAt, …) | `docs/workout-engine.js:193` (`persistActiveState`, debounced 500ms via `scheduleSaveActiveState` :184-190) + idle `:217` (`persistIdleState`) → `docs/storage.js:375` (`saveActiveState`) | `docs/workout-engine.js:623-666` (`loadActiveState`+restore; `if(workoutRunning){startTicker();setPaused(true)}`) | `web/src/core/engine.ts:283-309` (`persistActiveState`/`buildActiveSnapshot`, debounced 500ms `:275-281`) + idle `:311-325` (`persistIdleState`) → `WebFileStore.ts:384-386` `saveActiveState` | `web/src/core/engine.ts:751-761` (`loadActiveState`+`restoreActiveState` :766-794; `if(workoutRunning){startTicker();setPaused(true)}`) | **REGRESSION (mid-ride only)** | Idle snapshot (no `canonicalWorkout`) is plain-object and persists fine. But a **running**-ride snapshot (`buildActiveSnapshot` :289) embeds `this.canonicalWorkout`, which after `setWorkoutFromPicker(canonical)` is the **same Svelte proxy** → real-browser `IDB.put` throws `DataCloneError`, the debounced save rejects silently, so a refresh **mid-ride does not resume**. Same root cause as R1. See **R1 / R2**. |
| **FTP** | IDB `settings` key `ftp` | `docs/settings.js:361` → `docs/storage.js:359` (`setSetting(FTP_KEY,…)`) | restored implicitly via `activeWorkoutState.currentFtp` (`docs/workout-engine.js:628`); key `ftp` read by settings UI | `web/src/ui/SettingsView.svelte:61` (`void fileStore.putSetting('ftp', next)`) + `engine.setFtp` (`:59`) | `web/src/app/app.ts:69` (`getSetting('ftp', DEFAULT_FTP)`) → `engine.setFtpInitial` (`:73`) | OK | New app restores FTP explicitly at boot from the dedicated `ftp` key (an improvement over legacy's implicit-via-activeState path). Value is a number → clones fine. |
| **Sound on/off** | IDB `settings` key `soundEnabled` (default `true`) | `docs/settings.js:397` → `docs/storage.js:327` (`saveSoundPreference`) | `docs/settings.js:390` → `docs/storage.js:322` (`loadSoundPreference(true)`) | `web/src/ui/SettingsView.svelte:93` (`putSetting('soundEnabled', enabled)`) | `web/src/app/app.ts:71` (`getSetting('soundEnabled', true)`) → `beeper.setEnabled` (`:72`) | OK | Boolean → clones fine. Default `true` preserved. |
| **Theme mode (light/dark/auto)** | localStorage key `themeMode` (anti-FOUC) **+** IDB `settings` key `themeMode` | `docs/storage.js:350` (`localStorage.setItem`) + `:355` (`setSetting`) via `saveAndApplyThemeMode` | `docs/theme-init.js:4` (inline `localStorage.getItem`) + `docs/theme.js:23` → `docs/storage.js:332-336` (localStorage-first, IDB fallback) | `web/src/app/theme.ts:49-54` (`saveAndApplyThemeMode`: localStorage + `putSetting`) via `SettingsView.svelte:17` | `web/src/app/theme.ts:34-44` (`loadThemeMode`: localStorage-first, IDB fallback) called at `web/src/app/app.ts:78`; inline anti-FOUC in `index.html` | OK | Faithful dual-store mirror. String → clones fine. |
| **Last bike BLE device id** | IDB `settings` key `lastBikeDeviceId` | `docs/ble-manager.js:692` (`saveBikeDeviceId`) → `docs/storage.js:412` (`saveBikeBleDeviceId`) | `docs/ble-manager.js:944` (`loadSavedBleDeviceIds`) → `storage.js:405-408`; auto-reconnect `ble-manager.js:970` | `web/src/app/app.ts:86-87` (`saveBikeId`→`putSetting('lastBikeDeviceId', id)`) wired into transport | `web/src/app/app.ts:83` (`loadBleDeviceIds`) → `WebFileStore.ts:374-378`; `transport.setSavedDeviceIds` (`:84`, autoReconnect) | OK | String id → clones fine. |
| **Last HRM BLE device id** | IDB `settings` key `lastHrDeviceId` | `docs/ble-manager.js:861` (`saveHrDeviceId`) → `docs/storage.js:416` (`saveHrBleDeviceId`) | `docs/ble-manager.js:944`+`982` (auto-reconnect) | `web/src/app/app.ts:87` (`saveHrId`→`putSetting('lastHrDeviceId', id)`) | `web/src/app/app.ts:83` (`loadBleDeviceIds`) → `WebFileStore.ts:374-378` | OK | String id → clones fine. |
| **Picker sort + filter prefs (search / zone / duration / sortKey / sortDir)** | IDB `settings` key `pickerState` | `docs/workout-picker.js:1516-1525` (`persistPickerState`→`savePickerState`) → `docs/storage.js:388` | `docs/workout-picker.js:1496-1514` (`restorePickerStateIntoControls`→`loadPickerState`) → `docs/storage.js:384` | `web/src/ui/PickerView.svelte:95-103` (`persistPickerState`→`putSetting('pickerState', …)`) | `web/src/ui/PickerView.svelte:82-93` (`restorePickerState`→`getSetting('pickerState')`) | OK | Plain object of strings → clones fine. Faithful. |
| **Builder draft / unsaved workout autosave** | IDB `settings` key `workoutBuilderState` | `docs/workout-builder.js:1155-1165` (`saveWorkoutBuilderState({…,_shouldRestore:true})`) → `docs/storage.js:392`; clear `:1600-1612` | `docs/workout-builder.js:966-989` (`loadWorkoutBuilderState`, checks `_shouldRestore!==false`) → `docs/storage.js:396` | `web/src/ui/PickerView.svelte:409`+`507` (`putSetting('workoutBuilderState', …)`); clear `:413` (`putSetting(..., null)`) | `web/src/ui/PickerView.svelte:483` (`getSetting('workoutBuilderState', null)` → `restoreBuilderDraftOrDefault` :482-496) | **GAP (verify clone-safety)** | Wiring present and faithful. The draft written at `:409` is `current` (the builder backend's current canonical) — confirm it is a plain object and **not** a Svelte proxy, or it hits the same `DataCloneError` as R1 in a real browser. `loadIntoBuilder` (`:507`) writes a freshly-parsed `canonical` (plain → OK). Legacy `_shouldRestore` flag is **not** mirrored; the new restore only gates on `rawSegments.length` (`:486`). See **G3**. |
| **FSA root dir handle** | IDB `settings` key `rootDirHandle` (record `{key,handle}`) | `docs/storage.js:201` (`saveHandle(ROOT_DIR_KEY,…)`) | `docs/storage.js:206` (`loadHandle(ROOT_DIR_KEY)`) | `web/src/ports/web/WebFileStore.ts:293` (`saveHandle(ROOT_DIR_KEY,…)`) | `WebFileStore.ts:267-269` (`loadRootDirHandle`); used at `app.ts:121/183/350` | OK | Correct `{key,handle}` record shape (fixed in commit e6bf835; see `WebFileStore.ts:213-228`). |
| **FSA workouts (.zwo) dir handle** | IDB `settings` key `dirHandle` | `docs/storage.js:167` (`saveHandle(ZWO_DIR_KEY,…)`) | `docs/storage.js:173` (`loadHandle(ZWO_DIR_KEY)`) | `WebFileStore.ts:303` (`saveHandle(ZWO_DIR_KEY,…)`) | `WebFileStore.ts:403-410` (`loadZwoDirHandle`, falls back to deriving from root) | OK | Key string `dirHandle` matches legacy (`WebFileStore.ts:49`). |
| **FSA history dir handle** | IDB `settings` key `workoutDirHandle` | `docs/storage.js:143` (`saveHandle(WORKOUT_DIR_KEY,…)`) | `docs/storage.js:149` (`loadHandle`) | `WebFileStore.ts:304` (`saveHandle(WORKOUT_DIR_KEY,…)`) | `WebFileStore.ts:388-399` (`loadWorkoutDirHandle`, derive-from-root fallback) | OK | Key `workoutDirHandle` matches. |
| **FSA trash dir handle** | IDB `settings` key `trashDirHandle` | `docs/storage.js:253` (`saveHandle(TRASH_DIR_KEY,…)`) | `docs/storage.js:259` (`loadHandle`) | `WebFileStore.ts:305` (`saveHandle(TRASH_DIR_KEY,…)`) | `WebFileStore.ts:412-419` (`loadTrashDirHandle`) | OK | Key `trashDirHandle` matches. |
| **schedule.json (on disk, root dir)** | File `schedule.json` in FSA root (array of `{date, workoutTitle}`) | `docs/planner-backend.js:159-161` → `docs/storage.js:233-248` (`saveScheduleEntries`, `:241` write JSON) | `docs/planner-backend.js:121-150` → `docs/storage.js:217-231` (`loadScheduleEntries`, `:224` parse) | `WebFileStore.ts:737-758` (`saveSchedule`, pretty JSON) | `WebFileStore.ts:722-734` (`loadSchedule`); boot auto-open today's ride `app.ts:159` | OK | Faithful. Plus `removeScheduledByTitle` (`:768-777`) for the post-ride clear. |
| **.zwo workout files (on disk, workouts dir)** | Files in FSA workouts dir | `docs/workout-picker.js:1828-1834` (`saveCanonicalWorkoutToZwoDir`); overwrite→trash `:1814-1823` | listed on demand `docs/workout-picker.js:1884` (`rescanWorkouts`→`loadZwoDirHandle`) | `WebFileStore.ts:450-492` (`saveWorkout`; overwrite→trash `:469-479`) | `WebFileStore.ts:421-443` (`listWorkouts`, on picker open) | OK | Data-loss guard (move-to-trash before overwrite) preserved. Default-seed of 6 starters preserved (`WebFileStore.ts:321-368`). |
| **history .fit files (on disk, history dir)** | Files in FSA history dir | written by engine on ride end (legacy `workout-engine.js`/`fit-file.js`) | listed on demand by planner-backend | `web/src/core/engine.ts:327-377` (`saveWorkoutFile`) | `WebFileStore.ts:541-564` (`listHistory`) / `:574-620` (`listHistoryPreviews`) | OK | Faithful on-disk round-trip. |
| **trash files (on disk, trash dir)** | Files in FSA trash dir | `docs/planner-analysis.js:305-365` (`moveHistoryFileToTrash`); picker trash | derived (listed on demand) | `WebFileStore.ts:499-532` (`moveZwoFileToTrash`) / `:780-814` (`deleteHistoryToTrash`) | derived | OK | Timestamped trashed names + length cap preserved (`WebFileStore.ts:512-519`). |
| **Stats cache (FIT preview cache)** | IDB `settings` key `workoutStatsCache` (`{version, entries}`) | `docs/storage.js:427` (`saveWorkoutStatsCache`) | `docs/storage.js:422` (`loadWorkoutStatsCache`, validated) | `WebFileStore.ts:700-706` (`saveStatsCache`) | `WebFileStore.ts:685-698` (`ensureStatsCache`, version-gated) | OK | Faithful; new `STATS_CACHE_VERSION=30` (`WebFileStore.ts:42`), prunes vanished files (`:611-617`). Plain JSON → clones fine. |
| **Last scraped workout** | IDB `settings` key `lastScrapedWorkout` | `docs/storage.js:292` (`saveLastScrapedWorkout`) | `docs/storage.js:288` (`loadLastScrapedWorkout`) | **(none found)** | **(none found)** | **GAP** | The new app uses `core/scrapers.ts` only to import directly into the builder (`PickerView.svelte` `loadIntoBuilder`). It never persists `lastScrapedWorkout`, so a scraped workout does **not** survive a reload back into the builder the way legacy did. See **G4**. |
| **Just-scraped flag** | IDB `settings` key `lastScrapedWorkoutJustScraped` | `docs/storage.js:296` (`markLastScrapeJustScraped`) | `docs/storage.js:300` (`wasWorkoutJustScraped`); clear `:303-305` | **(none found)** | **(none found)** | **GAP** | Companion to `lastScrapedWorkout`. Same omission. See **G4**. |
| **Welcome-seen flag** | IDB `settings` key `hasSeenWelcome` (NEW only) | **(no persisted flag in legacy)** — legacy gates the tour on root-dir-configured / PWA heuristics (`shouldForceFullWelcome`, `docs/workout.js:184-207`) | derived heuristic each boot | `web/src/ui/App.svelte:130` (`putSetting('hasSeenWelcome', true)`) | `web/src/ui/App.svelte:110` (`getSetting('hasSeenWelcome', false)`) | OK (improvement) | The new app *adds* a persisted seen-flag the legacy lacked. Boolean → clones fine. Behaviorally a superset of legacy gating (`App.svelte:107-138`). |
| **Picker expanded row** | in-memory only | not persisted; reset on open (`docs/workout-picker.js:1564`) | n/a | `PickerView.svelte:63` (`expandedTitle=$state`), reset on open (`:119`) | n/a | OK | Both in-memory only. No persistence expected. |
| **Planner view state (selected date / week / detail)** | in-memory only | not persisted; reset on open (`docs/workout-planner.js:1397-1430`, `:550-566`) | n/a | `state/ui.svelte.ts:52` (`plannerDetailOpen`), planner-local state | n/a | OK | Both in-memory only. (Exception: `ui.pendingHistoryFile` is a one-shot, not persisted.) |
| **"Last view" / active overlay / scroll** | in-memory only | not persisted (each view opens fresh) | n/a | `state/ui.svelte.ts:20` (`activeOverlay=$state('none')`) | n/a | OK | Neither persists the open overlay/scroll across reload. Parity. |

### States I could NOT fully determine

- **Builder draft clone-safety (G3):** I confirmed `loadIntoBuilder` (`PickerView.svelte:507`) writes a freshly-parsed (plain) canonical, but I did not trace whether the `current` object written by the autosave at `PickerView.svelte:409` is a Svelte `$state` proxy from the builder backend. If it is, it shares R1's `DataCloneError` failure mode in a real browser. **Needs a real-browser check or a trace of `builderApi`'s return type.**
- **Legacy exact line numbers** were reported by sub-agents from a full read of `docs/*.js`; spot-checked against `storage.js` constants and the new app's own "mirrors docs/...:NNN" comments, which corroborate them. A couple of legacy line numbers (e.g. `workout-engine.js:617/623`) were reported with slightly different offsets by two agents (617 vs 625 for `loadSelectedWorkout`); the surrounding code (two-step load: `selectedWorkout` then `activeWorkoutState`) is unambiguous and matches `engine.ts:745-756`.

---

## Regressions & Gaps

Ordered by severity. (REGRESSION = worked in legacy, broken in new. GAP = legacy
capability missing/weaker in new.)

### R1 — REGRESSION (CRITICAL): selected workout lost on refresh — Svelte proxy is not structured-clonable

**Repro (real browser, NOT the harness):**
1. Configure a VeloDrive folder; open the picker; select any workout.
2. The HUD correctly shows the workout (in-memory engine state is fine).
3. Refresh the page.
4. **The workout is gone** (HUD shows no workout). Legacy restored it.

**Why it happens — exact chain:**
- The picker library is reactive: `web/src/ui/PickerView.svelte:56` — `let workouts = $state<CanonicalWorkout[]>([])`. In Svelte 5, elements read out of a `$state` array are **reactive Proxy** objects.
- On select, `web/src/ui/PickerView.svelte:281-285` `doSelect(canonical)` runs:
  ```js
  void fileStore.putSetting('selectedWorkout', canonical); // canonical is a Proxy
  engine.setWorkoutFromPicker(canonical);
  ui.close();
  ```
- `putSetting` → `WebFileStore.ts:203-211 setSetting` → `tx.objectStore('settings').put({ key, value })`.
- A **real** browser's `IDBObjectStore.put` runs the **structured-clone algorithm** on the value. A Svelte reactive Proxy is not cloneable → it throws **`DataCloneError`**, which rejects the transaction promise. Because the call site fires it un-awaited (`void putSetting(...)`), the rejection is **swallowed** — no error surfaces, the HUD still shows the workout from in-memory state, and **nothing is written to IndexedDB**.
- On the next boot, `web/src/core/engine.ts:745` `loadSelectedWorkout()` → `WebFileStore.ts:370-372` reads key `selectedWorkout`, finds nothing, returns `null` → `engine.canonicalWorkout` stays null → **workout gone**.

**Why every test passes (the masking):**
- The hermetic IndexedDB fake's `put` is `web/harness/file-store.ts:186-189`:
  ```js
  put(record) { this.store.set(record.key, record); ... } // plain Map.set, NO structured clone
  ```
  It stores the proxy **by reference** with no clone, so the write "succeeds" and the persistence assertion in `tests/e2e/picker.new.spec.ts:166-172` passes. The harness also **seeds** `selectedWorkout` directly (e.g. `tests/e2e/hud.new.spec.ts:25`), so the *restore* path is exercised only with pre-seeded plain objects — never with a proxy round-tripped through a real `put`. No test reloads after a real in-app select, so the gap is invisible.

**Legacy save+restore (the behavior to match):**
- SAVE: `docs/workout-picker.js:1576` (`doSelectWorkout`→`saveSelectedWorkout`) → `docs/storage.js:367` (`setSetting(STORAGE_SELECTED_WORKOUT, payload)`). The legacy `canonicalWorkout` is a **plain object** built by the picker, so its structured clone succeeds.
- RESTORE: `docs/workout-engine.js:617` (`const selected = await loadSelectedWorkout(); if(selected){ canonicalWorkout = selected; … }`) → `docs/storage.js:363`.

**What the new app must do to match (options, no code changed here):**
1. **Deep-clone / snapshot to a plain object before persisting.** Pass a non-reactive copy into `putSetting`, e.g. `$state.snapshot(canonical)` (Svelte 5) or `structuredClone(JSON.parse(JSON.stringify(canonical)))` / a plain rebuild from `rawSegments`. Apply at the call site `PickerView.svelte:282` (and the scheduled path `PlannerView.svelte:750`).
2. **Or** snapshot centrally inside `WebFileStore.setSetting` / `putSetting` (`WebFileStore.ts:203-211`) so *every* persisted value is guaranteed plain — this also protects R2 and any future proxy leak.
3. **Stop silently swallowing the write.** The `void putSetting(...)` pattern hides the `DataCloneError`; awaiting it (or attaching a `.catch` that routes to `onError`) would have surfaced the failure immediately.
4. **Fix the test blind spot:** make the fake IDB `put` structured-clone its record (mirror real IDB), and add an e2e that selects a workout *in-app* then `page.reload()` and asserts the HUD still shows it.

---

### R2 — REGRESSION (HIGH): mid-ride refresh does not resume (same proxy clone failure)

**Repro:** Select a workout, start riding (or pause mid-ride), refresh. Legacy
resumed the ride paused-in-place with elapsed time + samples; the new app does not.

**Why:** The running-ride snapshot embeds the workout —
`web/src/core/engine.ts:289` `buildActiveSnapshot()` sets
`canonicalWorkout: this.canonicalWorkout`. After `setWorkoutFromPicker(canonical)`
(`engine.ts:845`), `this.canonicalWorkout` is the **same Svelte proxy** from the
picker. The debounced save (`engine.ts:275-285 scheduleSaveActiveState` →
`persistActiveState` → `WebFileStore.ts:384 saveActiveState` → `setSetting` →
real `IDB.put`) throws `DataCloneError` on the proxy and rejects silently. So
`activeWorkoutState` is never written during a ride, and `engine.ts:751-761`
restores nothing on reload.

> Note: the **idle** snapshot (`persistIdleState`, `engine.ts:311-325`) omits
> `canonicalWorkout`, so it is plain and persists — but it carries no workout, so
> it cannot rescue R1 either.

**Legacy:** `docs/workout-engine.js:193` (`persistActiveState`, debounced) saving a
plain object; restore `docs/workout-engine.js:623-666` with
`if(workoutRunning){ startTicker(); setPaused(true); }`.

**Fix:** Same as R1 — snapshot `canonicalWorkout` to a plain object inside
`buildActiveSnapshot` (or centrally in `setSetting`). Fixing R1 centrally (option
2) fixes R2 for free.

---

### G3 — GAP (MEDIUM, NEEDS VERIFICATION): builder draft autosave may hit the same proxy clone failure

The builder autosave at `web/src/ui/PickerView.svelte:409`
(`void fileStore.putSetting(BUILDER_STATE_KEY, current)`) persists the builder's
`current` canonical. If `current` is a Svelte `$state` proxy (returned from the
builder backend / `builderApi`), it shares R1's real-browser `DataCloneError`,
and the draft silently fails to persist (lost on reload). `loadIntoBuilder`
(`:507`) writes a freshly-parsed canonical (plain → safe). **Verify the type of
`current`/`builderApi`'s state in a real browser.** Also note: legacy persisted a
`_shouldRestore` flag (`docs/workout-builder.js:1155-1165` / restore gate at
`:966-989`); the new restore (`PickerView.svelte:482-496`) only checks
`rawSegments.length`, so an explicitly cleared/abandoned draft could re-restore
in an edge case. Fix: snapshot before `putSetting` (covered by R1 option 2) and
mirror the `_shouldRestore` gate if the divergence matters.

---

### G4 — GAP (LOW): last-scraped-workout + just-scraped flag not persisted

Legacy persisted `lastScrapedWorkout` (`docs/storage.js:292`/`:288`) and
`lastScrapedWorkoutJustScraped` (`docs/storage.js:296`/`:300`, cleared at `:303`)
so a workout scraped from the web survived a reload back into the builder /
flagged the just-scraped state. The new app (`core/scrapers.ts`) imports a scraped
or uploaded workout **directly into the builder** (`PickerView.svelte loadIntoBuilder`,
which does persist it under `workoutBuilderState` at `:507`) but never persists the
dedicated `lastScrapedWorkout` / `justScraped` keys. Net effect: a scraped import
that the user has not yet opened in the builder is **not** separately remembered
across a reload, and the "just scraped" UX cue is gone. Lower severity because the
builder-draft path covers the common case. Fix: persist `lastScrapedWorkout` +
`lastScrapedWorkoutJustScraped` on scrape (and clear the flag on consume) to match
legacy, if that UX is desired.

---

## Summary

- **Persistence wiring is broadly faithful**: every IDB key, FSA handle, and
  on-disk file from legacy is mirrored in `WebFileStore.ts` with matching key
  strings, and theme / FTP / sound / BLE ids / picker prefs / handles / schedule /
  stats-cache all round-trip correctly.
- **The single root cause of the reported regression (R1, and the related R2) is
  the same bug:** the new app persists a **Svelte 5 reactive `$state` proxy** into
  `IndexedDB.put`, which `DataCloneError`s in a real browser and is fired
  un-awaited so it fails silently. The fix is to **snapshot to a plain object
  before persisting** (ideally centrally in `WebFileStore.setSetting`), stop
  swallowing the write rejection, and make the fake IDB `put` structured-clone so
  tests can catch this class of bug.
- Remaining items are minor gaps (G3 builder-draft clone-safety to verify, G4
  scraped-workout persistence) and one intentional **improvement** (the persisted
  `hasSeenWelcome` flag the legacy lacked).
