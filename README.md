# ZWO Downloader

**ZWO Downloader** is a Chrome extension that converts cycling workouts from **TrainerRoad**, **TrainerDay**, and **WhatsOnZwift** into Zwift `.zwo` files.
It extracts interval data directly from the workout page, builds a Zwift-compatible structure, computes metrics, and saves the file to your chosen ZWO folder.

---

## Supported Websites

* **TrainerRoad** workout pages
* **TrainerDay** workout pages
* **WhatsOnZwift** workout pages

The extension activates automatically on supported URLs.

---

## How It Works

1. Open a workout on TrainerRoad, TrainerDay, or WhatsOnZwift.
2. Click the extension’s toolbar icon.
3. A `.zwo` file is generated and saved to your selected folder (or Downloads by default).

---

## Options Page

Right-click the extension → **Options**

You can:

### **Set ZWO Folder**

* Choose where `.zwo` files are saved
* View or refresh the folder contents

### **Browse Your Workouts**

All `.zwo` files in the folder appear in a searchable/sortable table.

Features:

* Search by name or text
* Filter by category or duration
* Inline FTP control (updates kJ calculations)
* Expand any row to see:

  * A graphical interval preview
  * The workout description

Keyboard shortcuts:

* **Up/Down** or **j/k** to move between workouts
* Expands automatically while navigating

---

## Installation (Unpacked)

```bash
git clone https://github.com/babymastodon/zwo-downloader.git
cd zwo-downloader
```

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `src/` folder

---

## License

MIT License.
