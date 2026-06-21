# src-tauri — VeloDrive native shell (in progress)

The Rust side of the native (Tauri) port. See [`../TAURI-DESIGN.md`](../TAURI-DESIGN.md)
for the plan: **Linux first**, `btleplug` for Bluetooth, **Flatpak** for distribution,
keep the existing `web/` app as the frontend.

Right now this crate contains only the **BLE spike** that de-risks the hardest part —
`btleplug` ↔ BlueZ ↔ a real device — before any Tauri/UI wiring. Tauri itself (the
webview, `fs`/`dialog`/`updater` plugins, `tauri.conf.json`) is added once the spike
is validated.

---

## Dependencies

### All platforms
- **Rust** (stable) via [rustup](https://rustup.rs). Built with 1.96; any recent
  stable works.

### Linux (the current target)
Bluetooth runtime + the system D-Bus dev files that `btleplug`'s BlueZ backend links:

```sh
# Fedora
sudo dnf install -y dbus-devel pkgconf-pkg-config
# Debian/Ubuntu
sudo apt install -y libdbus-1-dev pkg-config
# Arch
sudo pacman -S --needed dbus pkgconf
```

- `bluetoothd` must be running: `systemctl status bluetooth` (and the adapter
  unblocked: `rfkill list bluetooth`).
- No root needed to *run* the spike — BlueZ allows scan/connect for the active
  desktop session via PolicyKit.
- **For the eventual Tauri webview** (added later, not needed for the spike): the
  standard Tauri Linux deps — `webkit2gtk4.1-devel`, `libsoup3-devel`,
  `gtk3-devel`, `librsvg2-devel` (Fedora names; see the Tauri prerequisites docs).

### macOS (later)
- Xcode Command Line Tools (`xcode-select --install`) — CoreBluetooth links via the
  SDK. The app bundle needs `NSBluetoothAlwaysUsageDescription`.

### Windows (later)
- MSVC build tools (Visual Studio C++). `btleplug` uses built-in WinRT Bluetooth —
  no extra system package.

### Android / iOS (later)
- Android: NDK + the `tauri-plugin-blec` JNI build; runtime `BLUETOOTH_SCAN`/
  `BLUETOOTH_CONNECT` permissions.
- iOS: Xcode; `NSBluetoothAlwaysUsageDescription` + CoreBluetooth framework linked.

### Flatpak packaging (later)
Built/shipped via a Flatpak manifest; BLE access is granted in `finish-args` with
`--system-talk-name=org.bluez`. The Flatpak runtime bundles the build/runtime deps,
so the system packages above are a *local-dev* requirement only.

---

## Run the heart-rate-monitor spike

```sh
cargo run --bin hrm-spike            # scans 8s by default
cargo run --bin hrm-spike 15         # scan 15s
```

Scans for the Heart Rate service (`0x180D`), connects to the first HRM found,
subscribes to HR Measurement (`0x2A37`) notifications, and prints live BPM until
Ctrl-C. **Power on the HRM and wear it / damp the electrodes first**, and make sure
it isn't already connected to a phone or another app. If it doesn't advertise the
HR service, pass its name or address: `cargo run --bin hrm-spike "TICKR"`.

## Run the trainer (FTMS) spike

```sh
cargo run --bin ftms-spike            # read-only: stream power/cadence/speed (safe)
cargo run --bin ftms-spike "KICKR"    # target by name substring
cargo run --bin ftms-spike "KICKR" 120  # ERG: take control + hold 120 W
```

Connects an FTMS trainer (`0x1826`), subscribes to Indoor Bike Data (`0x2AD2`), and
— only if you pass a wattage — writes the Control Point (`0x2AD9`) to set ERG target
power. Pedal a turn first to wake the trainer.

## Run the native app

```sh
npm --prefix ../web run build        # build the frontend into ../web/dist (once / on UI change)
cargo run --bin velodrive            # open the native window
```

The window hosts the existing VeloDrive UI and drives Bluetooth through the native
connector — connect your trainer/HRM from the bottom nav and watch live power/HR.
If launching from a detached shell hits a Wayland error, force X11:
`GDK_BACKEND=x11 cargo run --bin velodrive`. (For HMR dev, install the Tauri CLI and
use `cargo tauri dev`.)

**Note:** the workout *library* (folder picker) still uses the web File System
Access API, which isn't in the webview yet — that's the next milestone
(`NativeFileStore`). Bluetooth + the live HUD work today.

---

## Roadmap (this crate)

1. ✅ HRM spike — proven on real hardware (Wahoo TICKR FIT streaming live BPM).
2. ✅ Trainer spike — proven on real hardware (Wahoo KICKR: live power/cadence/
   speed **and** ERG control-point write holding the 110 W target). Connects can
   be flaky (BlueZ "service discovery timed out"); the spikes + connector retry.
3. ✅ Tauri shell + BLE module behind Tauri commands/events (src/lib.rs, src/ble.rs).
4. ✅ `NativeTrainerTransport` over the IPC; native-vs-web port selected at boot.
   Robust connector: error events, remember + reconnect-on-start, multi-app-polite.
5. ✅ `NativeFileStore` — workout folder + .zwo library + .fit history + schedule
   + trash over native fs commands (path-backed FsDirHandle reusing WebFileStore).
6. ✅ Native keep-awake during rides (`keepawake` inhibitor via `set_keep_awake`).
7. ✅ Flatpak manifest scaffold — bundle id `bike.velodrive.app`,
   `--system-talk-name=org.bluez` for BLE; see [`../flatpak/`](../flatpak/).

The Linux native app is feature-complete (Bluetooth, workout library/history/
planner, rides, keep-awake). Follow-ups: route the TrainerDay URL import through
Rust to bypass webview CORS; then the other desktop + mobile targets.
