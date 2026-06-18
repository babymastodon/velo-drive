#!/usr/bin/env node
// apply-shims.mjs <targetDir>
//
// Rewrites a COPY of the legacy app (docs/ -> targetDir, typically
// `legacy-shimmed/`) so the platform providers the app depends on become
// swappable *from the page* via a single global, `window.__VELO_TEST_ENV__`.
//
// Design (default-to-real, minimal, behavior-preserving):
//   * The heavy lifting is done by a self-contained bootstrap, `velo-shim.js`,
//     injected as the FIRST <script> in index.html (before theme-init.js and
//     before the `workout.js` module graph). When `__VELO_TEST_ENV__` is
//     present it monkey-patches the relevant *globals* — `Date`,
//     `setTimeout`/`setInterval` (+ their `clear*`), `performance.now`,
//     `navigator.bluetooth`, `window.AudioContext`, `indexedDB`, and
//     `window.showDirectoryPicker`. Because the legacy modules read those
//     globals directly (engine clock, beeper timers + AudioContext, ble-manager
//     `navigator.bluetooth`, storage `indexedDB`/`showDirectoryPicker`), NO
//     edits to the module sources are needed to make them swappable.
//   * When `__VELO_TEST_ENV__` is ABSENT the bootstrap is an inert no-op, so the
//     shimmed copy runs byte-for-byte identically to the pristine app.
//
// The only source edit is the one <script> injection into index.html; this
// keeps the patch surgical and trivially auditable.

import {readFileSync, writeFileSync, copyFileSync, existsSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("usage: node apply-shims.mjs <targetDir>");
  process.exit(1);
}
const target = resolve(targetDir);
const indexPath = join(target, "index.html");
if (!existsSync(indexPath)) {
  console.error(`apply-shims: ${indexPath} not found (did setup-legacy copy docs first?)`);
  process.exit(1);
}

// 1. Drop the bootstrap shim into the target dir.
const shimSrc = join(__dirname, "velo-shim.js");
const shimDst = join(target, "velo-shim.js");
copyFileSync(shimSrc, shimDst);

// 2. Inject it as the very first <script> in <head>, before theme-init.js.
let html = readFileSync(indexPath, "utf8");
const MARKER = "velo-shim.js";
if (!html.includes(MARKER)) {
  const themeTag = '<script src="theme-init.js"></script>';
  const shimTag = '<script src="velo-shim.js"></script>';
  if (html.includes(themeTag)) {
    html = html.replace(themeTag, `${shimTag}\n    ${themeTag}`);
  } else {
    // Fallback: inject right after <head>.
    html = html.replace(/<head>/i, `<head>\n    ${shimTag}`);
  }
  writeFileSync(indexPath, html, "utf8");
  console.log("apply-shims: injected velo-shim.js into index.html");
} else {
  console.log("apply-shims: velo-shim.js already injected; skipping");
}
