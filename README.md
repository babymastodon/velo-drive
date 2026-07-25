<p align="center">
  <a href="https://velodrive.bike/">
    <img src="media/logo.svg" alt="VeloDrive logo" height="128">
  </a>
</p>

# VeloDrive

VeloDrive lets you build and ride structured workouts on an FTMS smart trainer. It works in Chrome or as a native Linux app, saves workouts and ride history on your device, and needs no account.

[Open VeloDrive](https://velodrive.bike/)

## Tour

### 1. Install the web app

Open [velodrive.bike](https://velodrive.bike/) in Chrome and select the install icon in the address bar. VeloDrive will appear in your app launcher and can be used offline.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/install_dark.png">
  <img src="media/screenshots/install_light.png" alt="Google Chrome showing the option to install VeloDrive as a PWA">
</picture>

### 2. Set up your data and devices

Choose a folder for your workouts and ride history. VeloDrive fills a new folder with a library of built-in workouts to get you started.

In **Settings**, enter your FTP and choose your sound and theme preferences. Then use **Bike** to pair your trainer and **HRM** to pair an optional heart-rate monitor.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/settings-dark.png">
  <img src="media/screenshots/guide/settings-light.png" alt="Configured VeloDrive settings showing the local data folder, FTP, sounds, theme, Bluetooth status, PWA status, and connection logs">
</picture>

### 3. Choose a workout

Select the workout name at the bottom of the ride screen to open the library. Browse by folder, search by name or source, and narrow the list by training zone or duration. Expand a workout to preview its profile and training load.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/library-airforge-dark.png">
  <img src="media/screenshots/guide/library-airforge-light.png" alt="VeloDrive workout library with Airforge expanded to show its metrics, description, actions, and profile">
</picture>

Choose a workout to ride, or clone and edit it to make your own version. You can also organize workouts in folders and import new ones into the library.

### 4. Ride

Everything you need during a ride stays on one screen: current and target power, interval time, heart rate, cadence, and the full workout profile. The chart fills in with your live data as you progress.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/ride-violator-dark.png">
  <img src="media/screenshots/guide/ride-violator-light.png" alt="An active Violator workout showing live power, heart rate, cadence, target power, timers, coaching, and the workout profile">
</picture>

_Shown with simulated trainer and heart-rate data on TrainerDay’s 64-sprint Violator workout._

Use the play control to start, pause, and resume. When the ride ends, VeloDrive saves it to your history. Free-ride blocks let you switch between ERG and resistance modes and adjust the target as you go.

### 5. Import, build, and edit

Bring in `.zwo` or structured `.fit` files, browse popular TrainerDay workouts, or import from the Zwift and WhatsOnZwift collections. You can also paste a TrainerDay or WhatsOnZwift workout link into the builder.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/builder-airforge-dark.png">
  <img src="media/screenshots/guide/builder-airforge-light.png" alt="VeloDrive workout builder editing Airforge with a warm-up block and its duration, power, and cadence controls visible">
</picture>

Build workouts from steady efforts, ramps, repeated intervals, free rides, cadence targets, and text cues. Select any block in the chart to adjust it, rearrange blocks with familiar editing controls, and save the result straight to your library.

### 6. Plan your training

Open the calendar from the bottom bar to see planned workouts and completed rides together. Recent totals for time, work, and TSS make it easy to judge the shape of your training week.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/calendar-training-week-dark.png">
  <img src="media/screenshots/guide/calendar-training-week-light.png" alt="VeloDrive calendar with completed rides, future scheduled workouts, a selected date, and recent training totals">
</picture>

Select a date to schedule a workout, or drag an existing plan to another day. When it is time to ride, load the workout directly from its calendar card.

### 7. Review a completed ride

Open a completed ride to compare the workout plan with the power, heart rate, and cadence you recorded. Summary metrics and a power curve show how the effort added up.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/history-airforge-dark.png">
  <img src="media/screenshots/guide/history-airforge-light.png" alt="Completed Airforge ride analysis with summary metrics, a power curve, and planned-versus-actual power, heart-rate, and cadence traces">
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

Linux users can build a native version with steadier Bluetooth connections, automatic device reconnect, and more reliable workout-link imports:

```sh
scripts/build-flatpak.sh          # build and install
scripts/build-flatpak.sh --run    # build, install, and launch
flatpak run bike.velodrive.VeloDrive
```

See [flatpak/README.md](flatpak/README.md) for prerequisites and packaging details.

## Device support

VeloDrive works with Bluetooth FTMS trainers and standard Bluetooth heart-rate monitors. It has been tested with a Wahoo KICKR and Wahoo TICKR, and other standards-compliant devices should work too.

If a device does not appear, wake it and make sure another app is not already connected. **Connection logs** in Settings show the latest pairing messages.

## Development

The app is built with TypeScript, Vite, and Svelte. Source code lives in [web/](web/), and the GitHub Pages build lives in [docs/](docs/). See [web/README.md](web/README.md) for architecture and test-harness details.

```sh
cd web
npm install
npm run typecheck
npm run test
npm run test:e2e
npm run docs:screenshots
```

`npm run docs:screenshots` refreshes the tour in light and dark themes, fetching the TrainerDay example during the run. Update the PWA installation image separately.

## Contributing

Contributions to the workout bank, device support, tests, documentation, and interface are welcome.

## License

[MIT](LICENSE)
