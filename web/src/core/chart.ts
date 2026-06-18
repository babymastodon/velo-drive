// chart.ts
//
// Focused TypeScript port of docs/workout-chart.js `drawWorkoutChart` for the
// live HUD. Renders the workout profile (interval blocks), the FTP line, the
// playback position cursor, a past-shade, and the live power/HR/cadence traces
// into an existing <svg>. Geometry, colors, and magic numbers are preserved
// verbatim from the legacy module (the non-interactive HUD subset: hover wiring,
// tooltips, text-event overlay, grid lines, and ERG/builder/history paths are
// intentionally dropped — they are separable in the legacy code too).

import { DEFAULT_FTP, formatDurationMinSec } from './metrics.js';
import type { RawSegment } from './model.js';

const FREERIDE_POWER_REL = 0.5;
const GAP_BREAK_SECONDS = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

let freeridePatternCounter = 0;

export interface LiveSample {
  t: number;
  power?: number | null;
  hr?: number | null;
  cadence?: number | null;
}

export interface DrawWorkoutChartArgs {
  svg: SVGSVGElement;
  width: number;
  height: number;
  ftp: number;
  rawSegments: RawSegment[];
  elapsedSec: number;
  liveSamples: LiveSample[];
  manualErgTarget?: number;
  showProgress?: boolean;
}

// --------------------------- CSS / color helpers ---------------------------

export function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  let s = hex.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

