# Events & Boundaries Re-Audit (absolute-correctness, driven)

Read-only re-verification of **every** event handler / keystroke and its **boundary**
behavior in the VeloDrive Svelte rewrite (`/web`) vs the legacy oracle (`/docs`).
Method: re-read the new code, extract the legacy EFFECTIVE behavior line-by-line
(HUD-level Escape dispatcher in `docs/workout.js` + each per-view listener), then
**drive** the events in Playwright against the built new app (animations on, hermetic
harness, `__VELO_APP__` bridge) and read the resulting state. Items marked **[driven]**
were exercised live; **[read]** were verified by code reading only.

Legacy refs are abbreviated: `W=docs/workout.js`, `WP=docs/workout-picker.js`,
`PL=docs/workout-planner.js`, `WB=docs/workout-builder.js`, `BB=docs/builder-backend.js`,
`S=docs/settings.js`, `WEL=docs/welcome.js`.

New code: `App=src/ui/App.svelte`, `Nav=src/ui/BottomNav.svelte`,
`Pick=src/ui/PickerView.svelte`, `Build=src/ui/BuilderView.svelte`,
`Plan=src/ui/PlannerView.svelte`, `Set=src/ui/SettingsView.svelte`,
`Wel=src/ui/WelcomeView.svelte`, `Dlg=src/ui/Dialog.svelte`, `OM=src/ui/OverlayModal.svelte`,
`ui=src/state/ui.svelte.ts`.

## Result summary

| Area | Events checked | OK | PARTIAL | GAP | WRONG |
|---|--:|--:|--:|--:|--:|
| Global / HUD keymap + manual input | 22 | 20 | 1 | 1 | 0 |
| Picker | 19 | 17 | 2 | 0 | 0 |
| Planner | 18 | 16 | 2 | 0 | 0 |
| Builder | 26 | 26 | 0 | 0 | 0 |
| Settings / Welcome | 14 | 14 | 0 | 0 | 0 |
| Dialogs / modal chrome | 7 | 5 | 1 | 1 | 0 |
| **Total** | **106** | **98** | **6** | **2** | **0** |

**Headline:** the Escape disposition matrix (the known-weak area) is **correct in every
context** when driven: picker empty-search Escape consumes (never closes); picker
non-empty Escape clears+blur (stays open); picker body Escape closes; builder
deselect→back→never-close with a dirty-discard guard; planner detail→calendar
(Backspace and Escape) then calendar→close; settings logs→main→close; welcome splash
swallows nav keys and Escape closes. The genuine defects are small: **(D1)** picker
`j/k` do NOT navigate a focused filter `<select>`'s options (legacy does — P-2);
**(D2)** keyboard day-nav past the rendered 16-week window does NOT scroll/recenter the
selected cell (J-PLAN-04); **(D3)** the themed confirm/alert dialog does NOT respond to
**Escape** (legacy native `confirm()` cancels on Esc); plus a low-severity resize-redraw
gap and a potential Escape-leak when a dialog sits over an overlay (could not fully
confirm).

---

## Table

