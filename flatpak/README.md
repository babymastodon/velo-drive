# Flatpak packaging

Distribution target for the Linux native app (see [`../src-tauri/`](../src-tauri/)).
[`bike.velodrive.VeloDrive.yml`](./bike.velodrive.VeloDrive.yml) packages the **prebuilt**
`velodrive` binary (it embeds the `web/` frontend), so no offline cargo/node
source generation is needed.

## Build

```sh
# 1. Build the frontend + the release binary (the binary embeds web/dist)
npm --prefix ../web run build
cargo build --release --manifest-path ../src-tauri/Cargo.toml

# 2. Package + install the Flatpak (needs flatpak-builder + the GNOME runtime)
flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47   # once
flatpak-builder --user --install --force-clean build-dir bike.velodrive.VeloDrive.yml
flatpak run bike.velodrive.VeloDrive
```

## Notes

- **Bluetooth:** access is granted by `--system-talk-name=org.bluez` in
  `finish-args` (BLE central via the system BlueZ service) — the key sandbox
  permission for this app.
- **Workout folder:** `--filesystem=home` lets the native fs commands read/write
  the user-picked VeloDrive folder. (Could be tightened to the document portal
  later.)
- This is a **scaffold to validate** — the `runtime-version` may need bumping to a
  runtime you have installed, and updates go through a Flatpak repo (Flathub or
  self-hosted) per the design.
