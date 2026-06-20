// scripts/smoke-docs.mjs
//
// Smoke-test the BUILT static PWA in repo-root docs/ exactly as GitHub Pages
// would serve it: spin up the zero-dep static server over docs/, load it in a
// real (non-harness) browser, and assert the app actually boots offline-style.
//
//   node scripts/smoke-docs.mjs            (run from web/)
//
// Checks: the app shell mounts, a fresh visitor gets the Welcome tour (proves
// boot-gating + first-run path run with no harness), the PWA essentials resolve
// (manifest is valid JSON, sw.js + a workout asset 200), the service worker
// registers, and the page logged no uncaught errors. Exits non-zero on failure.

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;

const fail = [];
const ok = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

const server = spawn('node', ['harness/static-server.mjs', '../docs', String(PORT)], {
  cwd: webRoot,
  stdio: 'ignore',
});

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server did not start');
}

let browser;
try {
  await waitForServer();

  // PWA asset reachability (raw HTTP, no browser).
  const manifestResp = await fetch(`${BASE}/velodrive.webmanifest`);
  check(manifestResp.ok, 'velodrive.webmanifest 200');
  let manifest = null;
  try {
    manifest = await manifestResp.json();
  } catch {
    /* handled below */
  }
  check(!!manifest && manifest.name === 'VeloDrive', 'manifest is valid JSON with name "VeloDrive"');
  check((await fetch(`${BASE}/sw.js`)).ok, 'sw.js 200');
  // The app fetches workouts via encodeURI() of the already-%20-encoded on-disk
  // name -> the path is double-encoded; the server decodes once back to disk.
  check((await fetch(`${BASE}/workouts/Sleepy%2520Spin.zwo`)).ok, 'workout asset resolves (double-encoded path)');

  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  // App shell mounts.
  await page.waitForSelector('#app', { timeout: 10_000 });
  const appHasContent = await page.evaluate(() => (document.getElementById('app')?.childElementCount ?? 0) > 0);
  check(appHasContent, '#app mounted with content');

  // A fresh visitor (no persisted state) gets the Welcome tour on boot.
  const welcomeVisible = await page
    .waitForSelector('#welcomeOverlay', { state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check(welcomeVisible, 'fresh-visitor Welcome tour shows on boot');
  const title = await page.locator('#welcomeTitle').textContent().catch(() => '');
  check(title?.includes('Welcome to VeloDrive'), 'Welcome splash renders its title');

  // Service worker registers (PWA installable). Allow a moment to activate.
  const swRegistered = await page
    .waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    }, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check(swRegistered, 'service worker registered');

  check(errors.length === 0, `no uncaught page errors (saw ${errors.length})`);
  if (errors.length) console.log('  page errors:\n   - ' + errors.join('\n   - '));

  await page.screenshot({ path: '/tmp/docs_smoke.png' });
} catch (err) {
  fail.push(`harness error: ${err?.message || err}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGKILL');
}

console.log('\n=== docs/ PWA smoke ===');
for (const o of ok) console.log(`  PASS  ${o}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${fail.length ? 'SMOKE FAILED' : 'SMOKE OK'} — ${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