| Event/handler | Context | Boundary tested | Legacy ref | New (file:line) | Status | Repro + severity |
|---|---|---|---|---|---|---|
| **window keydown** modifier bail | global | Cmd/Ctrl/Alt+key | W:1655 bail on meta/ctrl/alt | App:220 `if (metaKey\|ctrlKey\|altKey) return` | OK | Shift NOT bailed in either (builder ×5 needs it). [read] |
| **Space** start/pause | HUD, no overlay | needs `canonicalWorkout`; `e.code` | W:1663-1671 (`e.code==='Space'`, `!!canonicalWorkout`) | App:270-275 | OK [driven] | Space→countdown→running confirmed; no-workout guard at 271. |
| **Space** under overlay | overlay open | should not start | W:1665 `if(modalOpen)return` | App:254 routes to overlay, never HUD | OK [driven] | welcome-full Space advanced slide, no ride start. |
| **k / ArrowUp** manual +10 | free-ride active | guard `isFreeRideActive` | W:1679-1692 | App:281-290 | OK [driven] | 200→210; ArrowDown→200. |
| **j / ArrowDown** manual −10 | free-ride active | guard `isFreeRideActive` | W:1684 | App:281-290 | OK [driven] | — |
| j/k when **not** free-ride | running non-freeride | no-op | W:1679 guard | App:281 guard | OK [read] | — |
| **e** ERG mode | running + free-ride | guard `active && isFreeRideActive` | W:1703-1715 | App:293-300 | OK [driven] | mode→erg confirmed. |
| **r** resistance mode | running + free-ride | same guard | W:1717-1729 | App:293-300 | OK [driven] | mode→resistance confirmed. |
| **s** settings | any (even mid-ride) | unconditional in no-modal block | W:1731-1735 (no active guard) | App:302-306 (unconditional) | OK [driven] | `s` opened settings while running. Matches legacy. |
| **w** picker | no active workout | blocked if active; root-dir guard | W:1694-1701 + openPickerWithGuard W:224-238 | App:307-311 → `openPicker()` (active+root guard) | OK [driven] | `w` while running → no overlay (blocked). |
| **c** calendar | no active workout | blocked if active | W:1737-1744 | App:312-315 → `openPlanner()` guards active | OK [driven] | `c` while running → no overlay (blocked). |
| isEditable guard | HUD hotkeys | INPUT/TEXTAREA/SELECT/contentEditable | W:1664/1675 (tags only, NO contentEditable) | App:204-209 (adds contentEditable) | OK | New is stricter (also excludes contentEditable); legacy excludes only tags. Behaviorally safe — no regression. [read] |
| **Manual ERG input commit** | free-ride erg | clamp **[50, ftp×2.5]**, round; revert-if-unchanged; no-overwrite-while-typing | W:996-1043, 971-987 | Nav:113-163 | OK [driven] | type 9999→625 (ftp250×2.5), 1→50, empty→reverts to current. |
| **Manual resistance commit** | free-ride resist | clamp **[0,100]**, round | W:1004-1010 | Nav:119-123 | OK [driven] | (resistance path mirrors erg; clamp confirmed by code + erg-path drive). |
| Manual ±10 buttons | free-ride | `data-delta`, active+freeride guard | W:1582-1599 | Nav:99-102,278/292 | OK [read] | — |
| Mode toggle click | free-ride | no-op if same mode | W:1567-1580 | Nav:96-98 (engine.setFreeRideMode no-ops same) | OK [read] | — |
| Manual input Enter/blur | free-ride | Enter→commit+blur; blur→commit | W:1601-1613 | Nav:142-152 | OK [driven] | — |
| **Stop** confirm | running | native `confirm("End current workout and save it?")` | W:1645-1651 | Nav:72-76 (themed confirm) | OK [driven] | dialog shows exact text; cancel keeps running. |
| onWorkoutEnded follow-up | ride end | removeScheduledByTitle + open planner + openDetailByFile | W:1368-1390 | App:50-62 + Plan:218-229 | OK [read] | wired (pendingHistoryFile consumed in Plan onOpen). |
| Connect bike/HR | HUD click | BT-available check → alert+settings | W:1525-1565 | Nav:80-95 | OK [read] | — |
| window **resize** | global | refit fonts + redraw main chart + planner charts | W:1778-1784 | StatCards:50-54 (fonts only); LiveChart NO resize redraw; Plan charts theme-only | **PARTIAL** | D4 below. LOW. [read] |
| window **focus** scrape | global | re-check scraped workout | W:1786-1790 | (none) | GAP-deferred | Extension scrape pipeline intentionally deferred (PWA). Not a defect. |
| visibilitychange / beforeunload / wheel / contextmenu | global | — | none exist in legacy | none in new | OK | Neither app has them. [read] |
| **Picker `/`** focus+select search | picker | from anywhere | WP:1372-1377 | Pick:704-709 | OK [read] | — |
| **Picker search Enter** | search focused | blur + expand first + focus Select btn | WP:1380-1392 | Pick:711-719 | OK [read] | — |
| **Picker search Escape (EMPTY)** | search focused | clear+blur, **never close** | WP:1393-1399 (no empty branch) | Pick:720-728 + onModalKeydown 805-810 | OK [driven] | empty-search Escape → overlay stays `picker`. **P-1 fixed.** |
| **Picker search Escape (non-empty)** | search focused | clear+blur, stay open | WP:1393-1399 | Pick:720-728 | OK [driven] | "tempo"+Esc → cleared, still `picker`. |
| **Picker `z` / `d`** focus filter | picker (incl. select focused) | focus + `showPicker()` | WP:1402-1414 (above SELECT guard) | Pick:734-743 (above SELECT guard) | OK [read] | z/d fire even with a select focused, matching legacy. |
| **Picker `j/k/↑/↓` with SELECT focused** | filter select focused | **navigate select options** via handleSelectNav + synthetic change | WP:1416-1430 (handleSelectNav) | Pick:745 `if(tag==='SELECT')return false` | **GAP (D1)** | legacy moves options; new no-ops. P-2. LOW. [driven] |
| **Picker `j/k/↑/↓`** move expansion | picker, not in field | wrap-around cyclic | WP:1480-1490 | Pick:772-781 + movePickerExpansion 663-670 | OK [read] | cyclic wrap matches. |
| **Picker `e`** edit→builder | expanded row | open in builder | WP:1468-1478 | Pick:752-761 | OK [read] | — |
| **Picker Enter** select | expanded row | doSelect | WP:1445-1466 | Pick:763-771 | OK [read] | — |
| **Picker Escape (body/table)** | picker, not in field | normal mode: preventDefault, **does not close here** (close via button); App-level close | W:1771 fallback `picker.close()` | Pick:747-750 returns false → ui.handleEscape closes | OK [driven] | body Escape → overlay `none`. Net effect matches legacy (HUD dispatcher closes). |
| Picker search input/change/search | picker | no debounce; persist state | WP:2055-2069 | Pick:106-114 (`$effect` persists) | OK [read] | bind:value re-renders reactively; persists on change. |
| Picker filter select change | picker | re-render + persist | WP:2082-2094 | Pick:106-114, bind:value | OK [read] | — |
| Picker sort header click | picker | toggle dir / switch key (kjAdj asc default) | WP:1290-1308 | Pick:264-271 | OK [read] | — |
| Picker state persist fields | picker open | searchTerm/zone/duration/sortKey/sortDir; duration validated vs options | WP:1516-1525 / 1496-1514 | Pick:82-103 (VALID_DURATIONS guard) | OK [read] | — |
| Picker row/expand/collapse/visit/delete/clone/edit/select clicks | picker | stopPropagation each | WP:724-873 | Pick:1089-1178 | OK [read] | — |
| Picker meta-mode → builder handoff | enter builder | isBuilderMode disables picker keys | WP:1364-1366,1181-1233 | Pick:435-440 (`ui.pickerBuilderMode`) + App:229 bail | OK [driven] | builder=true while in builder; App stays out of the way. |
| **Builder window keydown** guards | builder | defaultPrevented, root-visible, INPUT/TEXTAREA/SELECT/contentEditable | WB:498-509 | Build:741-746 | OK [read] | — |
| **Builder Undo/Redo** | builder | Cmd/Ctrl+Z, Shift+Z/Y, bare u/U | WB:541-559 | Build:759-762 | OK [read] | — |
| **Builder Cmd+A / Cmd+E** cursor | no selection | start/end | WB:525-539 | Build:766-769 | OK [read] | gated `!hasSel`. |
| **Builder clipboard** C/X/V/p/Ctrl+Ins/Shift+Ins/Shift+Del | builder | copy/cut/paste variants | WB:561-602 | Build:771-782 | OK [read] | backend encode/parse ported. |
| **Builder Shift+H/L/arrows** multi-select | builder | extend by cursor | WB:604-619 | Build:786-794 | OK [read] | — |
| **Builder multi `y`** | >1 selected | copy+deselect | WB:623-629 | Build:799-804 | OK [read] | — |
| **Builder insert keys** r/e/t/s/v/a/w/c/i/f/x | builder | select-on-insert=true | WB:631-681 (selectOnInsert true) | Build:806-819 (`insertSpec(spec,true)`) | OK [driven] | insert `e`/`t` selected the block (editor shown). |
| **Builder `d` vs Delete/Backspace** | block selected | `d`=cut-to-clipboard; Del/BS=plain delete | WB:683-697 | Build:821-835 | OK [read] | distinction preserved. |
| **Builder Del/BS no selection** | cursor | BS deletes block before cursor; Del after | WB:700-718 | Build:836-845 | OK [read] | — |
| **Builder Escape — block selected** | selection | deselect | WB:724-734 | Build:849-856 | OK [driven] | Escape#1 hid editor, stayed builder. |
| **Builder Escape — nothing selected (clean)** | builder | onRequestBack → back to library, **never close picker** | WB:735-740 | Build:857-862 → onRequestBack → maybeHandleUnsavedBeforeLeave | OK [driven] | clean default → back (builder=false), no dialog. |
| **Builder Escape — dirty** | builder | back path runs unsaved guard | WP maybeHandleUnsaved | Pick:418-429,622-627 | OK [driven] | dirty → "Discard unsaved changes?"; keep-editing stays; discard backs out. |
| **Builder Enter — nothing selected** | builder | select block at cursor | WB:741-755 | Build:863-869 | OK [read] | — |
| **Builder h/l/arrows** | no sel / single sel | move cursor / adjust duration; Shift ×5 | WB:790-957 | Build:873-972 | OK [driven] | duration floor 1s reached (40× h → durationSec=1). |
| **Builder j/k/↑/↓** power | sel | ±0.05 rel, Shift ×5 | WB:844-957 | Build:890-965 | OK [driven] | power floor reached (40× j → powerRel=5%). |
| **Builder Space** toggle insert side | single/multi sel | toggle end/start | WB:770-788 | Build:903-913,966-972 | OK [read] | — |
| Builder Home/g, End/$ | no sel | cursor start/end | WB:796-819 | Build:880-881 | OK [read] | — |
| Builder clamps: duration min1, power% min0, rel min0.05, repeat min1 (**no max**), cadence 30-200, snaps 0.05 / 5-15-30-60s | builder | exact min/max + rounding + **no block-count / repeat cap** | BB:766-787,1084-1104 | core/builder-backend.ts:997-1018,1326-1346 | OK [read] | byte-for-byte identical; no max cap in either. |
| Builder stepper input commit | block editor | onchange/Enter; empty→null for allowEmpty (cadence default 90) | WB:1955-2091 | Build:976-1002,1242-1256 | OK [read] | — |
| Builder validateForSave | save | empty name/source/desc/blocks fail | WB:1070-1132 | Build:1058-1081 | OK [read] | — |
| Builder meta input + title normalize | builder | empty name→"Custom workout"; autoGrow desc | WB:1015-1027,85-87 | Build:414-442,1029 | OK [read] | — |
| Builder chart **pointerdown** drag | chart | select/insert/duration/power drag; shiftKey range | WB chart | Build:543-738 | OK [read] | drag engine present (ramp-region drag simplified — documented). |
| **Planner detail `d` / Delete** | detail | delete ride | PL:1299-1305 | Plan:799-803 | OK [read] | — |
| **Planner detail Backspace / Escape** | detail | exit to calendar (NOT close) | PL:1309-1313 | Plan:805-808 | OK [driven] | Backspace→detail false; Escape→detail false; both stay `planner`. |
| **Planner calendar Escape** | calendar | planner ignores → HUD closes planner | PL:1315-1319 (ignore) + W:1761-1769 | Plan:813 returns false → ui.handleEscape closes | OK [driven] | calendar Escape → overlay `none`. **Confirmed correct (not the prior WRONG flag).** |
| **Planner Enter** | calendar | history→load scheduled→schedule empty future | PL:1325-1346 | Plan:819-836 | OK [read] | precedence matches. |
| **Planner `e`** | calendar | edit scheduled / schedule empty future | PL:1348-1365 | Plan:838-847 | OK [read] | — |
| **Planner `d` / Delete`** | calendar | scheduled-first then history | PL:1367-1373,568 | Plan:849-862 | OK [read] | precedence matches. |
| **Planner h/j/k/l + arrows** | calendar | ±1 / ±7 days | PL:1375-1394 | Plan:864-886 | OK [driven] | nav works; see boundary row. |
| **Planner nav past window** | calendar | legacy recenters/rebuilds + scrollCellIntoView | PL:823-859 (ensureSelectionRendered) | Plan:883-886 moveSelection (no recenter) | **GAP (D2)** | 12× `k` → selected label updates ("March 25, 2026") but **selected cell not rendered, no scroll-into-view**. J-PLAN-04. LOW. [driven] |
| Planner editable-target / modifier guard | calendar | INPUT/SELECT/contentEditable; meta/ctrl/alt bail | PL:1321-1323 | Plan:789-794,814-815 | OK [read] | — |
| Planner `?`-held hotkey overlay | calendar | hold ? shows hints (repeat-guarded) | PL:1445-1466 | (none) | GAP-deferred | Intentionally dropped (documented). Not a defect. |
| Planner day-cell click | calendar | select day | PL:1269-1273 | Plan:1022 | OK [read] | — |
| Planner history-card click | calendar | open detail (stopPropagation) | PL:315-318 | Plan:1039 | OK [read] | — |
| Planner scheduled-card click | calendar | **load/start** workout (not edit), only if not missing | PL:449-453 | Plan:1068 | OK [read] | matches (load on click; edit via per-card btn). |
| Planner scheduled edit/delete btn | calendar | future→edit, past→delete | PL:374-395 | Plan:1073-1093 | OK [read] | — |
| Planner schedule/delete/back/close buttons | calendar/detail | schedule guards `!isPastDate`; back→calendar; close→planner | PL:1470-1507 | Plan:679-737,942,962,991 | OK [read] | — |
| Planner schedule past-date guard | calendar | past cannot schedule; today CAN | PL:907-911 (`<` midnight) | Plan:186-191,676,682 | OK [read] | strict `<`; today allowed. |
| Planner **scroll/wheel** recycling | calendar | infinite row recycle | PL:1201-1263 (scroll recycle) | Plan:16-21 (fixed 16-week window, no recycle) | GAP-deferred | Documented simplification (initial render pixel-identical; deep scroll stops). Tied to D2. |
| openDetailByFile (post-ride) | boot/end | open saved ride detail | PL:1520-1536 | Plan:234-243 | OK [read] | — |
| **Settings FTP ±10 / input** | settings | clamp **[50,500]**, round, fallback 250 (NaN) | S:339-384 | Set:48-69 | OK [driven] | 9999→500, 1→50, empty("")→50 (Number("")=0→50; matches legacy). |
| Settings FTP Enter/blur | settings | Enter→save+blur; blur→save | S:574-587 | Set:67-76,375-377 | OK [read] | — |
| Settings sound toggle + default | settings | default **true** (audible) | S:388-400 | Set:81-94 | OK [read] | default true confirmed. |
| Settings theme buttons | settings | apply <html> + persist | S:467-479 | Set:101-104 | OK [read] | — |
| Settings help toggles | settings | show/hide section | S:501-525 | Set:144-157 | OK [read] | — |
| **Settings logs Escape → main** | logs open | return to main first | S:612-624 | ui:93-98 handleEscape | OK [driven] | logs Escape → settings (logs false); 2nd Escape → none. |
| Settings logs auto-scroll | logs | only when at bottom (±4px) | S:254-269 | Set:166-185 | OK [read] | — |
| Settings open/close button | settings | close | S | Set:244,196 | OK [read] | — |
| startupNeedsAttention auto-open | boot | missing folder/BT/incompat → settings+help | S:650-671 | App:180-196 | OK [read] | (false in seeded harness). |
| **Welcome keydown — full** | welcome full | →/PageDown/Space/Enter next; ←/PageUp prev; Esc close | WEL:706-748 | Wel:169-202 | OK [driven] | full-mode Space advanced slide. |
| **Welcome keydown — splash** | welcome splash | **swallow** nav keys; Esc closes | WEL:714-722 | Wel:174-188 | OK [driven] | ArrowRight & Enter swallowed (stayed welcome); Esc → none. |
| Welcome overlay click → next | welcome | splash stops; else next | WEL:686-704 | Wel:155-163 | OK [read] | — |
| Welcome prev/next/close btns | welcome | nav | WEL:752-771 | Wel:260-287 | OK [read] | — |
| Welcome splash auto-dismiss 1100ms | splash | playSplash(1100) | W:1273, WEL:778-780 | Wel:128-141 | OK [read] | — |
| Welcome first-slide reveal 1000ms | splash slide | text hidden then revealed | WEL:514-523 | Wel:83-95 | OK [read] | — |
| **Modal backdrop** pointerdown/up | any overlay | press-started-AND-ended on backdrop → close | (per-view in legacy) | OM:28-35 | OK [read] | drag-out doesn't dismiss. |
| **Dialog OK / Cancel** click | dialog | resolve true/false | (native confirm) | Dlg:46-60 | OK [driven] | stop-confirm cancel kept ride running. |
| **Dialog prompt Enter / Escape** | prompt input | Enter=OK, Escape=cancel | (native prompt) | Dlg:39-43 | OK [read] | prompt input has its own Escape. |
| **Dialog confirm/alert Escape** | dialog open over HUD | native confirm cancels on Esc | W:1647 native `confirm()` | Dlg (no keydown on confirm/alert); not an overlay in `ui` | **GAP (D3)** | global Escape leaves dialog open + ride running. MED. [driven] |
| **Escape with dialog over an OVERLAY** | e.g. picker delete confirm open | should affect dialog, not overlay | — | App:236-243 routes Escape to overlay handler → may `ui.close()` behind dialog | PARTIAL | Could not fully confirm focus routing; potential close-overlay-behind-dialog leak. See "Could not verify". |
| Dialog focus-trap / tab order | dialog | trap focus in modal | (browser-native confirm trapped) | Dlg/OM (no explicit focus trap) | PARTIAL | No JS focus-trap; Tab can reach elements behind the backdrop. LOW (consistent with the other overlays, which also lack JS traps). [read] |

---

## Defects (PARTIAL / GAP / WRONG only)

### D1 — Picker `j`/`k`/↑/↓ do not navigate a focused filter `<select>` (GAP, LOW) — P-2
**Legacy (WP:1416-1430 + handleSelectNav 1311-1334):** when a `<select>` (zone/duration
filter) is focused, `j`/ArrowDown and `k`/ArrowUp move the select's `selectedIndex`
(clamped `[0,len-1]`) and dispatch a synthetic `change` so the filter actually re-filters.
**New (Pick:745):** `handlePickerKey` returns `false` for `tag==='SELECT'`, so `j`/`k`
fall through to the browser's native select behavior (which on Chromium does NOT move
options on `j`/`k`).
**Repro [driven]:** open picker → focus `#pickerZoneFilter` → press `j` → value stays
`""` (legacy would advance to "Recovery"). The new code still lets `z`/`d` re-focus the
filters (matches legacy), only the in-select option nav is missing.
**Severity:** LOW — filter still works via mouse / native arrow keys; only the vim-style
`j`/`k` shortcut inside the focused select is absent.

