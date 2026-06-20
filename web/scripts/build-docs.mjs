// scripts/build-docs.mjs
//
// Build the new Svelte/Vite app into the repo-root `docs/` folder, which is the
// GitHub Pages publish source (served at the custom domain velodrive.bike, so
// the app builds at base "/"). Run from web/: `npm run build:docs`.
//
// Steps:
//   1. vite build -> web/dist (same output the e2e suite tests).
//   2. Replace repo-root docs/ with that output.
//   3. Re-add the Pages essentials Vite doesn't emit:
//        - CNAME      (preserves the velodrive.bike custom domain)
//        - .nojekyll  (stops Jekyll from touching the build, belt-and-braces)
//
// The legacy app that used to live in docs/ now lives in repo-root legacy/ (the
// test oracle); CNAME is sourced from there.

import { execSync } from 'node:child_process';
import { cpSync, rmSync, copyFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');
const dist = resolve(webRoot, 'dist');
const docs = resolve(repoRoot, 'docs');
const legacy = resolve(repoRoot, 'legacy');

console.log('[build-docs] 1/3  vite build -> dist/');
execSync('npx vite build', { cwd: webRoot, stdio: 'inherit' });

console.log('[build-docs] 2/3  publish dist/ -> docs/');
rmSync(docs, { recursive: true, force: true });
cpSync(dist, docs, { recursive: true });

console.log('[build-docs] 3/3  Pages essentials');
const cname = resolve(legacy, 'CNAME');
if (existsSync(cname)) {
  copyFileSync(cname, resolve(docs, 'CNAME'));
  console.log('            + CNAME (custom domain preserved)');
} else {
  console.warn('            ! legacy/CNAME not found — custom domain NOT set');
}
writeFileSync(resolve(docs, '.nojekyll'), '');
console.log('            + .nojekyll');

const top = readdirSync(docs).sort();
console.log(`[build-docs] done — docs/ now has ${top.length} entries:`);
console.log('            ' + top.join('  '));
