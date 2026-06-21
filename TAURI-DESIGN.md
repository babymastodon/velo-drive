# VeloDrive → Native (Tauri) — Design Sketch

Status: **draft for review (rev 2).** High-level shape and decisions — not an
implementation spec. Goal: ship VeloDrive as a native app on **Linux, macOS,
Windows, iOS, and Android**, keeping the existing Svelte web app as the single
frontend and continuing to ship the PWA at velodrive.bike.

**Build order:** **Linux first**, but every architectural decision below is made to
be cross-platform so the later targets are additive, not rewrites (see §3).

## Decisions locked in (your answers)

| # | Decision |
|---|---|
| BLE library | **btleplug** — the most widely-supported cross-platform Rust GATT lib (Win/macOS/Linux/iOS/Android). |
| Platforms | **All five eventually**; **Linux is target #1**. |
| Persistence | **Keep IndexedDB** for settings/active-ride/caches (works in all Tauri webviews). |
| PWA | **Keep** the PWA + website from the same frontend. Chrome extension already removed. |
| Mobile background | **Foreground / screen-on is fine for v1** (no iOS background-BLE / App-Review complexity yet). |
| Effort | Committed to all platforms over time; Linux MVP validates the approach first. |
| Linux packaging | **Flatpak**, with Bluetooth (BlueZ) sandbox permission. |
| Updates | **Via a Flatpak repo** (Flathub or self-hosted). |
| Bundle id | **`bike.velodrive.app`**. |
| Repo layout | **`src-tauri/` at the repo root** (siblings: `web/`, `src-tauri/`, `docs/`). |

---

## 1. Why this is tractable

The app is layered, with two platform seams that already isolate everything a
native shell would change:

```
core/   pure TS (engine, zwo/fit codecs, metrics, chart) — no platform APIs
ports/  TrainerTransport (BLE)  +  FileStore (files/persistence)  ← the seams
state/  Svelte signals
ui/     Svelte components
```

A native build adds a **second** implementation of those two interfaces, backed by
Rust, and selects it at boot. **Nothing in `core/`, `state/`, or `ui/` changes**;
`app/app.ts` already injects the ports.

## 2. The core constraint (the whole reason for this doc)

Tauri renders through the OS webview: **WebKitGTK** on Linux, **WKWebView** on
macOS/iOS, **WebView2 (Chromium)** on Windows, **Android System WebView**. None
reliably expose **Web Bluetooth** or **File System Access**, so those two ports
must be bridged to native Rust. Almost everything else already works in the webview:

| Capability we use | In a Tauri webview | Plan |
|---|---|---|
| **Web Bluetooth** (FTMS, HR) | ❌ Not available | **Native bridge over btleplug** — §4 |
| **File System Access** (workout folder) | ❌ Not available | **Native bridge: Tauri fs + dialog** — §5 |
| **IndexedDB** (settings, active ride, caches) | ✅ Works & persists | **Keep** (§5) |
| **Web Audio** (beeps) | ✅ Works | Keep |
| `matchMedia`, `MutationObserver` (theme) | ✅ Works | Keep |
| **Screen Wake Lock** | ⚠️ Unreliable on WebKit | Native keep-awake — §6 |
| `fetch` to TrainerDay (import) | ⚠️ CORS in browser | **Native HTTP — becomes a win** — §6 |
| Service Worker / PWA install | ✅ but redundant natively | Keep for the PWA; off in the native shell |
| Clipboard, `navigator.onLine`, timers | ✅ Works | Keep |

Net: the port is **two native bridges (BLE + files)** + a couple of small natives.

## 3. Cross-platform guardrails (Linux first, but don't corner ourselves)

Because Linux ships first yet all five platforms are the goal, we hold these rules
from day one:

- **BLE only through btleplug** — never a Linux-only BLE path. btleplug already
  abstracts BlueZ / CoreBluetooth / WinRT / Android, so the Rust bridge we write on
  Linux is the same bridge everywhere.
- **Device identity is an opaque token, not a MAC.** Native peripheral ids differ
  per OS (MAC on Linux/Windows, an opaque per-app UUID on Apple). Persist
  `{ platformTag, opaqueId, name }` so reconnect logic is identical across OSes and
  the stored format never needs a breaking change. (Maps cleanly onto today's
  `lastBikeDeviceId` / `lastHrDeviceId`.)
- **All file access via Tauri's path APIs**, never POSIX-only assumptions.
- **Keep the `FileStore` settings seam swappable.** We keep IndexedDB, but settings
  go through `getSetting/putSetting` only — so if a future webview (e.g. WKWebView
  storage eviction) disappoints, we can drop in a native store on *that* platform
  without touching any caller.
- **One frontend build** drives PWA and all native shells; platform behaviour lives
  behind the ports, selected at boot — so "works on Linux" generalises.

## 4. Bluetooth — the crux