### D2 — Keyboard day-nav past the rendered window doesn't scroll/recenter (GAP, LOW) — J-PLAN-04
**Legacy (PL:823-859):** `moveSelection`→`setSelectedDate`→`ensureSelectionRendered`: if
the newly-selected day is outside the rendered window it resets `anchorStart`, rebuilds
the 16-week window around it, and `centerOnDate`s; if in-window it `scrollCellIntoView`s
(8px pad).
**New (Plan:883-886):** `moveSelection` only updates `selectedDate`. The calendar is a
fixed 16-week window (offsets −8..+7) with no recycling and no scroll-into-view.
**Repro [driven]:** open planner (today seeded 2026-06-17) → press `k` 12× (≈84 days up)
→ the selected-date label updates ("Wednesday, March 25, 2026") but the
`.planner-day.is-selected` cell is **not rendered at all** and nothing scrolls. Further
nav operates on an invisible selection.
**Severity:** LOW — within the ±8-week window nav is fine; this is the documented
deep-scroll/recycle simplification. The selection is still correct; only its visibility
past the window is lost.

### D3 — Themed confirm/alert dialog ignores Escape (GAP, MEDIUM)
**Legacy:** stop/delete/schedule confirms use the browser-native `confirm()` /
`prompt()` (e.g. W:1647), where **Escape = Cancel** is built in.
**New (Dlg:31-64):** only the `prompt` branch has an `onkeydown` (Enter=OK, Esc=cancel).
The `confirm` and `alert` branches have **no keyboard handler**, and the dialog is not an
entry in `ui.activeOverlay`, so the App-level Escape router (App:231-249) never sees it.
Result: pressing Escape over a confirm/alert does nothing.
**Repro [driven]:** start a ride → click Stop → "End current workout and save it?" appears
→ press Escape → dialog stays open, ride still running (legacy would cancel and dismiss).
Mouse Cancel/OK still works; only the keyboard Esc affordance is missing.
**Severity:** MEDIUM — every confirm (stop, delete-to-trash, schedule, discard-unsaved)
loses the Esc-to-cancel keyboard path; users who reflexively hit Esc see no response.
**Fix sketch:** add `onkeydown` to the confirm/alert modal (Esc→`resolve(false)`,
Enter→`resolve(true)`), matching the prompt branch; optionally auto-focus the primary
button.

