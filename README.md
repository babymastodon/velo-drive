<p align="center">
  <a href="https://velodrive.bike/">
    <img src="media/logo.svg" alt="VeloDrive logo" height="128">
  </a>
</p>

# VeloDrive

VeloDrive lets you build and ride structured workouts on an FTMS smart trainer. It works in Chrome or as a native Linux app, saves workouts and ride history on your device, and needs no account.

[Open VeloDrive](https://velodrive.bike/)

## Feature tour

### Stay on target while riding

The ride screen keeps current and target power, interval time, heart rate, cadence, coaching cues, and the full workout at a glance. VeloDrive controls the trainer through each interval, while live data over the plan shows how the current effort compares and what comes next.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/ride-violator-dark.png">
  <img src="media/screenshots/guide/ride-violator-light.png" alt="An active Violator workout showing live power, heart rate, cadence, target power, timers, coaching, and the workout profile">
</picture>

### Workouts matched to you and your trainer

VeloDrive uses your Functional Threshold Power (FTP) to scale every workout to your fitness. It controls compatible Bluetooth smart trainers through the standard FTMS protocol and records heart rate from an optional Bluetooth monitor.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/settings-dark.png">
  <img src="media/screenshots/guide/settings-light.png" alt="VeloDrive settings with a data folder and FTP configured and Bluetooth devices connected">
</picture>

### Find the right workout

Built-in and imported workouts share one searchable library. Each shows its profile, duration, training zone, and training load (TSS), so you know what the session demands before you ride.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/library-airforge-dark.png">
  <img src="media/screenshots/guide/library-airforge-light.png" alt="VeloDrive workout library with Airforge expanded to show its metrics, description, actions, and profile">
</picture>

### Import or build workouts

VeloDrive can import `.zwo` and structured `.fit` files, plus collections from TrainerDay, the original Zwift workout collection, and WhatsOnZwift. TrainerDay and WhatsOnZwift links open directly in the builder.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/builder-airforge-dark.png">
  <img src="media/screenshots/guide/builder-airforge-light.png" alt="VeloDrive workout builder editing Airforge with a warm-up block and its duration, power, and cadence controls visible">
</picture>

Build simple endurance sessions or complex intervals with ramps, repeats, free riding, cadence targets, and on-screen coaching cues.

### Plan the week

The calendar keeps scheduled workouts and completed rides in one view. You can rearrange the week when plans change, while 3-, 7-, and 30-day totals show recent training time, energy (kJ), and training load (TSS).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/calendar-training-week-dark.png">
  <img src="media/screenshots/guide/calendar-training-week-light.png" alt="VeloDrive calendar with completed rides, future scheduled workouts, a selected date, and recent training totals">
</picture>

### Understand the ride

Ride history overlays the workout plan with recorded power, heart rate, and cadence, showing where you held the target and where you did not. Summary metrics show how hard you rode, while the power curve highlights your strongest average power across different durations.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/history-airforge-dark.png">
  <img src="media/screenshots/guide/history-airforge-light.png" alt="Completed Airforge ride analysis with summary metrics, a power curve, and planned-versus-actual power, heart-rate, and cadence traces">
</picture>

### Ride in Chrome, even offline

VeloDrive runs in Chrome or installs as a web app. The workout library and ride screen remain available offline.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/install_dark.png">
  <img src="media/screenshots/install_light.png" alt="Google Chrome showing the option to install VeloDrive as a PWA">
</picture>

## Your data

Your workouts and ride files stay in the folder you choose, where you can inspect, back up, or move them yourself:

- `workouts/` holds your workout library
- `history/` holds completed rides as FIT files
- `trash/` holds workouts and rides removed through the app

Items in `trash` remain available until you decide to remove them permanently.

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

## Native Linux app (Flatpak)

Linux users can build the native app for more reliable Bluetooth connections and automatic device reconnection. It can also import workout links that browsers block:

```sh
scripts/build-flatpak.sh          # build and install
scripts/build-flatpak.sh --run    # build, install, and launch
flatpak run bike.velodrive.VeloDrive
```

See [flatpak/README.md](flatpak/README.md) for prerequisites and packaging details.

## Device support

VeloDrive works with Bluetooth FTMS trainers and standard Bluetooth heart-rate monitors. It has been tested with a Wahoo KICKR and Wahoo TICKR, and other standards-compliant devices should work too.

## Development

The app is built with TypeScript, Vite, and Svelte. The source is in [web/](web/), and the GitHub Pages build is in [docs/](docs/). See [web/README.md](web/README.md) for architecture and test-harness details.

```sh
cd web
npm install
npm run typecheck
npm run test
npm run test:e2e
```

## Contributing

Contributions to the workout bank, device support, tests, documentation, and interface are welcome.

## License

[MIT](LICENSE)