What the native bridge must reproduce (from today's `TrainerTransport`):

- Connect a **trainer** (FTMS `0x1826`) **and** a **heart-rate monitor** (`0x180d`)
  — **two devices at once**.
- Subscribe to **notifications**: Indoor Bike Data (`0x2ad2`) for power/cadence/
  speed, HR Measurement (`0x2a37`), Battery (`0x2a19`).
- **Write** the FTMS Control Point (`0x2ad9`): requestControl, startOrResume,
  setTargetPower (ERG), setTargetResistanceLevel.
- **Reconnect** a known device on launch without a user gesture.
- Stream samples / status / logs back to the UI as events.

### Design

A **Rust BLE module built on [`btleplug`](https://github.com/deviceplug/btleplug)**,
exposed to the webview via **Tauri commands** (connect / disconnect / write) and
**Tauri events** (samples / status / disconnect). A thin
`ports/native/NativeTrainerTransport.ts` implements the existing interface over that
IPC. btleplug natively supports scan-with-service-filter, **multiple simultaneous
peripherals**, notification subscriptions, write with/without response, and
disconnect events — i.e. everything the interface needs.

We write our **own thin bridge** (rather than depending on a higher-level wrapper)
so the IPC maps 1:1 onto our `TrainerTransport` and we own the reconnect/identity
behaviour. The one place we'll revisit a wrapper:
[`tauri-plugin-blec`](https://github.com/MnlPhlp/tauri-plugin-blec) wraps btleplug
*and* solves Android's Rust/Java (JNI) build — worth adopting **specifically for
the Android target later**. On Linux (and the other desktops) the plain btleplug
bridge needs no JNI, so Linux-first carries no Android tax.

### Per-platform BLE notes (validate as each target lands)

- **Linux (now):** btleplug → BlueZ over D-Bus; needs `bluetoothd` running and, for
  *local dev builds*, the system `dbus-devel`/`libdbus-1-dev` + `pkg-config` (the
  Flatpak build bundles these). The Flatpak sandbox gets BLE via
  `--system-talk-name=org.bluez`.
- **Windows:** WinRT BLE has known connect/discovery/caching quirks; some trainers
  want OS-level pairing — needs hardening.
- **macOS/iOS:** CoreBluetooth; `NSBluetoothAlwaysUsageDescription` + proper bundle/
  entitlement; opaque peripheral UUIDs (handled by the identity guardrail).
- **Android:** runtime `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`; use the blec plugin for
  the JNI build.

## 5. Files & persistence

`FileStore` manages a user-picked **VeloDrive/** folder
(`workouts/*.zwo`, `history/*.fit`, `trash/`) plus settings in IndexedDB.

- **Folder + file I/O →** Tauri **fs** + **dialog** plugins (native folder picker,
  path-based read/write) with **persisted-scope** so the chosen folder stays
  authorized across launches. `ports/native/NativeFileStore.ts` implements the same
  interface over paths instead of `FileSystemDirectoryHandle`s. The seeding /
  trash / stats-cache logic is pure and moves over unchanged.
- **Settings / active-ride / caches →** **keep IndexedDB** (per your call; works and
  persists in all Tauri webviews), behind the swappable seam from §3.

## 6. Smaller natives

- **Keep-awake:** replace Web Wake Lock with a native keep-display-awake call,
  behind the existing `wake-lock.ts` seam. Foreground-only (v1) keeps this simple.
- **TrainerDay import:** fetch via Rust → **no CORS**, so the URL import that's
  fragile in the browser just works natively. A real upgrade.
- **Audio, theme, clipboard, charts, engine:** unchanged.

## 7. Codebase shape

```
web/            the Svelte app (frontend) — unchanged; still ships as the PWA
  src/ports/native/   NativeTrainerTransport.ts, NativeFileStore.ts  (new, thin)
src-tauri/      Rust shell: btleplug BLE module, fs glue, Tauri commands/events
```

- **One frontend, two shells.** Same `web/` build serves the PWA and the Tauri app.
  Boot picks the port implementation: Tauri IPC present → native ports; else → web
  ports. `app/compat.ts` is the natural place for the switch.
- The hermetic test harness (fake clock/FS/BLE) already abstracts the platform, so
  unit/e2e tests stay valid; we add focused tests for the native bridge.

## 8. Phasing

1. **BLE spike (Linux):** btleplug proves trainer **+** HRM connect, notifications,
   ERG write, and reconnect. De-risks the whole effort cheaply.
2. **Linux MVP:** native BLE + file ports behind the seams; feature-parity with the
   PWA on Linux. Keep-awake + native HTTP import.
3. **Harden Linux:** packaging, signing where relevant, auto-update.
4. **Other desktops:** Windows (BLE quirks), macOS (entitlements/notarization).
5. **Mobile:** Android (blec/JNI, permissions) and iOS (CoreBluetooth,
   entitlements, store). Foreground-only, so no background-mode review yet.

## 9. Risks

- **BLE breadth × platforms** is the real work (Windows pairing, mobile permissions
  later). Linux-first keeps the first mile simple.
- **Maintenance surface** grows (Rust + targets + signing/stores) vs. the current
  zero-backend PWA — but the PWA stays, so native is additive.

---

## Packaging note: Flatpak + Bluetooth

Flatpak is sandboxed, so BLE needs an explicit hole to the system BlueZ service.
The Flatpak manifest's `finish-args` will include **`--system-talk-name=org.bluez`**
(D-Bus access to BlueZ) — this is the minimal, correct permission for BLE central
use (preferred over the broad `--device=all`). Distribution + auto-update go through
a **Flatpak repo** (Flathub or self-hosted). Note: Flatpak is the *distribution*
format — during development the spike and MVP run **natively** via `cargo`, so the
sandbox doesn't slow iteration.

## Next step (in progress): the Linux BLE spike — HRM first

Per your preference, the spike starts with a **heart-rate monitor** (simplest:
notify-only, no FTMS control point). A small native Rust binary built on btleplug:
scan for the Heart Rate service (`0x180d`), connect, subscribe to HR Measurement
(`0x2a37`) notifications, parse the flags byte, and stream live BPM. This proves
btleplug ↔ BlueZ ↔ real hardware — the only genuinely risky part — before any Tauri
or UI wiring. The trainer (FTMS connect + ERG control-point write) follows once HRM
is confirmed.

**Hardware:** running the spike needs the HRM powered on and broadcasting (worn or
damp the contacts). I'll flag exactly when to switch it on.