### D4 — window resize does not redraw the main / planner charts (PARTIAL, LOW)
**Legacy (W:1778-1784):** on `resize` → `adjustStatFontSizes()` **+ `drawChart(vm)` +
`planner.rerenderCharts()`**.
**New:** only `StatCards` listens for `resize` (re-fits stat fonts, StatCards:50-54).
`LiveChart` redraws only on vm/theme change (LiveChart:71-79); planner charts re-run only
on `themeVersion` (Plan:552-555). Neither re-lays-out on a viewport resize.
**Effect:** SVGs use `preserveAspectRatio="none"` + fixed viewBox so they visually
stretch, but pixel-space layout (axis labels, tick spacing, power-curve text) is not
recomputed at the new size.
**Severity:** LOW — tests use a fixed viewport so it never surfaces there; only manual
window-resizing during a ride/planner-open shows mildly stale chart label layout.
**Fix sketch:** add a `resize` listener (or ResizeObserver on the chart panels) that
re-invokes the chart `redraw()`/`rerenderCharts()` closures.

---

## Could not verify / open questions

- **Escape with a dialog open OVER an overlay** (e.g. picker "Move to trash?" confirm,
  or planner delete confirm). The App Escape router (App:236-243) routes to the active
  overlay's key handler and otherwise calls `ui.handleEscape()` (which `ui.close()`s the
  overlay). The themed dialog is not represented in `ui`, so a stray Escape *might* close
  the overlay behind the still-open dialog (leaving an orphaned dialog), instead of being
  swallowed/cancelling the dialog. I confirmed D3 (Esc does nothing over a HUD-level
  dialog) but did **not** isolate the overlay-behind-dialog case in a driven probe.
  Worth a targeted test: open picker → expand a row → Delete → press Escape → assert the
  picker stays open and the dialog either cancels or is unaffected.