export function mixColors(hexA: string, hexB: string, factor: number): string {
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  if (!a || !b) return hexA;
  const f = Math.min(1, Math.max(0, factor));
  const r = Math.round(a.r * (1 - f) + b.r * f);
  const g = Math.round(a.g * (1 - f) + b.g * f);
  const bC = Math.round(a.b * (1 - f) + b.b * f);
  const toHex = (x: number) => x.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bC)}`;
}

function isFreeRideSegment(seg: RawSegment): boolean {
  return Array.isArray(seg) && seg[3] === 'freeride';
}

function getRawCadence(seg: RawSegment): number | null {
  if (!Array.isArray(seg)) return null;
  if (seg[3] === 'freeride') return null;
  if (Number.isFinite(seg[4] as number)) return Number(seg[4]);
  if (typeof seg[3] === 'number' && Number.isFinite(seg[3])) return Number(seg[3]);
  return null;
}

export function getScaledMaxY({
  ftp,
  peak,
  minBase = 200,
}: {
  ftp: number;
  peak: number;
  minBase?: number;
}): number {
  const ftpVal = Number(ftp) || 0;
  const baseFtp = ftpVal > 0 ? ftpVal : DEFAULT_FTP;
  const step = baseFtp > 0 ? baseFtp : 200;
  let maxY = Math.max(minBase, baseFtp * 2);
  const target = Number(peak) || 0;
  while (target > 0 && maxY < target) maxY += step;
  return maxY;
}

// --------------------------- Zone / color mapping ---------------------------

export function zoneInfoFromRel(rel: number): { key: string; color: string; bg: string } {
  const pct = Math.max(0, rel) * 100;
  let key = 'Recovery';
  if (pct < 60) key = 'Recovery';
  else if (pct < 76) key = 'Endurance';
  else if (pct < 90) key = 'Tempo';
  else if (pct < 105) key = 'Threshold';
  else if (pct < 119) key = 'VO2Max';
  else key = 'Anaerobic';

  const colorVarMap: Record<string, string> = {
    Recovery: '--zone-recovery',
    Endurance: '--zone-endurance',
    Tempo: '--zone-tempo',
    Threshold: '--zone-threshold',
    VO2Max: '--zone-vo2',
    Anaerobic: '--zone-anaerobic',
  };

  const color = getCssVar(colorVarMap[key] || '--zone-recovery');
  const bg = getCssVar('--bg') || '#f4f4f4';
  return { key, color, bg };
}

// --------------------------- SVG helpers ---------------------------

interface FreeridePatternIds {
  baseId: string;
  hoverId: string;
}

function clearSvg(svg: SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds }): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  delete svg._freeridePatternIds;
}

function ensureFreeridePatterns(
  svg: SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds },
): FreeridePatternIds {
  if (svg._freeridePatternIds) return svg._freeridePatternIds;

  const baseFill = getCssVar('--freeride-fill') || '#d0d0d0';
  const stripe = getCssVar('--freeride-stripe') || '#b2b2b2';
  const bg = getCssVar('--bg') || '#f4f4f4';
  const hoverFill = mixColors(baseFill, bg, 0.18);
  const hoverStripe = mixColors(stripe, bg, 0.18);

  const baseId = `freeride-pattern-${++freeridePatternCounter}`;
  const hoverId = `${baseId}-hover`;

  const defs = svg.querySelector('defs') || document.createElementNS(SVG_NS, 'defs');
  if (!defs.parentNode) svg.appendChild(defs);

  const buildPattern = (id: string, fill: string, stripeColor: string) => {
    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '16');
    pattern.setAttribute('height', '16');
    pattern.setAttribute('patternTransform', 'rotate(45)');

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '16');
    rect.setAttribute('height', '16');
    rect.setAttribute('fill', fill);
    pattern.appendChild(rect);

    for (const d of ['M-8 4 Q-4 0 0 4 T8 4 T16 4 T24 4', 'M-8 12 Q-4 8 0 12 T8 12 T16 12 T24 12']) {
      const wave = document.createElementNS(SVG_NS, 'path');
      wave.setAttribute('d', d);
      wave.setAttribute('fill', 'none');
      wave.setAttribute('stroke', stripeColor);
      wave.setAttribute('stroke-width', '2.2');
      wave.setAttribute('stroke-linecap', 'round');
      pattern.appendChild(wave);
    }
    defs.appendChild(pattern);
  };

  buildPattern(baseId, baseFill, stripe);
  buildPattern(hoverId, hoverFill, hoverStripe);

  svg._freeridePatternIds = { baseId, hoverId };
  return svg._freeridePatternIds;
}

function totalDurationSec(rawSegments: RawSegment[]): number {
  return rawSegments.reduce((sum, seg) => sum + Math.max(1, Math.round((seg[0] || 0) * 60)), 0);
}

function renderSegmentPolygon(args: {
  svg: SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds };
  totalSec: number;
  width: number;
  height: number;
  ftp: number;
  maxY: number;
  tStart: number;
  tEnd: number;
  pStartRel: number;
  pEndRel: number;
  isFreeride: boolean;
  cadenceRpm: number | null;
}): void {
  const { svg, totalSec, width, height, ftp, maxY, tStart, tEnd, pStartRel, pEndRel, isFreeride } =
    args;
  if (!svg || totalSec <= 0) return;

  const w = width;
  const h = height;
  const x1 = (tStart / totalSec) * w;
  const x2 = (tEnd / totalSec) * w;

  const avgRel = (pStartRel + pEndRel) / 2;
  const zone = isFreeride
    ? { key: 'Free ride', color: getCssVar('--freeride-fill'), bg: getCssVar('--bg') }
    : zoneInfoFromRel(avgRel);

  const p0 = pStartRel * ftp;
  const p1 = pEndRel * ftp;
  const y0 = h - (Math.max(0, p0) / maxY) * h;
  const y1 = h - (Math.max(0, p1) / maxY) * h;

  const poly = document.createElementNS(SVG_NS, 'polygon');
  poly.setAttribute('points', `${x1},${h} ${x1},${y0} ${x2},${y1} ${x2},${h}`);

  const muted = mixColors(zone.color, zone.bg, 0.3);
  const hover = mixColors(zone.color, zone.bg, 0.15);

  if (isFreeride) {
    const patterns = ensureFreeridePatterns(svg);
    poly.setAttribute('fill', `url(#${patterns.baseId})`);
    poly.dataset.freeRide = 'true';
    poly.dataset.hoverColor = `url(#${patterns.hoverId})`;
  } else {
    poly.setAttribute('fill', muted);
    poly.dataset.color = zone.color;
    poly.dataset.mutedColor = muted;
    poly.dataset.hoverColor = hover;
  }

  poly.setAttribute('fill-opacity', '1');
  poly.setAttribute('stroke', 'none');
  poly.setAttribute('shape-rendering', 'crispEdges');
  poly.classList.add('chart-segment');
  poly.dataset.zone = zone.key;
  svg.appendChild(poly);
}

