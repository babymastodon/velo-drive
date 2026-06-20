# Welcome / onboarding flow audit — legacy (`docs/`) vs new (`web/`)

Scope: the first-run welcome tour. Legacy source: `docs/index.html` (59-114),
`docs/welcome.js` (1-792), `docs/welcome.css` (1-496), gating in
`docs/workout.js` (~1223-1283). New source: `web/src/ui/WelcomeView.svelte`,
`web/src/ui/welcome-scene.ts`, `web/src/state/ui.svelte.ts`,
`web/src/styles/welcome.css`, gating in `web/src/ui/App.svelte`.

Reported symptoms: (1) "first page has left arrow"; (2) "there is no transition
animation". Findings + fixes below. All fixes verified — see **Verification**.

## Key functionality table

| # | Legacy functionality | Legacy LOC | New impl LOC | Status | Notes / fix |
|---|---|---|---|---|---|
| 1 | 4 slides: splash, trainers, offline, workouts | `welcome.js:4-41` | `WelcomeView.svelte:21-58` (`SLIDES`) | ✅ Match | Identical ids/titles/body copy. |
| 2 | Per-slide SVG scenes (logo / trainer / browser / builder) + enter/steady/exit animation classes | `welcome.js:86-118`, `welcome.css:260-370` | `welcome-scene.ts:34-46,86-239`, `welcome.css:246-370` | ✅ Match | grow/fly enter, float steady, fade/rise exit — ported. |
| 3 | Splash text reveal: title/body hidden 1000ms then fade in | `welcome.js:514-523`, `welcome.css:404-422` | `WelcomeView.svelte:88-101` (`applyTextReveal`), `welcome.css` text rules | ✅ Match | Virtual-clock-driven `setTimeout` in the harness. |
| 4 | Next arrow (❯): always present; on last slide it closes the tour | `welcome.js:534-536,669-677` | `WelcomeView.svelte:goNext` + markup | ✅ Match | `goNext` closes via `ui.close()` on the last slide. |
| 5 | **Prev arrow (❮): hidden on the splash (slide 0)** | `welcome.js:531-533` (`visibility:hidden`) | `WelcomeView.svelte` prev `class:welcome-nav-hidden={currentIndex===0 \|\| splashBooting}` | ✅ Match (verified) | **Symptom 1 did NOT reproduce on HEAD** — probe + screenshot show the splash prev arrow at `opacity:0`. The legacy `welcome-nav-boot` CSS that *could* have un-hidden it was dead (targets a sibling) and is now removed; hide hardened via `splashBooting`. See fix B. |
| 6 | **Slide transition: out (translateX∓8% + fade, 330ms) → swap content → in from opposite edge (330ms)** | `welcome.js:541-603` (`animateSlideChange`), `welcome.css:74-102` | `WelcomeView.svelte` `animateSlideChange`/`goToIndex` | ❌→✅ **Was missing → FIXED** | **Symptom 2.** Old `goToIndex` just set `currentIndex` with no animation; the `welcome-slide--animating-*` CSS existed but nothing applied it. Ported the legacy out→swap→in sequence. See fix A. |
| 7 | Splash "boot reveal": prev+next+close hidden for the 1000ms text window, then fade in | `welcome.js:514-528` | `WelcomeView.svelte` `splashBooting` derived + `class:welcome-nav-hidden` on next/close/prev | ❌→✅ **Was missing → FIXED** | New app showed next/close instantly. A prior CSS attempt (`.welcome-slide--splash .welcome-nav` → `welcome-nav-boot`) never matched (navs are siblings of `.welcome-shell`, not descendants). Replaced with the legacy JS-class approach. See fix B. |
| 8 | Keyboard: →/PageDown/Space/Enter = next, ←/PageUp = prev, Escape = close; splash swallows nav keys | `welcome.js:706-748` | `WelcomeView.svelte:handleWelcomeKey` | ✅ Match | Routed through the App overlay-key router. |
| 9 | Click slide background to advance (ignores clicks on nav/close); splash blocks clicks | `welcome.js:686-704` | `WelcomeView.svelte:onOverlayClick` | ✅ Match | |
| 10 | Close (×) / Escape / next-on-last dismiss; HUD hidden while active | `welcome.js:605-637`, `welcome.css:467-472` | `WelcomeView.svelte:close` + `App.svelte` `welcome-active` toggle | ✅ Match | |
| 11 | Splash-only mode (configured PWA): logo only, no chrome, auto-dismiss ~1100ms | `welcome.js:778-779`, `welcome.css:430-456` | `WelcomeView.svelte:128-149`, `welcome.css:430-456` | ✅ Match | |
| 12 | Boot gating: first-run web/non-PWA → full tour; configured PWA → splash; active ride → skip; persists "seen" | `workout.js:1223-1283` | `App.svelte:99-140` (`maybeShowWelcome`) | ✅ Match | `hasSeenWelcome` persisted. |
| 13 | No progress dots/step indicator | — | — | ✅ Match | Neither app has one (intentional). |
| — | **(Adjacent) Default workout seeding** | `storage.js:35-42,446-525` (seeds 6) | `WebFileStore.ts` `DEFAULT_WORKOUT_FILES` + seed | ❌→✅ **FIXED** | Separate reported bug ("only the 60-min ones"). See fix C. |