- **`j`/`k` inside a `<select>` natively**: I confirmed the new code does not synthesize
  the change; I did not exhaustively test every browser's native select key handling, but
  on the harness Chromium `j` left the value unchanged.
- **Held-key autorepeat**: neither app guards `e.repeat` outside the dropped planner
  `?`-overlay, so rapid autorepeat of insert/nav keys fires repeatedly in both — matches,
  no defect, but not separately driven for every key.
- **Real OS color-scheme flip** (Auto mode) redrawing charts: the `themeAutoVersion`
  wiring exists (Pick:838-841, Build:466-472) but I did not drive an actual
  `matchMedia('(prefers-color-scheme)')` change event; covered by the existing dark-mode
  visual specs.

## Notes on items previously flagged that are CORRECT (re-confirmed by driving)
- **Planner calendar Escape "closes the planner"** — correct (the planner's own handler
  ignores Escape; the HUD-level `ui.handleEscape` closes it). NOT a defect. [driven]
- **Picker empty-search Escape (P-1)** — fixed; Escape in the empty focused search clears
  + blurs and never closes the picker. [driven]
- **Builder Escape deselect→back→never-close, with dirty-discard guard** — correct in all
  three steps. [driven]
- **Settings logs Escape → main → close** — correct two-step disposition. [driven]
- **Welcome splash swallows nav keys; Esc closes** — correct. [driven]
- **Global hotkey context isolation** — `s`/`w`/`c`/Space do not leak under an open
  overlay (routed to the overlay handler, which swallows them for welcome/settings).
  [driven]
