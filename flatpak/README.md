# Flatpak packaging

Distribution target for the Linux native app (see [`../src-tauri/`](../src-tauri/)).
[`bike.velodrive.VeloDrive.yml`](./bike.velodrive.VeloDrive.yml) packages the **prebuilt**
`velodrive` binary (it embeds the `web/` frontend), so no offline cargo/node
source generation is needed.

## Build

The easiest path is the one-step script, which checks deps and installs the
missing Flatpak runtime/SDK/builder for you:

```sh
../scripts/build-flatpak.sh          # build + install
../scripts/build-flatpak.sh --run    # build + install, then launch
```

Manual equivalent:

```sh
# 1. Build the frontend + the release binary (the binary embeds web/dist).
#    --features custom-protocol is REQUIRED: without it Tauri builds in dev mode
#    and the app shows "Could not connect to localhost: Connection refused"
#    (it tries to load the http://localhost:5173 dev server).
npm --prefix ../web run build
cargo build --release --features custom-protocol --manifest-path ../src-tauri/Cargo.toml

# 2. Package + install the Flatpak (needs flatpak-builder + the GNOME runtime).
#    Match the version to runtime-version in the manifest (currently 49).
flatpak install flathub org.gnome.Platform//49 org.gnome.Sdk//49   # once
flatpak-builder --user --install --force-clean build-dir bike.velodrive.VeloDrive.yml
flatpak run bike.velodrive.VeloDrive
```

> No native `flatpak-builder`? Install the Flatpak app instead
> (`flatpak install flathub org.flatpak.Builder`) and run it as
> `flatpak run org.flatpak.Builder …` — the build script does this automatically.

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