## Fixes applied

### A. Slide transition animation (Symptom 2 — the real bug)
`web/src/ui/WelcomeView.svelte`. Ported `docs/welcome.js:541-603`: animate the
current `.welcome-slide` out toward the travel direction, swap title/body/scene +
arrow visibility at the midpoint, then animate the new slide in from the opposite
edge — 330ms per leg, driving the existing
`welcome-slide--animating-{out,in}-{forward,backward}` CSS. The nav arrows live
outside `.welcome-slide`, so they don't travel (legacy parity).

Gated by `animationsDisabled()`, which checks the element's **computed
`transition-duration`** (not just `matchMedia`): the e2e harness stubs
`matchMedia` and injects `transition:none!important`, so a `matchMedia`-only gate
would leave the sequence awaiting a fallback timer on the harness's *virtual*
clock and never advance. The computed-duration check is `0s` exactly when motion
is off (harness **or** a real reduced-motion user), in which case content swaps
instantly. `isAnimating` guards against interleaved rapid next/prev.

### B. Splash arrow correctness (Symptom 1) + boot reveal
- Restored the legacy splash boot-reveal: a `splashBooting` derived
  (`slide.id==='splash' && textHidden`) drives `welcome-nav-hidden` on
  next/close/prev during the 1000ms text window, so they fade in together
  (legacy `welcome.js:514-528`) instead of popping in instantly.
- The prev arrow stays hidden on the splash via `currentIndex===0`.
- Removed the dead `.welcome-slide--splash .welcome-nav { … welcome-nav-boot }`
  CSS (`web/src/styles/welcome.css`): the nav buttons are **siblings** of
  `.welcome-slide` (both children of `.welcome-shell`), so that descendant
  selector never matched — and its `forwards` fill to `opacity:1` would have
  un-hidden the splash prev arrow had the DOM ever changed. This was the only
  plausible source of a "left arrow on the first page"; it is now gone.

### C. Default workout seeding ("only the 60-min ones")
`web/public/workouts/` shipped only 6 `.zwo` (34-60 min). The legacy app shipped
all **41** as assets in `docs/workouts/`. Copied all 41 into
`web/public/workouts/` and expanded `WebFileStore.DEFAULT_WORKOUT_FILES` to the
full set, so a fresh folder pick seeds the complete library (19-min spins →
120-min endurance + free-rides), not a duration-skewed subset. (Note: legacy
*seeded* only 6 too; seeding the full library is a deliberate improvement over
strict parity, per the explicit request.)

## Seeding robustness follow-up ("Sleepy Spin missing on first load")

After bundling the full library, a default (Sleepy Spin) was intermittently
absent on first load, then present later. Root-caused to seeding bugs that the
6→41 jump exposed:

| Bug | Severity | Fix |
|---|---|---|
| **A. Interrupted seed is permanent.** Seeding bailed the moment *any* `.zwo` existed (`directoryHasAnyZwoFiles`), so a seed cut off partway (tab close / blip) left the folder non-empty → never re-seeded → tail files (Sleepy Spin is ~36/41) stranded. | High (root cause) | `maybeSeedDefaultWorkouts` now gates on a `defaultWorkoutsSeedInProgress` marker set before the pass and cleared only once **all** defaults are present (`allDefaultsPresent`). An interrupted seed resumes + backfills on the next pick; a user's own non-empty library (no marker) is still left untouched. |
| **C. Sequential copy.** 41 awaited fetch+write round-trips = a multi-second interrupt/race window. | Med (enabler) | `copyDefaultWorkoutsToDir` now copies in **bounded parallel** (concurrency 6), idempotent (skips existing → also the backfill path). |
| **B. No library re-sync after folder pick.** `PickerView` reads `listWorkouts()` once on open and caches; `onChooseRootDir` doesn't refresh an already-open picker. | Low–med | Not changed — the picker rescans on each open and `pickRootDir` awaits the (now fast) seed, so the stale window is small. Noted for follow-up. |
| **D. `listWorkouts` returns a partial list on a mid-iteration read error** (swallowed). | Low | Not changed; noted. |

Regression test added: `web-file-store.test.ts` — "resumes an INTERRUPTED seed:
backfills the stranded tail (incl. Sleepy Spin)". The existing "does NOT seed
when the library already has a .zwo" still passes (non-empty + no marker → skip).

## Verification
- **Real animated browser probe** (system Chrome, `reducedMotion:no-preference`):
  clicking Next applies `welcome-slide--animating-out-forward`, the transform
  animates, content swaps mid-sequence, the new slide animates in, and the slide
  settles to a **clean** state (`class="welcome-slide"`, no inline style,
  `transform:none`). Splash screenshot confirms **no left arrow**; only ❯ + ×.
- **Unit:** 473/473 pass (incl. updated `web-file-store` seed-set expecting 41).
- **E2E:** 157/157 pass (incl. welcome visual diff vs legacy baseline + behavior,
  and the seeding defect test now asserting the full library, derived from
  `readSeedWorkouts()`).
- **tsc:** 0 errors. **Build:** clean.