// --------------------------- public ---------------------------

/**
 * Render the live HUD chart into the given SVG (mutated in place).
 * Mirrors docs/workout-chart.js drawWorkoutChart (workout mode, HUD subset).
 */
export function drawWorkoutChart(args: DrawWorkoutChartArgs): void {
  const {
    svg: rawSvg,
    width,
    height,
    ftp,
    rawSegments,
    elapsedSec,
    liveSamples,
    showProgress = true,
  } = args;
  const svg = rawSvg as SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds };
  if (!svg) return;

  clearSvg(svg);

  const w = width;
  const h = height;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const samples = Array.isArray(liveSamples) ? liveSamples : [];
  const ftpVal = ftp || DEFAULT_FTP;

  // peak power for vertical scale
  let maxTarget = 0;
  for (const seg of rawSegments) {
    const startPct = isFreeRideSegment(seg) ? FREERIDE_POWER_REL * 100 : seg[1] || 0;
    const endPct = isFreeRideSegment(seg)
      ? FREERIDE_POWER_REL * 100
      : seg[2] != null
        ? seg[2]
        : seg[1] || 0;
    maxTarget = Math.max(maxTarget, (startPct / 100) * ftpVal, (endPct / 100) * ftpVal);
  }
  let maxLivePower = 0;
  for (const s of samples) {
    if (Number.isFinite(s.power as number)) maxLivePower = Math.max(maxLivePower, Number(s.power));
  }
  const peak = Math.max(maxTarget, maxLivePower, args.manualErgTarget || 0);
  const maxY = getScaledMaxY({ ftp: ftpVal, peak });

  // grid (every 100 W) — drawn beneath the profile blocks
  {
    const step = 100;
    for (let yVal = 0; yVal <= maxY; yVal += step) {
      const y = h - (yVal / maxY) * h;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(w));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', getCssVar('--grid-line-subtle'));
      line.setAttribute('stroke-width', '0.5');
      line.setAttribute('pointer-events', 'none');
      svg.appendChild(line);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '4');
      label.setAttribute('y', String(y - 6));
      label.setAttribute('font-size', '16');
      label.setAttribute('fill', getCssVar('--text-muted'));
      label.setAttribute('pointer-events', 'none');
      label.textContent = String(yVal);
      svg.appendChild(label);
    }
  }

  const totalFromStructure = rawSegments.length ? totalDurationSec(rawSegments) : 0;
  const lastSampleT = samples.length ? samples[samples.length - 1]!.t || 0 : 0;
  const safeTotalSec = Math.max(1, totalFromStructure, elapsedSec || 0, lastSampleT);
  const elapsedClamped = Math.max(0, Math.min(safeTotalSec, elapsedSec || 0));

  // profile blocks
  let t = 0;
  for (const seg of rawSegments) {
    const durSec = Math.max(1, Math.round((seg[0] || 0) * 60));
    const isFreeride = isFreeRideSegment(seg);
    const cadenceRpm = getRawCadence(seg);
    const pStartRel = isFreeride ? FREERIDE_POWER_REL : (seg[1] || 0) / 100;
    const pEndRel = isFreeride
      ? FREERIDE_POWER_REL
      : (seg[2] != null ? seg[2] : seg[1] || 0) / 100;
    renderSegmentPolygon({
      svg,
      totalSec: safeTotalSec,
      width: w,
      height: h,
      ftp: ftpVal,
      maxY,
      tStart: t,
      tEnd: t + durSec,
      pStartRel,
      pEndRel,
      isFreeride,
      cadenceRpm,
    });
    t += durSec;
  }

  // past shade
  if (showProgress && elapsedClamped > 0 && safeTotalSec > 0) {
    const xPast = Math.min(w, (elapsedClamped / safeTotalSec) * w);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(xPast));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', getCssVar('--shade-bg'));
    rect.setAttribute('fill-opacity', '0.05');
    rect.setAttribute('pointer-events', 'none');
    svg.appendChild(rect);
  }

  // FTP line + label
  const ftpY = h - (ftpVal / maxY) * h;
  const ftpLineWidth = 1.5;
  const ftpLine = document.createElementNS(SVG_NS, 'line');
  ftpLine.setAttribute('x1', '0');
  ftpLine.setAttribute('x2', String(w));
  ftpLine.setAttribute('y1', String(ftpY));
  ftpLine.setAttribute('y2', String(ftpY));
  ftpLine.setAttribute('stroke', getCssVar('--ftp-line'));
  ftpLine.setAttribute('stroke-width', String(ftpLineWidth));
  ftpLine.setAttribute('pointer-events', 'none');
  svg.appendChild(ftpLine);

  const ftpLabelOffset = 6;
  const ftpFontSize = 16;
  const ftpLabel = document.createElementNS(SVG_NS, 'text');
  ftpLabel.setAttribute('x', String(w - 4));
  ftpLabel.setAttribute('y', String(ftpY - ftpLabelOffset));
  ftpLabel.setAttribute('text-anchor', 'end');
  ftpLabel.setAttribute('font-size', String(ftpFontSize));
  ftpLabel.setAttribute('fill', getCssVar('--ftp-line'));
  ftpLabel.setAttribute('pointer-events', 'none');
  ftpLabel.textContent = `FTP ${Math.round(ftpVal)}`;
  svg.appendChild(ftpLabel);

  if (totalFromStructure > 0) {
    const durLabel = document.createElementNS(SVG_NS, 'text');
    durLabel.setAttribute('x', String(w - 4));
    durLabel.setAttribute('y', String(ftpY + ftpLabelOffset + ftpFontSize - ftpLineWidth * 2));
    durLabel.setAttribute('text-anchor', 'end');
    durLabel.setAttribute('font-size', String(ftpFontSize));
    durLabel.setAttribute('fill', getCssVar('--text-muted'));
    durLabel.setAttribute('pointer-events', 'none');
    durLabel.textContent = formatDurationMinSec(totalFromStructure);
    svg.appendChild(durLabel);
  }

  // position cursor
  if (showProgress && elapsedClamped > 0) {
    const xNow = Math.min(w, (elapsedClamped / safeTotalSec) * w);
    const posLine = document.createElementNS(SVG_NS, 'line');
    posLine.setAttribute('x1', String(xNow));
    posLine.setAttribute('x2', String(xNow));
    posLine.setAttribute('y1', '0');
    posLine.setAttribute('y2', String(h));
    posLine.setAttribute('stroke', '#fdd835');
    posLine.setAttribute('stroke-width', '1.5');
    posLine.setAttribute('pointer-events', 'none');
    svg.appendChild(posLine);
  }

  // live traces
  if (samples.length) {
    const pathsForKey = (key: 'power' | 'hr' | 'cadence'): string[] => {
      const paths: string[] = [];
      let d = '';
      let lastT: number | null = null;
      for (const s of samples) {
        const tv = s.t;
        const val = s[key];
        const hasVal = val != null && Number.isFinite(val as number);
        const hasTime = Number.isFinite(tv);
        if (!hasVal || !hasTime) {
          if (d) {
            paths.push(d);
            d = '';
          }
          lastT = null;
          continue;
        }
        const gap = lastT == null ? 0 : tv - lastT;
        if (lastT != null && gap > GAP_BREAK_SECONDS) {
          if (d) paths.push(d);
          d = '';
        }
        const x = Math.min(w, (tv / safeTotalSec) * w);
        const yVal = Math.min(maxY, Math.max(0, val as number));
        const y = h - (yVal / maxY) * h;
        d += (d ? ' L ' : 'M ') + x + ' ' + y;
        lastT = tv;
      }
      if (d) paths.push(d);
      return paths;
    };

    const addPaths = (segments: string[], color: string, strokeWidth: number) => {
      for (const d of segments) {
        if (!d) continue;
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', String(strokeWidth));
        p.setAttribute('pointer-events', 'none');
        svg.appendChild(p);
      }
    };

    addPaths(pathsForKey('power'), getCssVar('--power-line'), 2.5);
    addPaths(pathsForKey('hr'), getCssVar('--hr-line'), 1.5);
    addPaths(pathsForKey('cadence'), getCssVar('--cad-line'), 1.5);
  }
}
