# ZWO Downloader

A Chrome extension that converts TrainerRoad & TrainerDay workouts into Zwift `.zwo` files.
The extension detects workout builder pages, retrieves workout data from the page, reconstructs the workout structure (including ramps and intervals), and provides a one-click download of a valid ZWO file.

## Features

* Automatically detects workout pages under:

  ```
  https://www.trainerroad.com/app/cycling/workouts/add/<id>
  ```
* Fetches and processes:

  * `chart-data` (1-second power samples)
  * `summary` (metadata, progression level, TSS, kJ, IF)
* Generates ZWO workouts using:

  * SteadyState
  * Warmup and Cooldown
  * IntervalsT (detected from repeating patterns)
* Correctly handles:

  * Ramp up/down detection
  * Single-second transitions
  * Workout category from TrainerRoad progression
* One-click download via the extension toolbar icon

## Installation (Unpacked)

1. Clone the repository:

   ```bash
   git clone https://github.com/babymastodon/zwo-downloader.git
   cd zwo-downloader
   ```
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `src/` directory.

## Usage

While viewing a TrainerRoad/TrainerDay workout builder page, click the extension’s toolbar icon to download the corresponding `.zwo` file.
The extension prints its generated XML to the browser console for reference and debugging.

## License

MIT License.
