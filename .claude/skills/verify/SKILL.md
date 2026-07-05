---
name: verify
description: How to build, launch, and drive VeloDrive (web PWA + Tauri shell) to verify changes end-to-end.
---

# Verifying VeloDrive changes

## Web UI (most changes)

The e2e harness runs the real built app hermetically (fake FS + BLE, seeded
planner history at 2026-06-15, deterministic viewport):

```bash
cd web
npx playwright test <spec>            # builds dist + serves on :4179 automatically
```

To drive an ad-hoc flow, drop a temporary `*.new.spec.ts` in `web/tests/e2e/`
(testMatch requires the `.new.spec.ts` suffix), import
`{test, expect, reachNewRidingView, PLANNER_HARNESS_CONFIG} from "./fixtures.js"`,
and delete it afterwards. `page.screenshot()` for evidence. After UI settles,
call `__VELO_HARNESS__.settle()` (see planner.new.spec.ts for the pattern).

## Native shell (src-tauri)

Plain `cargo build` produces a DEV-mode binary that loads http://localhost:5173.
For a self-contained binary, build the web dist first, then:

```bash
cd web && npx vite build
cd ../src-tauri && cargo build --features custom-protocol
# binary: src-tauri/target/debug/velodrive
```

No Xvfb/xdotool on this machine, but the user's session is live. Launch on
XWayland so X tools work: `GDK_BACKEND=x11 DISPLAY=:0 ./velodrive`
(a window appears on the user's screen — keep it brief).

- Find the window / send a graceful close (WM_DELETE_WINDOW) with python-xlib
  (`pip install --user python-xlib`); match `_NET_WM_PID` from
  `_NET_CLIENT_LIST`. A working harness that also times close→exit lives at
  scratchpad `close_timer.py` in past sessions — recreate from that pattern.
- Screenshot an XWayland window with ImageMagick: `import -window <id> out.png`.
- SIGTERM/SIGKILL bypass Tauri's `ExitRequested` handler — only the WM close
  path exercises exit code.
- The app uses the real profile dir (~/.local/share/bike.velodrive.VeloDrive)
  and the real BT adapter; no trainer/HRM hardware is available, so
  connected-device BLE paths can't be driven — say so rather than faking it.

## Gotchas

- `npm run check` (svelte-check) has ~24 pre-existing errors; `npm run
  typecheck` (tsc) is clean — don't attribute svelte-check noise to a change.
- Unit tests: `cd web && npm test` (vitest; chart tests are render-locked
  snapshots under happy-dom).
