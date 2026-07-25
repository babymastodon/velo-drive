<p align="center">
  <a href="https://velodrive.bike/">
    <img src="media/logo.svg" alt="VeloDrive logo" height="128">
  </a>
</p>

# VeloDrive

VeloDrive lets you build and ride structured workouts on an FTMS smart trainer. It works in Chrome or as a native Linux app, saves workouts and ride history on your device, and needs no account.

[Open VeloDrive](https://velodrive.bike/)

## Get started

### Install the web app

Open [velodrive.bike](https://velodrive.bike/) in Chrome and click the install icon in the address bar. The installed app appears in your app launcher and works offline.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/install_dark.png">
  <img src="media/screenshots/install_light.png" alt="Google Chrome showing the option to install VeloDrive as a PWA">
</picture>

### Set up VeloDrive

Pick a folder for your workouts and ride history. If the folder is empty, VeloDrive adds a set of built-in workouts.

Enter your FTP and choose your sound and theme preferences in **Settings**. Use **Bike** to pair your trainer and **HRM** to connect an optional heart-rate monitor.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/settings-dark.png">
  <img src="media/screenshots/guide/settings-light.png" alt="Configured VeloDrive settings showing the local data folder, FTP, sounds, theme, Bluetooth status, PWA status, and connection logs">
</picture>

### Choose a workout

Click the workout name at the bottom of the ride screen to open the library. Browse by folder, search by name or source, or filter by training zone and duration. Expand any workout to see its profile and training load.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/library-airforge-dark.png">
  <img src="media/screenshots/guide/library-airforge-light.png" alt="VeloDrive workout library with Airforge expanded to show its metrics, description, actions, and profile">
</picture>

Choose one to ride or make a copy to edit. Workouts can also be organized into folders.

### Ride

During a ride, the main screen shows current and target power, interval time, heart rate, cadence, and the full workout profile. The chart fills with live data as you ride.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/ride-violator-dark.png">
  <img src="media/screenshots/guide/ride-violator-light.png" alt="An active Violator workout showing live power, heart rate, cadence, target power, timers, coaching, and the workout profile">
</picture>

_Shown with simulated trainer and heart-rate data on TrainerDay’s 64-sprint Violator workout._

Use the play button to start, pause, and resume. VeloDrive saves finished rides to your history. During free-ride blocks, you can switch between ERG and resistance modes and adjust the target.

## More you can do

### Import or create a workout

Import `.zwo` or structured `.fit` files, browse popular TrainerDay workouts, or search the Zwift and WhatsOnZwift collections. You can also paste a TrainerDay or WhatsOnZwift workout link into the builder.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/builder-airforge-dark.png">
  <img src="media/screenshots/guide/builder-airforge-light.png" alt="VeloDrive workout builder editing Airforge with a warm-up block and its duration, power, and cadence controls visible">
</picture>

To create a workout from scratch, add steady efforts, ramps, repeated intervals, free rides, cadence targets, and text cues. Click a block to change it, or drag blocks to adjust their order, duration, and power. Save the finished workout to your library.

### Plan your training

The calendar shows planned workouts and completed rides together, along with recent totals for time, work, and TSS.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/guide/calendar-training-week-dark.png">
  <img src="media/screenshots/guide/calendar-training-week-light.png" alt="VeloDrive calendar with completed rides, future scheduled workouts, a selected date, and recent training totals">
</picture>

Click a date to schedule a workout, or drag a planned workout to another day. Start it directly from its calendar card.

### Review a completed ride

Open a completed ride to compare the workout plan with your recorded power, heart rate, and cadence. The ride view also includes summary metrics and a power curve.

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

Linux users can build the native app for more reliable Bluetooth connections and automatic device reconnection. It can also import workout links that browsers block:

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

The app is built with TypeScript, Vite, and Svelte. The source is in [web/](web/), and the GitHub Pages build is in [docs/](docs/). See [web/README.md](web/README.md) for architecture and test-harness details.

```sh
cd web
npm install
npm run typecheck
npm run test
npm run test:e2e
npm run docs:screenshots
```

`npm run docs:screenshots` regenerates the tour in both themes and fetches its TrainerDay example. Update the PWA installation image separately.

## Contributing

Contributions to the workout bank, device support, tests, documentation, and interface are welcome.

## License

[MIT](LICENSE)
