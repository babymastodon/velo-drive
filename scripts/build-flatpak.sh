#!/usr/bin/env bash
#
# Build + install the VeloDrive Flatpak from a clean checkout, in one step.
#
# It checks every dependency, installs the missing Flatpak pieces (runtime, SDK,
# flatpak-builder) from Flathub, builds the frontend and the native release
# binary, then packages and installs the Flatpak.
#
# Usage:
#   scripts/build-flatpak.sh           # build + install, then print run hint
#   scripts/build-flatpak.sh --run     # also launch the app afterwards
#   scripts/build-flatpak.sh --no-install-deps   # fail (don't auto-install) on missing Flatpak deps
#
set -euo pipefail

# --- locate repo + manifest --------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FLATPAK_DIR="$REPO_DIR/flatpak"
MANIFEST="$FLATPAK_DIR/bike.velodrive.VeloDrive.yml"
APP_ID="bike.velodrive.VeloDrive"

RUN_AFTER=0
INSTALL_DEPS=1
for arg in "$@"; do
  case "$arg" in
    --run) RUN_AFTER=1 ;;
    --no-install-deps) INSTALL_DEPS=0 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

# Runtime version is the single source of truth in the manifest.
RUNTIME_VERSION="$(sed -n "s/^runtime-version:[[:space:]]*['\"]\?\([0-9]\+\).*/\1/p" "$MANIFEST" | head -1)"
[ -n "$RUNTIME_VERSION" ] || die "could not parse runtime-version from $MANIFEST"

# --- host toolchain checks ---------------------------------------------------
say "Checking host toolchain"
for tool in node npm cargo flatpak; do
  command -v "$tool" >/dev/null 2>&1 || die "missing '$tool' — install it and re-run"
done
echo "  node $(node --version), npm $(npm --version), cargo $(cargo --version | awk '{print $2}'), flatpak $(flatpak --version | awk '{print $2}')"

# --- flatpak deps: flathub remote, runtime, SDK, flatpak-builder -------------
# Returns 0 if a runtime/app ref is installed at either --user or --system scope.
fp_installed() { flatpak info "$1" >/dev/null 2>&1; }

ensure_flathub() {
  # A full (un-filtered) Flathub remote is needed for the GNOME SDK + builder.
  if flatpak remotes --user 2>/dev/null | grep -q '^flathub'; then return 0; fi
  if flatpak remotes 2>/dev/null | awk '$1=="flathub" && $0 !~ /filtered/ {found=1} END{exit !found}'; then return 0; fi
  say "Adding the Flathub remote (--user)"
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
}

install_flatpak_dep() {
  local ref="$1" label="$2"
  if fp_installed "$ref"; then echo "  $label: present"; return 0; fi
  if [ "$INSTALL_DEPS" -eq 0 ]; then die "$label missing ($ref) and --no-install-deps set"; fi
  ensure_flathub
  say "Installing $label ($ref) from Flathub"
  flatpak install -y --user flathub "$ref"
}

say "Checking Flatpak runtime/SDK/builder (GNOME $RUNTIME_VERSION)"
install_flatpak_dep "org.gnome.Platform//$RUNTIME_VERSION" "GNOME Platform $RUNTIME_VERSION"
install_flatpak_dep "org.gnome.Sdk//$RUNTIME_VERSION"      "GNOME SDK $RUNTIME_VERSION"

# flatpak-builder: prefer a native binary, else the org.flatpak.Builder Flatpak.
if command -v flatpak-builder >/dev/null 2>&1; then
  FLATPAK_BUILDER=(flatpak-builder)
  echo "  flatpak-builder: native ($(flatpak-builder --version | awk '{print $NF}'))"
else
  install_flatpak_dep "org.flatpak.Builder" "flatpak-builder (Flatpak app)"
  FLATPAK_BUILDER=(flatpak run org.flatpak.Builder)
fi

# --- build frontend ----------------------------------------------------------
say "Building web frontend"
if [ ! -d "$REPO_DIR/web/node_modules" ]; then
  npm --prefix "$REPO_DIR/web" install
fi
npm --prefix "$REPO_DIR/web" run build

# --- build native release binary ---------------------------------------------
# IMPORTANT: --features custom-protocol flips Tauri out of dev mode. Without it
# the app loads the dev server (http://localhost:5173) and shows
# "Could not connect to localhost: Connection refused".
say "Building native release binary (cargo --release --features custom-protocol)"
cargo build --release --features custom-protocol --manifest-path "$REPO_DIR/src-tauri/Cargo.toml"

BIN="$REPO_DIR/src-tauri/target/release/velodrive"
[ -x "$BIN" ] || die "expected binary not found: $BIN"

# --- package + install Flatpak ----------------------------------------------
say "Packaging + installing Flatpak ($APP_ID)"
# Run from the manifest dir: the manifest uses paths relative to it.
( cd "$FLATPAK_DIR" && "${FLATPAK_BUILDER[@]}" --user --install --force-clean build-dir "$(basename "$MANIFEST")" )

say "Done. Installed $APP_ID."
if [ "$RUN_AFTER" -eq 1 ]; then
  say "Launching"
  exec flatpak run "$APP_ID"
else
  echo "  Run it with:  flatpak run $APP_ID"
fi
