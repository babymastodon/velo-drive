import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(webRoot, "..");
const read = (relative) => readFileSync(resolve(repoRoot, relative), "utf8");
const fail = [];

const markdownFiles = ["README.md"];
const markdown = new Map(markdownFiles.map((name) => [name, read(name)]));
const expectedViews = [
  "ride-violator",
  "library-airforge",
  "calendar-training-week",
  "history-airforge",
  "builder-airforge",
  "settings",
];
const obsoleteScreenshots = [
  "media/screenshots/hero.png",
  "media/screenshots/hero-dark.png",
  "media/screenshots/selector-light.png",
  "media/screenshots/selector-dark.png",
];
const manualScreenshots = [
  ["media/screenshots/install_light.png", 2072, 465],
  ["media/screenshots/install_dark.png", 2072, 473],
];

for (const [name, text] of markdown) {
  const htmlImages = [...text.matchAll(/\b(?:src|srcset)="([^"]+\.png)"/g)].map((match) => match[1]);
  const markdownImages = [...text.matchAll(/!\[[^\]]*]\(([^)]+\.png)\)/g)].map((match) => match[1]);
  for (const image of [...htmlImages, ...markdownImages]) {
    if (!existsSync(resolve(repoRoot, image))) fail.push(`${name}: missing image ${image}`);
  }
}

for (const view of expectedViews) {
  for (const theme of ["light", "dark"]) {
    const relative = `media/screenshots/guide/${view}-${theme}.png`;
    const absolute = resolve(repoRoot, relative);
    if (!existsSync(absolute)) {
      fail.push(`missing expected screenshot ${relative}`);
      continue;
    }
    const png = readFileSync(absolute);
    const signature = png.subarray(1, 4).toString("ascii");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (signature !== "PNG") fail.push(`${relative}: not a PNG`);
    if (width !== 1440 || height !== 900) {
      fail.push(`${relative}: expected 1440x900, found ${width}x${height}`);
    }
  }
}

const readme = markdown.get("README.md");
for (const view of expectedViews) {
  if (!readme?.includes(`${view}-light.png`) || !readme.includes(`${view}-dark.png`)) {
    fail.push(`README.md: missing light/dark ${view} pair`);
  }
}
for (const [relative, expectedWidth, expectedHeight] of manualScreenshots) {
  const absolute = resolve(repoRoot, relative);
  if (!existsSync(absolute)) {
    fail.push(`missing manual screenshot ${relative}`);
    continue;
  }
  const png = readFileSync(absolute);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png.subarray(1, 4).toString("ascii") !== "PNG") {
    fail.push(`${relative}: not a PNG`);
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    fail.push(
      `${relative}: expected ${expectedWidth}x${expectedHeight}, found ${width}x${height}`,
    );
  }
}
for (const [relative] of manualScreenshots) {
  if (!readme?.includes(relative)) fail.push(`README.md: missing ${relative}`);
}
if (/media\/screenshots\/(?:hero|selector)[-_]/.test(readme ?? "")) {
  fail.push("README.md: still references an obsolete screenshot");
}
for (const relative of obsoleteScreenshots) {
  if (existsSync(resolve(repoRoot, relative))) {
    fail.push(`obsolete screenshot still present: ${relative}`);
  }
}

if (fail.length) {
  console.error("User documentation check failed:");
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `User documentation check passed: ${markdownFiles.length} Markdown file, ${expectedViews.length * 2 + manualScreenshots.length} screenshots.`,
);
