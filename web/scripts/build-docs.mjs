// scripts/build-docs.mjs
//
// Build the new Svelte/Vite app into the repo-root `docs/` folder, which is the
// GitHub Pages publish source (served at the custom domain velodrive.bike, so
// the app builds at base "/"). Run from web/: `npm run build:docs`.
//
// Steps:
//   1. vite build -> web/dist (same output the e2e suite tests). CNAME ships
//      from public/, so it lands in dist/ automatically (custom domain).
//   2. Replace repo-root docs/ with that output.
//   3. Add .nojekyll (stops Jekyll from touching the build) and verify CNAME.

import { execSync } from 'node:child_process';
import { cpSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');
const dist = resolve(webRoot, 'dist');
const docs = resolve(repoRoot, 'docs');

console.log('[build-docs] 1/3  vite build -> dist/');
execSync('npx vite build', { cwd: webRoot, stdio: 'inherit' });

console.log('[build-docs] 2/3  publish dist/ -> docs/');
rmSync(docs, { recursive: true, force: true });
cpSync(dist, docs, { recursive: true });

console.log('[build-docs] 3/3  Pages essentials');
if (existsSync(resolve(docs, 'CNAME'))) {
  console.log('            + CNAME (custom domain preserved)');
} else {
  console.warn('            ! CNAME missing — expected public/CNAME to be bundled');
}
writeFileSync(resolve(docs, '.nojekyll'), '');
console.log('            + .nojekyll');

const top = readdirSync(docs).sort();
console.log(`[build-docs] done — docs/ now has ${top.length} entries:`);
console.log('            ' + top.join('  '));
