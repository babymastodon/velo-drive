<p align="center">
  <a href="https://velodrive.bike/">
    <img src="media/logo.svg" alt="VeloDrive logo" height="128">
  </a>
</p>

# VeloDrive

VeloDrive is an offline cycling workout app for FTMS-compatible smart trainers. It runs as a browser/PWA or a native Linux app, keeps workouts and ride history on your device, and does not require an account or backend service.

[Open VeloDrive](https://velodrive.bike/)

## Tour

### 1. Install the web app

Open [velodrive.bike](https://velodrive.bike/) in Google Chrome. Select the install icon in the address bar to add VeloDrive to your app launcher. Once its assets are cached, the installed PWA can run offline.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/install_dark.png">
  <img src="media/screenshots/install_light.png" alt="Google Chrome showing the option to install VeloDrive as a PWA">
</picture>

Chrome is the supported browser path because VeloDrive needs Web Bluetooth and File System Access. iOS Safari does not provide the required APIs. You can also build the [native Linux app](#native-linux-app-flatpak).

### 2. Set up your data and devices

On first launch, choose a local VeloDrive folder. An empty folder is initialized with `workouts`, `history`, and `trash` directories plus the bundled workout library. The native app creates its data folder automatically.

In **Settings**, enter your FTP, choose sound and theme preferences, and check Bluetooth availability. Back on the ride screen, use **Bike** to pair an FTMS trainer and **HRM** to pair an optional heart-rate monitor.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/settings-dark.png">
  <img src="media/screenshots/guide/settings-light.png" alt="Configured VeloDrive settings showing the local data folder, FTP, sounds, theme, Bluetooth status, PWA status, and connection logs">
</picture>

The data folder and device choices are remembered. A browser may ask you to grant folder access again after a restart.

### 3. Choose a workout

Select the workout name at the bottom of the ride screen or press `W` to open the library. Search by name or source, filter by zone and duration, sort calculated metrics, and expand any workout to inspect its description and profile.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/library-airforge-dark.png">
  <img src="media/screenshots/guide/library-airforge-light.png" alt="VeloDrive workout library with Airforge expanded to show its metrics, description, actions, and profile">
</picture>

The library can select, clone, edit, import, or move workouts to `trash`. Subfolders inside `workouts` appear as library folders, while **Show all** provides a flat view.

### 4. Ride

The ride screen shows live and target power, interval and workout time, heart rate, cadence, coaching text, and the full workout profile. Live power, heart-rate, and cadence traces build across the chart while you ride.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/ride-violator-dark.png">
  <img src="media/screenshots/guide/ride-violator-light.png" alt="An active Violator workout showing live power, heart rate, cadence, target power, timers, coaching, and the workout profile">
</picture>

_App screenshots use simulated trainer and heart-rate data. This example loads TrainerDay’s 64-sprint Violator workout when the screenshots are generated._

Use the play control or `Space` to start, pause, and resume. The stop control ends the ride and saves a FIT file when samples have been recorded. During free-ride blocks, the bottom bar adds ERG and resistance modes with a manual target.

### 5. Import, build, and edit

Import local `.zwo` files or structured-workout `.fit` files, popular TrainerDay workouts, the original Zwift collection, or the WhatsOnZwift catalog. The builder can also import supported TrainerDay and WhatsOnZwift URLs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/builder-airforge-dark.png">
  <img src="media/screenshots/guide/builder-airforge-light.png" alt="VeloDrive workout builder editing Airforge with a warm-up block and its duration, power, and cadence controls visible">
</picture>

The builder supports steady zones, warm-up and cooldown ramps, repeated intervals, free rides, cadence targets, and text cues. Select a chart block to edit it; move, copy, paste, delete, undo, or redo blocks as needed. Saving writes a `.zwo` file to the local library.

URL and catalog imports require a network connection. Browser cross-origin restrictions can reject a supported source; the native app routes those requests through native HTTP.

### 6. Plan your training

Open the calendar from the bottom bar or press `C`. It combines completed FIT rides with scheduled workouts and summarizes duration, work, and TSS over recent 3-, 7-, and 30-day periods.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/calendar-training-week-dark.png">
  <img src="media/screenshots/guide/calendar-training-week-light.png" alt="VeloDrive calendar with completed rides, future scheduled workouts, a selected date, and recent training totals">
</picture>

Select an empty date to schedule a workout. Scheduled cards can be loaded, replaced, removed, or dragged to today or a future date.

### 7. Review a completed ride

Select a completed calendar card to review duration, average and normalized power, work, IF, TSS, VI, heart rate, and cadence. The detail view also includes a power curve and planned-versus-actual traces.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/history-airforge-dark.png">
  <img src="media/screenshots/guide/history-airforge-light.png" alt="Completed Airforge ride analysis with summary metrics, a power curve, and planned-versus-actual power, heart-rate, and cadence traces">
</picture>

Deleting a completed ride moves its FIT file to `trash`.

## Local files

The selected VeloDrive folder contains:

- `workouts/` — `.zwo` and imported workout files
- `history/` — FIT files created by completed rides
- `trash/` — workouts and history removed through the app
- `schedule.json` — scheduled workout titles and dates

Web preferences and remembered browser handles stay in the app’s local browser data. Moving the VeloDrive folder outside the app may require selecting it again.

## Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Start, pause, or resume the selected workout |
| `W` | Open the workout library |
| `C` | Open the calendar |
| `S` | Open Settings |
| `E` / `R` | Choose ERG or resistance during a free-ride block |
| `J` / `K` | Lower or raise the active free-ride target |
| `Esc` | Close the current view or return to its parent |

The library, builder, and calendar show additional shortcuts for their own editing and navigation tasks.

## Native Linux app (Flatpak)

The native application uses the same interface with more reliable Bluetooth connection and fewer browser restrictions on supported workout imports. It is currently installed from source:

```sh
scripts/build-flatpak.sh          # build and install
scripts/build-flatpak.sh --run    # build, install, and launch
flatpak run bike.velodrive.VeloDrive
```

See [flatpak/README.md](flatpak/README.md) for prerequisites and packaging details.

## Device support

VeloDrive controls trainers through the standard Bluetooth Fitness Machine Service and reads the standard Bluetooth Heart Rate service. It has been tested with a Wahoo KICKR and Wahoo TICKR. Other devices implementing the same services are expected to work, but are not all tested.

If a device does not appear, confirm that it is awake, not connected to another app, and exposes the expected service. Check **Settings → Bluetooth** and **Connection logs** for the latest messages.

## Development

The TypeScript, Vite, and Svelte application is in [web/](web/). The production PWA is built into the generated [docs/](docs/) directory for GitHub Pages. Architecture, harness details, and the full command list are in [web/README.md](web/README.md).

```sh
cd web
npm install
npm run typecheck
npm run test
npm run test:e2e
npm run docs:screenshots
```

The screenshot command downloads the TrainerDay example to an ignored temporary directory, then regenerates every app screenshot in light and dark themes. The PWA installation image is maintained separately.

## Contributing

Contributions to the workout bank, device support, tests, documentation, and interface are welcome.

## License

[MIT](LICENSE)
