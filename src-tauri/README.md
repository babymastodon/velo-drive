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

---

## Roadmap (this crate)

1. ✅ HRM spike — proven on real hardware (Wahoo TICKR FIT streaming live BPM).
2. ✅ Trainer spike — proven on real hardware (Wahoo KICKR: live power/cadence/
   speed **and** ERG control-point write holding the 110 W target). Connects can
   be flaky (BlueZ "service discovery timed out"); both spikes retry 3×.
3. Wrap the BLE module in Tauri commands/events; add `fs`/`dialog`/`updater`.
4. Implement `web/src/ports/native/{NativeTrainerTransport,NativeFileStore}.ts`
   against the IPC; select native vs web ports at boot.
5. Flatpak manifest (bundle id `bike.velodrive.app`) + Flathub/self-hosted repo.
