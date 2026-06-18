// Real visual-regression comparison helper (pixelmatch).
//
// Unlike a capture-only `page.screenshot({path})` — which always "passes" — this
// compares two PNG buffers and returns a quantified diffRatio so a test can
// ASSERT (and FAIL on divergence). It also writes a browsable report
// (legacy.png / new.png / diff.png + report.json) under web/visual-report/<name>
// so a human (and Claude) can review every comparison.

import {PNG} from "pngjs";
import pixelmatch from "pixelmatch";
import {mkdirSync, writeFileSync, existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VISUAL_REPORT_DIR = resolve(__dirname, "..", "..", "visual-report");

export interface CompareResult {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  sizeMismatch: boolean;
  diffPng: Buffer;
}

/**
 * Compare two PNG buffers. `pixelThreshold` is pixelmatch's per-pixel color
 * sensitivity (0..1, lower = stricter). Returns diffRatio = differing/total.
 * A size mismatch is treated as full (1.0) divergence.
 */
export function compareImages(aBuf: Buffer, bBuf: Buffer, pixelThreshold = 0.1): CompareResult {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    const blank = new PNG({width: a.width, height: a.height});
    return {
      width: a.width,
      height: a.height,
      diffPixels: a.width * a.height,
      totalPixels: a.width * a.height,
      diffRatio: 1,
      sizeMismatch: true,
      diffPng: PNG.sync.write(blank),
    };
  }
  const {width, height} = a;
  const diff = new PNG({width, height});
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {threshold: pixelThreshold});
  const totalPixels = width * height;
  return {
    width,
    height,
    diffPixels,
    totalPixels,
    diffRatio: diffPixels / totalPixels,
    sizeMismatch: false,
    diffPng: PNG.sync.write(diff),
  };
}

/** Write the browsable report under web/visual-report/<name>/. */
export function writeVisualReport(
  name: string,
  legacy: Buffer,
  next: Buffer,
  diffPng: Buffer,
  meta: Record<string, unknown>,
): void {
  const dir = join(VISUAL_REPORT_DIR, name);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, "legacy.png"), legacy);
  writeFileSync(join(dir, "new.png"), next);
  writeFileSync(join(dir, "diff.png"), diffPng);
  writeFileSync(join(dir, "report.json"), JSON.stringify(meta, null, 2) + "\n");
}

/** Persist a baseline image (legacy render) for later comparison + review. */
export function writeBaseline(name: string, file: string, buf: Buffer): void {
  const dir = join(VISUAL_REPORT_DIR, name);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, file), buf);
}

export function baselinePath(name: string, file: string): string {
  return join(VISUAL_REPORT_DIR, name, file);
}

export function readBaseline(name: string, file: string): Buffer | null {
  const p = baselinePath(name, file);
  return existsSync(p) ? readFileSync(p) : null;
}

/** A solid-color PNG (used as a negative control in the gate self-test). */
export function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({width, height});
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}
