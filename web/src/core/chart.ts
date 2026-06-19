// chart.ts
//
// Focused TypeScript port of docs/workout-chart.js `drawWorkoutChart` for the
// live HUD. Renders the workout profile (interval blocks), the FTP line, the
// playback position cursor, a past-shade, and the live power/HR/cadence traces
// into an existing <svg>. Geometry, colors, and magic numbers are preserved
// verbatim from the legacy module (the non-interactive HUD subset: hover wiring,
// tooltips, text-event overlay, grid lines, and ERG/builder/history paths are
// intentionally dropped — they are separable in the legacy code too).

import { DEFAULT_FTP, formatDurationMinSec, zoneIndexForPct } from './metrics.js';
import type { RawSegment } from './model.js';
import {
  FREERIDE_POWER_REL,
  getRawCadence,
  getRawMinutes,
  isFreeRideSegment,
  segDurationSec,
} from './segments.js';

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
  // Active text-event message overlay (legacy drawWorkoutChart ~2081). When the
  // elapsed time falls within an event window, its text is centered on the chart.
  textEvents?: { offsetSec: number; durationSec: number; text?: string }[];
  // Hover tooltip wiring (legacy drawWorkoutChart `panel`/`tooltipEl`, ~1900).
  // When both are supplied, mousemove over a segment shows zone/power/duration
  // and mousemove over the live trace shows the interpolated power/HR/cadence.
  panel?: HTMLElement | null;
  tooltipEl?: HTMLElement | null;
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
  const key = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2Max', 'Anaerobic'][
    zoneIndexForPct(pct)
  ] as string;

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
  return rawSegments.reduce((sum, seg) => sum + segDurationSec(getRawMinutes(seg)), 0);
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

  const durSec = Math.max(1, Math.round(tEnd - tStart));
  const durMin = durSec / 60;
  poly.dataset.zone = zone.key;
  poly.dataset.p0 = (pStartRel * 100).toFixed(0);
  poly.dataset.p1 = (pEndRel * 100).toFixed(0);
  poly.dataset.durMin = durMin.toFixed(1);
  poly.dataset.durSec = String(durSec);
  if (Number.isFinite(args.cadenceRpm as number)) {
    poly.dataset.cadence = String(Math.round(args.cadenceRpm as number));
  }
  svg.appendChild(poly);
}

// --------------------------- hover engine ---------------------------
//
// Focused port of docs/workout-chart.js `attachSegmentHover` (~712-1063) for the
// non-scrolling, non-drag charts (live HUD + planner ride-detail). Hovering a
// segment shows its zone/power/duration/cadence; hovering over a live trace
// shows the binary-searched, gap-aware interpolated power/HR/cadence at that
// time. The builder/picker mini-charts keep their own (inert) tooltip path.

const hoverCleanupMap = new WeakMap<SVGSVGElement, () => void>();
let lastHoveredSegment: SVGPolygonElement | null = null;

interface HoverOptions {
  liveSamples: LiveSample[];
  totalSec: number;
  width: number;
  height: number;
  maxY: number;
  gapBreakSeconds: number;
}

function attachSegmentHover(
  svg: SVGSVGElement,
  tooltipEl: HTMLElement,
  containerEl: HTMLElement,
  ftp: number,
  options: HoverOptions,
): void {
  const { liveSamples, totalSec, width, height, maxY, gapBreakSeconds } = options;

  const prevCleanup = hoverCleanupMap.get(svg);
  if (prevCleanup) prevCleanup();

  const lineDots: Partial<Record<'power' | 'hr' | 'cadence', SVGCircleElement>> = {};
  const createLineDot = (color: string): SVGCircleElement => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', color);
    dot.setAttribute('pointer-events', 'none');
    dot.style.display = 'none';
    svg.appendChild(dot);
    return dot;
  };

  if (liveSamples.length && totalSec > 0 && width > 0 && height > 0) {
    lineDots.power = createLineDot(getCssVar('--power-line'));
    lineDots.hr = createLineDot(getCssVar('--hr-line'));
    lineDots.cadence = createLineDot(getCssVar('--cad-line'));
  }

  const hideLineDots = (): void => {
    for (const dot of Object.values(lineDots)) if (dot) dot.style.display = 'none';
  };

  const clearSegmentHover = (): void => {
    tooltipEl.style.display = 'none';
    if (lastHoveredSegment) {
      const prevColor =
        lastHoveredSegment.dataset.mutedColor || lastHoveredSegment.dataset.color;
      if (prevColor) lastHoveredSegment.setAttribute('fill', prevColor);
      lastHoveredSegment = null;
    }
  };

  const updateTooltipPosition = (clientX: number, clientY: number): void => {
    const panelRect = containerEl.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const baseLeft = svgRect.left - panelRect.left;
    const viewWidth = svgRect.width || panelRect.width;
    let tx = clientX - panelRect.left + 8;
    let ty = clientY - panelRect.top + 8;

    const ttRect = tooltipEl.getBoundingClientRect();
    const minX = baseLeft;
    const maxX = minX + viewWidth - ttRect.width - 4;
    if (tx > maxX) tx = maxX;
    if (tx < minX) tx = minX;
    if (ty + ttRect.height > panelRect.height - 4) ty = panelRect.height - ttRect.height - 4;
    if (ty < 0) ty = 0;

    tooltipEl.style.left = `${tx}px`;
    tooltipEl.style.top = `${ty}px`;
  };

  const findSamplesAroundForKey = (
    targetT: number,
    key: 'power' | 'hr' | 'cadence',
  ): { prev: LiveSample | null; next: LiveSample | null } => {
    if (!liveSamples.length) return { prev: null, next: null };
    let lo = 0;
    let hi = liveSamples.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = Number(liveSamples[mid]?.t);
      if (!Number.isFinite(t) || t < targetT) lo = mid + 1;
      else hi = mid;
    }

    let prevIdx = lo;
    while (prevIdx >= 0) {
      const s = liveSamples[prevIdx];
      if (Number.isFinite(s?.t) && Number.isFinite(s?.[key] as number)) break;
      prevIdx -= 1;
    }
    let nextIdx = lo;
    while (nextIdx < liveSamples.length) {
      const s = liveSamples[nextIdx];
      if (Number.isFinite(s?.t) && Number.isFinite(s?.[key] as number)) break;
      nextIdx += 1;
    }
    return {
      prev: prevIdx >= 0 ? liveSamples[prevIdx]! : null,
      next: nextIdx < liveSamples.length ? liveSamples[nextIdx]! : null,
    };
  };

  interface LineHover {
    x: number;
    y: number;
    label: string;
    unit: string;
    val: number;
    key: 'power' | 'hr' | 'cadence';
  }

  const getLineHover = (clientX: number, clientY: number): LineHover | null => {
    if (!Object.keys(lineDots).length) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return null;
    const svgX = (relX / rect.width) * width;
    const svgY = (relY / rect.height) * height;
    const targetT = (svgX / width) * totalSec;
    const keys: { key: 'power' | 'hr' | 'cadence'; label: string; unit: string }[] = [
      { key: 'power', label: 'Power', unit: 'W' },
      { key: 'hr', label: 'Heart Rate', unit: 'bpm' },
      { key: 'cadence', label: 'Cadence', unit: 'rpm' },
    ];

    const HIT_PX = 16;
    let best: { key: 'power' | 'hr' | 'cadence'; label: string; unit: string; val: number; y: number; dist: number } | null =
      null;
    for (const { key, label, unit } of keys) {
      const { prev, next } = findSamplesAroundForKey(targetT, key);
      if (!prev && !next) continue;
      const prevT = Number(prev?.t);
      const nextT = Number(next?.t);
      const prevVal = prev ? Number(prev[key]) : null;
      const nextVal = next ? Number(next[key]) : null;
      let val: number | null = null;

      if (Number.isFinite(prevT) && Number.isFinite(nextT)) {
        if (
          gapBreakSeconds &&
          nextT - prevT > gapBreakSeconds &&
          targetT > prevT &&
          targetT < nextT
        ) {
          continue;
        }
        const span = nextT - prevT;
        if (span > 0 && Number.isFinite(prevVal as number) && Number.isFinite(nextVal as number)) {
          const t = (targetT - prevT) / span;
          val = (prevVal as number) + ((nextVal as number) - (prevVal as number)) * t;
        } else if (Number.isFinite(prevVal as number) && targetT <= prevT) {
          val = prevVal;
        } else if (Number.isFinite(nextVal as number) && targetT >= nextT) {
          val = nextVal;
        }
      } else if (Number.isFinite(prevVal as number)) {
        val = prevVal;
      } else if (Number.isFinite(nextVal as number)) {
        val = nextVal;
      }

      if (!Number.isFinite(val as number)) continue;
      const yVal = Math.min(maxY, Math.max(0, val as number));
      const y = height - (yVal / maxY) * height;
      const dist = Math.abs(y - svgY);
      if (dist > HIT_PX) continue;
      if (!best || dist < best.dist) best = { key, label, unit, val: val as number, y, dist };
    }

    if (!best) return null;
    const x = Math.min(width, Math.max(0, (targetT / totalSec) * width));
    return { x, y: best.y, label: best.label, unit: best.unit, val: best.val, key: best.key };
  };

  const applyHoverAtClientPos = (clientX: number, clientY: number): void => {
    if (lastHoveredSegment && !document.contains(lastHoveredSegment)) lastHoveredSegment = null;

    const lineHover = getLineHover(clientX, clientY);
    if (lineHover) {
      clearSegmentHover();
      hideLineDots();
      const dot = lineDots[lineHover.key];
      if (dot) {
        dot.setAttribute('cx', String(lineHover.x));
        dot.setAttribute('cy', String(lineHover.y));
        dot.style.display = 'block';
      }
      tooltipEl.textContent = `${lineHover.label}: ${Math.round(lineHover.val)} ${lineHover.unit}`;
      tooltipEl.style.display = 'block';
      updateTooltipPosition(clientX, clientY);
      return;
    }

    hideLineDots();

    const hitEl = document.elementFromPoint(clientX, clientY);
    const segment =
      hitEl && hitEl.closest ? (hitEl.closest('.chart-segment') as SVGPolygonElement | null) : null;
    if (!segment || !svg.contains(segment)) {
      clearSegmentHover();
      return;
    }

    const zone = segment.dataset.zone;
    const p0 = segment.dataset.p0;
    const p1 = segment.dataset.p1;
    const durSec = Math.max(1, Math.round(Number(segment.dataset.durSec) || 0));
    const durMin = durSec / 60;
    const dur = durSec >= 60 ? `${durMin.toFixed(1)} min` : `${durSec} sec`;
    const w0 = Math.round((Number(p0) * ftp) / 100);
    const w1 = Math.round((Number(p1) * ftp) / 100);
    const cadence = segment.dataset.cadence;
    const cadenceSuffix = cadence ? `, ${cadence} rpm` : '';

    if (segment.dataset.freeRide === 'true') {
      tooltipEl.textContent = `Free ride: ${dur}${cadenceSuffix}`;
    } else {
      tooltipEl.textContent =
        p0 === p1
          ? `${zone}: ${p0}% FTP, ${w0}W, ${dur}${cadenceSuffix}`
          : `${zone}: ${p0}–${p1}% FTP, ${w0}-${w1}W, ${dur}${cadenceSuffix}`;
    }
    tooltipEl.style.display = 'block';
    updateTooltipPosition(clientX, clientY);

    if (lastHoveredSegment && lastHoveredSegment !== segment) {
      const prevColor =
        lastHoveredSegment.dataset.mutedColor || lastHoveredSegment.dataset.color;
      if (prevColor) lastHoveredSegment.setAttribute('fill', prevColor);
    }
    const hoverColor =
      segment.dataset.hoverColor || segment.dataset.color || segment.dataset.mutedColor;
    if (hoverColor) segment.setAttribute('fill', hoverColor);
    lastHoveredSegment = segment;
  };

  const onMouseMove = (e: MouseEvent): void => applyHoverAtClientPos(e.clientX, e.clientY);
  const onMouseLeave = (): void => {
    hideLineDots();
    clearSegmentHover();
  };

  svg.addEventListener('mousemove', onMouseMove);
  svg.addEventListener('mouseleave', onMouseLeave);
  hoverCleanupMap.set(svg, () => {
    svg.removeEventListener('mousemove', onMouseMove);
    svg.removeEventListener('mouseleave', onMouseLeave);
  });
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
    const durSec = segDurationSec(getRawMinutes(seg));
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

  // Active text-event message overlay (legacy drawWorkoutChart ~2081): the LAST
  // event whose window contains the elapsed time is centered on the chart.
  const textEvents = args.textEvents;
  if (Array.isArray(textEvents) && textEvents.length && elapsedSec != null) {
    const active = textEvents
      .map((evt) => ({
        offsetSec: Math.max(0, Number(evt?.offsetSec) || 0),
        durationSec: Math.max(1, Math.round(Number(evt?.durationSec) || 10)),
        text: evt?.text || '',
      }))
      .filter(
        (evt) => elapsedClamped >= evt.offsetSec && elapsedClamped <= evt.offsetSec + evt.durationSec,
      )
      .pop();
    if (active && active.text) {
      const fontSize = Math.max(14, Math.round(Math.min(w, h) / 7));
      const maxWidth = Math.max(120, Math.round(w * 0.88));
      const x = Math.round((w - maxWidth) / 2);
      const y = Math.round(h * 0.22);
      const foreign = document.createElementNS(SVG_NS, 'foreignObject');
      foreign.setAttribute('x', String(x));
      foreign.setAttribute('y', String(y));
      foreign.setAttribute('width', String(maxWidth));
      foreign.setAttribute('height', String(Math.round(h * 0.5)));
      foreign.setAttribute('pointer-events', 'none');
      const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
      div.textContent = active.text;
      div.style.color = getCssVar('--text-main');
      div.style.fontSize = `${fontSize}px`;
      div.style.fontWeight = '600';
      div.style.lineHeight = '1.2';
      div.style.textAlign = 'center';
      div.style.whiteSpace = 'normal';
      div.style.wordBreak = 'break-word';
      div.style.textShadow = '0 0 12px var(--chart-empty-shadow)';
      foreign.appendChild(div);
      svg.appendChild(foreign);
    }
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

  // Hover tooltip (legacy attachSegmentHover): segment + live-trace tooltips.
  if (args.panel && args.tooltipEl) {
    attachSegmentHover(svg, args.tooltipEl, args.panel, ftpVal, {
      liveSamples: samples,
      totalSec: safeTotalSec,
      width: w,
      height: h,
      maxY,
      gapBreakSeconds: GAP_BREAK_SECONDS,
    });
  }
}

// --------------------------- Mini workout graph (picker) ---------------------------

/**
 * Render a small workout profile chart into a container for the picker's
 * expanded row. Mirrors docs/workout-chart.js renderMiniWorkoutGraph (the
 * non-interactive subset: segment polygons + a transparent hover bg + an empty
 * tooltip div, so the DOM matches legacy for the visual diff). Geometry/scale
 * are preserved verbatim.
 */
export function renderMiniWorkoutGraph(
  container: HTMLElement,
  workout: { rawSegments?: RawSegment[] } | null | undefined,
  currentFtp: number,
): void {
  container.innerHTML = '';

  const rawSegments = workout?.rawSegments || [];
  if (!rawSegments.length) {
    container.textContent = 'No workout structure available.';
    container.classList.add('picker-detail-empty');
    return;
  }

  const ftp = currentFtp || DEFAULT_FTP;

  const totalSec = totalDurationSec(rawSegments);
  if (!totalSec) {
    container.textContent = 'No workout structure available.';
    container.classList.add('picker-detail-empty');
    return;
  }

  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;
  if (!width) width = container.clientWidth || 400;
  if (!height) height = container.clientHeight || 200;

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement & {
    _freeridePatternIds?: FreeridePatternIds;
  };
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('picker-graph-svg');
  svg.setAttribute('shape-rendering', 'crispEdges');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', 'transparent');
  svg.appendChild(bg);

  const maxTarget = rawSegments.reduce((max, seg) => {
    const startPct = (seg as number[])[1] || 0;
    const endPct = (seg as number[])[2] != null ? (seg as number[])[2]! : startPct;
    const isFreeride = isFreeRideSegment(seg);
    const p0 = (isFreeride ? FREERIDE_POWER_REL * 100 : startPct) * ftp * 0.01;
    const p1 = (isFreeride ? FREERIDE_POWER_REL * 100 : endPct) * ftp * 0.01;
    return Math.max(max, p0, p1);
  }, 0);
  const maxY = getScaledMaxY({ ftp, peak: maxTarget, minBase: 200 });

  let t = 0;
  for (const seg of rawSegments) {
    const durSec = segDurationSec(getRawMinutes(seg));
    const isFreeride = isFreeRideSegment(seg);
    const cadenceRpm = getRawCadence(seg);
    const pStartRel = isFreeride ? FREERIDE_POWER_REL : (seg[1] || 0) / 100;
    const pEndRel = isFreeride
      ? FREERIDE_POWER_REL
      : (seg[2] != null ? seg[2] : seg[1] || 0) / 100;
    renderSegmentPolygon({
      svg,
      totalSec,
      width,
      height,
      ftp,
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

  const tooltip = document.createElement('div');
  tooltip.className = 'picker-tooltip';

  container.appendChild(svg);
  container.appendChild(tooltip);
}

// --------------------------- Builder mini chart ---------------------------
//
// Port of docs/workout-chart.js renderBuilderWorkoutGraph: operates on parsed
// BLOCKS (not flattened rawSegments), draws grid + time ticks, block highlight
// bands, segment polygons with per-block/seg drag-handle datasets, top/right
// drag handles, the FTP line, text-event markers, an insert-after dashed line,
// and the scroll-pinned axis-overlay labels. Geometry/colors/magic numbers are
// preserved verbatim. The chart is rendered into `container` (an existing host
// element). Click/hover wiring is attached when callbacks are supplied; the
// pointer-down drag engine lives in the BuilderView host.

import type { Block, BlockSegment } from './builder-backend.js';

function computeBlockTimings(blocks: Block[]): {
  timings: { index: number; tStart: number; tEnd: number }[];
  totalSec: number;
} {
  const timings: { index: number; tStart: number; tEnd: number }[] = [];
  let totalSec = 0;
  (blocks || []).forEach((block, idx) => {
    const start = totalSec;
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    for (const seg of segs) {
      totalSec += Math.max(1, Math.round(seg?.durationSec || 0));
    }
    timings.push({ index: idx, tStart: start, tEnd: totalSec });
  });
  return { timings, totalSec };
}

/** Render a single builder segment polygon, returning the element so the caller
 * can stamp block/seg datasets + classes (mirrors the legacy inline body). */
function renderBuilderSegmentPolygon(args: {
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
}): SVGPolygonElement | undefined {
  const {
    svg,
    totalSec,
    width,
    height,
    ftp,
    maxY,
    tStart,
    tEnd,
    pStartRel,
    pEndRel,
    isFreeride,
    cadenceRpm,
  } = args;
  if (!svg || totalSec <= 0) return undefined;
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
    poly.dataset.color = `url(#${patterns.baseId})`;
    poly.dataset.mutedColor = `url(#${patterns.baseId})`;
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

  const durSec = Math.max(1, Math.round(tEnd - tStart));
  const durMin = durSec / 60;
  poly.dataset.zone = zone.key;
  poly.dataset.p0 = (pStartRel * 100).toFixed(0);
  poly.dataset.p1 = (pEndRel * 100).toFixed(0);
  poly.dataset.durMin = durMin.toFixed(1);
  poly.dataset.durSec = String(durSec);
  if (Number.isFinite(cadenceRpm as number)) {
    poly.dataset.cadence = String(Math.round(cadenceRpm as number));
  }

  svg.appendChild(poly);
  return poly;
}

function renderBuilderTextEventMarkers(args: {
  svg: SVGSVGElement;
  textEvents: { offsetSec: number; durationSec: number; text?: string }[];
  totalSec: number;
  width: number;
  height: number;
  activeIndex: number | null;
}): void {
  const { svg, textEvents, totalSec, width, height, activeIndex } = args;
  if (!svg || !Array.isArray(textEvents) || !textEvents.length) return;
  const controlHeight = parseFloat(getCssVar('--nav-control-height')) || 36;
  const iconSize = Math.max(18, Math.round(controlHeight));
  const tickHeight = Math.max(10, Math.round(iconSize * 0.28));
  const topOffset = 6;
  const iconY = Math.max(0, Math.min(height - iconSize - 2, topOffset + tickHeight));
  const bg = getCssVar('--surface-elevated') || '#f4f4f4';
  const border = getCssVar('--border-subtle') || '#bdbdbd';
  const textColor = getCssVar('--text-main') || '#1f1f1f';
  const activeBg = getCssVar('--hover-medium') || '#e2e2e2';

  textEvents.forEach((evt, idx) => {
    const offsetSec = Math.max(0, Number(evt?.offsetSec) || 0);
    const durationSec = Math.max(1, Math.round(Number(evt?.durationSec) || 10));
    const x = (offsetSec / Math.max(1, totalSec)) * width;
    const clampedX = Math.max(0, Math.min(width, x));

    const marker = document.createElementNS(SVG_NS, 'g');
    marker.classList.add('wb-text-event');
    if (activeIndex === idx) marker.classList.add('is-active');
    const tooltipText = `${durationSec}s: ${evt?.text || 'Text event'}`;
    marker.dataset.textEventIndex = String(idx);
    marker.dataset.dragHandle = 'text-event';
    marker.dataset.textEventTooltip = tooltipText;

    const tick = document.createElementNS(SVG_NS, 'line');
    tick.classList.add('wb-text-event-tick');
    tick.setAttribute('x1', String(clampedX));
    tick.setAttribute('x2', String(clampedX));
    tick.setAttribute('y1', '0');
    tick.setAttribute('y2', String(tickHeight));
    tick.setAttribute('stroke', border);
    tick.setAttribute('stroke-width', '1.4');
    tick.setAttribute('pointer-events', 'none');
    marker.appendChild(tick);

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${clampedX - iconSize / 2}, ${iconY})`);
    g.style.color = textColor;
    g.setAttribute('pointer-events', 'all');
    g.dataset.textEventIndex = String(idx);
    g.dataset.dragHandle = 'text-event';
    g.dataset.textEventTooltip = tooltipText;

    const rectStrokeWidth = activeIndex === idx ? 2 : 1;
    const rectInset = rectStrokeWidth / 2;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(rectInset));
    rect.setAttribute('y', String(rectInset));
    rect.setAttribute('width', String(iconSize - rectStrokeWidth));
    rect.setAttribute('height', String(iconSize - rectStrokeWidth));
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', activeIndex === idx ? activeBg : bg);
    rect.setAttribute('stroke', border);
    rect.setAttribute('stroke-width', String(rectStrokeWidth));
    g.appendChild(rect);

    const iconGroup = document.createElementNS(SVG_NS, 'g');
    const bubble = document.createElementNS(SVG_NS, 'path');
    const iconPadding = Math.max(3, Math.round(iconSize * 0.24));
    const half = 0.5;
    const left = iconPadding + half;
    const right = iconSize - iconPadding - half;
    const top = iconPadding + half;
    const tailHeight = 2;
    const bottom = iconSize - iconPadding - tailHeight - 2.5;
    const tailWidth = 3.5;
    const bubbleBottom = bottom + tailHeight;
    const bubbleCenterY = (top + bubbleBottom) / 2;
    const desiredCenterY = iconSize / 2;
    const offsetY = Math.round((desiredCenterY - bubbleCenterY) * 2) / 2;
    if (offsetY) iconGroup.setAttribute('transform', `translate(0 ${offsetY})`);
    bubble.setAttribute(
      'd',
      `M${left} ${top}H${right}V${bottom}H${left + tailWidth}L${left} ${
        bottom + tailHeight
      }V${bottom}H${left}Z`,
    );
    bubble.setAttribute('fill', 'none');
    bubble.setAttribute('stroke', 'currentColor');
    bubble.setAttribute('stroke-width', '1');
    bubble.setAttribute('stroke-linecap', 'round');
    bubble.setAttribute('stroke-linejoin', 'round');
    iconGroup.appendChild(bubble);

    const line1 = document.createElementNS(SVG_NS, 'path');
    const lineLeft = left + 2;
    const lineRight = right - 2;
    const line1Y = top + 2.5;
    line1.setAttribute('d', `M${lineLeft} ${line1Y}H${lineRight}`);
    line1.setAttribute('fill', 'none');
    line1.setAttribute('stroke', 'currentColor');
    line1.setAttribute('stroke-width', '1');
    line1.setAttribute('stroke-linecap', 'round');
    iconGroup.appendChild(line1);

    const line2 = document.createElementNS(SVG_NS, 'path');
    line2.setAttribute('d', `M${lineLeft} ${top + 4.5}H${right - 4}`);
    line2.setAttribute('fill', 'none');
    line2.setAttribute('stroke', 'currentColor');
    line2.setAttribute('stroke-width', '1');
    line2.setAttribute('stroke-linecap', 'round');
    iconGroup.appendChild(line2);

    [top + 6.5, top + 8.5].forEach((y, i) => {
      const line = document.createElementNS(SVG_NS, 'path');
      const inset = i + 3;
      line.setAttribute('d', `M${lineLeft} ${y}H${right - inset}`);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-linecap', 'round');
      iconGroup.appendChild(line);
    });

    g.appendChild(iconGroup);
    marker.appendChild(g);
    svg.appendChild(marker);
  });
}

export interface BuilderGraphOptions {
  selectedBlockIndex?: number | null;
  selectedBlockIndices?: number[] | null;
  insertAfterBlockIndex?: number | null;
  textEvents?: { offsetSec: number; durationSec: number; text?: string }[];
  activeTextEventIndex?: number | null;
  lockTimelineSec?: number | null;
  onSelectBlock?: (idx: number | null, opts?: { shiftKey?: boolean }) => void;
  onSetInsertAfter?: (idx: number) => void;
  onSetInsertAfterFromSegment?: (idx: number) => void;
}

/**
 * Render the builder workout chart into `container`. Port of
 * docs/workout-chart.js renderBuilderWorkoutGraph (geometry/colors verbatim).
 * Returns nothing; mutates `container`.
 */
export function renderBuilderWorkoutGraph(
  container: HTMLElement,
  blocks: Block[],
  currentFtp: number,
  options: BuilderGraphOptions = {},
): void {
  const {
    selectedBlockIndex = null,
    selectedBlockIndices = null,
    insertAfterBlockIndex = null,
    textEvents = [],
    activeTextEventIndex = null,
    onSelectBlock,
    onSetInsertAfter,
    onSetInsertAfterFromSegment,
    lockTimelineSec = null,
  } = options;

  container.innerHTML = '';
  const scrollEl = container.parentElement;
  const chartCard = container.closest('.wb-chart-card');
  if (chartCard) {
    chartCard
      .querySelectorAll('.wb-chart-axis-overlay')
      .forEach((node) => node.remove());
  }

  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const ftp = currentFtp || DEFAULT_FTP;

  const { timings, totalSec } = computeBlockTimings(safeBlocks);
  const segmentTimings: { blockIndex: number; segIndex: number; tStart: number; tEnd: number }[] = [];
  let segCursor = 0;
  safeBlocks.forEach((block, blockIndex) => {
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    segs.forEach((seg, segIndex) => {
      const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
      segmentTimings.push({
        blockIndex,
        segIndex,
        tStart: segCursor,
        tEnd: segCursor + durSec,
      });
      segCursor += durSec;
    });
  });

  const rect = container.getBoundingClientRect();
  let baseWidth = rect.width;
  let height = rect.height;
  if (!baseWidth) baseWidth = container.clientWidth || 400;
  if (!height) height = container.clientHeight || 120;

  const timelineSec = Math.max(3600, totalSec || 0, lockTimelineSec || 0);
  const width = Math.max(1, Math.round((timelineSec / 3600) * baseWidth));

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement & {
    _freeridePatternIds?: FreeridePatternIds;
  };
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('picker-graph-svg');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', 'transparent');
  svg.appendChild(bg);

  const maxTarget = safeBlocks.reduce((max, block) => {
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    return segs.reduce((segMax, seg) => {
      const pStartRel = Number(seg?.pStartRel) || 0;
      const pEndRel = seg?.pEndRel != null ? Number(seg.pEndRel) : pStartRel;
      return Math.max(segMax, pStartRel * ftp, pEndRel * ftp);
    }, max);
  }, 0);
  const maxY = getScaledMaxY({ ftp, peak: maxTarget, minBase: 200 });
  const gridStep = 100;
  const tickStepSec = 600;
  const hourStepSec = 3600;
  const tickBaseLen = 24;
  const tickHourLen = 32;

  for (let yVal = 0; yVal <= maxY; yVal += gridStep) {
    const y = height - (yVal / maxY) * height;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', String(width));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', getCssVar('--grid-line-subtle'));
    line.setAttribute('stroke-width', '0.5');
    line.setAttribute('pointer-events', 'none');
    svg.appendChild(line);
  }

  for (let t = tickStepSec; t <= timelineSec; t += tickStepSec) {
    const x = (t / timelineSec) * width;
    const isHour = t % hourStepSec === 0;
    const tickLen = isHour ? tickHourLen : tickBaseLen;
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', String(x));
    tick.setAttribute('x2', String(x));
    tick.setAttribute('y1', '0');
    tick.setAttribute('y2', String(tickLen));
    tick.setAttribute('stroke', getCssVar('--grid-line-subtle'));
    tick.setAttribute('stroke-width', isHour ? '2' : '1.4');
    tick.setAttribute('pointer-events', 'none');
    svg.appendChild(tick);

    const labelInset = 8;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(x - labelInset));
    label.setAttribute('y', '2');
    label.setAttribute('dominant-baseline', 'hanging');
    label.setAttribute('font-size', '16');
    label.setAttribute('font-weight', '300');
    label.setAttribute('fill', getCssVar('--text-muted'));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('pointer-events', 'none');
    label.style.userSelect = 'none';
    label.textContent = String(Math.round(t / 60));
    svg.appendChild(label);
  }

  const ftpY = height - (ftp / maxY) * height;

  const selectedSet = new Set<number>(
    Array.isArray(selectedBlockIndices)
      ? selectedBlockIndices
      : selectedBlockIndex != null
        ? [selectedBlockIndex]
        : [],
  );

  // Block-wide highlight bands.
  timings.forEach(({ index, tStart, tEnd }) => {
    const x1 = (tStart / timelineSec) * width;
    const x2 = (tEnd / timelineSec) * width;
    const w = Math.max(1, x2 - x1);
    const band = document.createElementNS(SVG_NS, 'rect');
    band.setAttribute('x', String(x1));
    band.setAttribute('y', '0');
    band.setAttribute('width', String(w));
    band.setAttribute('height', String(height));
    band.setAttribute('fill', 'transparent');
    band.setAttribute('pointer-events', 'none');
    band.classList.add('wb-block-band');
    band.dataset.blockIndex = String(index);
    if (selectedSet.has(index)) band.classList.add('is-active');
    svg.appendChild(band);
  });

  const HANDLE_TOP_HEIGHT = 18;
  const HANDLE_RIGHT_WIDTH = 18;
  const rightHandles: SVGRectElement[] = [];
  const topHandles: SVGPolygonElement[] = [];

  let cursor = 0;
  safeBlocks.forEach((block, idx) => {
    const segs: BlockSegment[] = Array.isArray(block?.segments) ? block.segments : [];
    for (let segIndex = 0; segIndex < segs.length; segIndex += 1) {
      const seg = segs[segIndex]!;
      const durSec = Math.max(1, Math.round(seg?.durationSec || 0));
      const pStartRel = seg?.pStartRel || 0;
      const pEndRel = seg?.pEndRel != null ? seg.pEndRel : pStartRel;
      const cadenceRpm = Number.isFinite(seg?.cadence as number)
        ? Number(seg.cadence)
        : null;

      const x1 = (cursor / timelineSec) * width;
      const x2 = ((cursor + durSec) / timelineSec) * width;
      const segWidth = Math.max(1, x2 - x1);
      const p0 = pStartRel * ftp;
      const p1 = pEndRel * ftp;
      const y0 = height - (Math.max(0, p0) / maxY) * height;
      const y1 = height - (Math.max(0, p1) / maxY) * height;

      const isFreeride = block?.kind === 'freeride' || seg?.isFreeRide || false;
      const poly = renderBuilderSegmentPolygon({
        svg,
        totalSec: timelineSec,
        width,
        height,
        ftp,
        maxY,
        tStart: cursor,
        tEnd: cursor + durSec,
        pStartRel,
        pEndRel,
        isFreeride,
        cadenceRpm,
      });

      if (poly) {
        poly.dataset.blockIndex = String(idx);
        poly.dataset.segIndex = String(segIndex);
        poly.dataset.x1 = String(x1);
        poly.dataset.x2 = String(x2);
        poly.dataset.y0 = String(y0);
        poly.dataset.y1 = String(y1);
        poly.dataset.dragHandle = 'move';
        poly.classList.add('wb-block-segment');
        poly.classList.add('wb-drag-handle', 'wb-drag-handle--move');
        if (selectedSet.has(idx)) poly.classList.add('is-active');
      }

      let topHandle: SVGPolygonElement | null = null;
      if (!isFreeride) {
        topHandle = document.createElementNS(SVG_NS, 'polygon');
        const clampY = (val: number) => Math.max(0, Math.min(height, val));
        const y0t = clampY(y0 - HANDLE_TOP_HEIGHT);
        const y1t = clampY(y1 - HANDLE_TOP_HEIGHT);
        const y0b = clampY(y0 + HANDLE_TOP_HEIGHT);
        const y1b = clampY(y1 + HANDLE_TOP_HEIGHT);
        topHandle.setAttribute('points', `${x1},${y0t} ${x2},${y1t} ${x2},${y1b} ${x1},${y0b}`);
        topHandle.setAttribute('fill', 'transparent');
        topHandle.setAttribute('pointer-events', 'all');
        topHandle.dataset.blockIndex = String(idx);
        topHandle.dataset.segIndex = String(segIndex);
        topHandle.dataset.dragHandle = 'top';
        topHandle.dataset.x1 = String(x1);
        topHandle.dataset.x2 = String(x2);
      }

      const handleBaseWidth = Math.min(HANDLE_RIGHT_WIDTH, Math.max(6, segWidth));
      const nextSeg =
        segIndex + 1 < segs.length
          ? segs[segIndex + 1]
          : safeBlocks?.[idx + 1]?.segments?.[0];
      const nextDurationSec = Math.max(0, Math.round(nextSeg?.durationSec || 0));
      const leftExtend = handleBaseWidth * 0.75;
      const rightExtend = nextDurationSec > 90 ? handleBaseWidth * 0.5 : handleBaseWidth * 0.25;
      const handleWidth = leftExtend + rightExtend;
      const rightHandle = document.createElementNS(SVG_NS, 'rect');
      rightHandle.setAttribute('x', String(x2 - leftExtend));
      rightHandle.setAttribute('y', '0');
      rightHandle.setAttribute('width', String(handleWidth));
      rightHandle.setAttribute('height', String(height));
      rightHandle.setAttribute('fill', 'transparent');
      rightHandle.setAttribute('pointer-events', 'all');
      rightHandle.dataset.blockIndex = String(idx);
      rightHandle.dataset.segIndex = String(segIndex);
      rightHandle.dataset.dragHandle = 'right';
      rightHandle.classList.add('wb-drag-handle', 'wb-drag-handle--right');
      rightHandles.push(rightHandle);

      if (topHandle) {
        topHandle.classList.add('wb-drag-handle', 'wb-drag-handle--top');
        topHandles.push(topHandle);
      }

      cursor += durSec;
    }
  });

  rightHandles.forEach((handle) => svg.appendChild(handle));
  topHandles.forEach((handle) => svg.appendChild(handle));

  const ftpLine = document.createElementNS(SVG_NS, 'line');
  ftpLine.setAttribute('x1', '0');
  ftpLine.setAttribute('x2', String(width));
  ftpLine.setAttribute('y1', String(ftpY));
  ftpLine.setAttribute('y2', String(ftpY));
  ftpLine.setAttribute('stroke', getCssVar('--ftp-line'));
  ftpLine.setAttribute('stroke-width', '1.4');
  ftpLine.setAttribute('pointer-events', 'none');
  svg.appendChild(ftpLine);

  renderBuilderTextEventMarkers({
    svg,
    textEvents,
    totalSec: timelineSec,
    width,
    height,
    activeIndex: activeTextEventIndex,
  });

  const tooltip = document.createElement('div');
  tooltip.className = 'picker-tooltip';
  container.appendChild(svg);
  container.appendChild(tooltip);

  if (scrollEl && chartCard) {
    const labelStep = gridStep;
    const leftOffset = (scrollEl as HTMLElement).offsetLeft;
    const topOffset = (scrollEl as HTMLElement).offsetTop;
    const viewWidth = (scrollEl as HTMLElement).clientWidth;

    const yLabels = document.createElement('div');
    yLabels.className = 'wb-chart-axis-overlay wb-chart-axis-overlay--grid';
    yLabels.style.height = `${height}px`;
    yLabels.style.top = `${topOffset}px`;
    yLabels.style.left = `${leftOffset}px`;
    yLabels.style.width = `${viewWidth}px`;

    for (let yVal = 0; yVal <= maxY; yVal += labelStep) {
      const y = height - (yVal / maxY) * height;
      const labelTop = y - 24;
      if (labelTop < 0 || labelTop > height - 20) continue;
      const label = document.createElement('div');
      label.className = 'wb-chart-axis-label';
      label.textContent = String(yVal);
      label.style.top = `${labelTop}px`;
      yLabels.appendChild(label);
    }

    const ftpLabel = document.createElement('div');
    ftpLabel.className = 'wb-chart-axis-label wb-chart-axis-label--ftp';
    ftpLabel.textContent = `FTP ${Math.round(ftp)}`;
    const ftpOffset = 24;
    const ftpLabelTop = Math.max(0, Math.min(height - 20, ftpY - ftpOffset));
    ftpLabel.style.top = `${ftpLabelTop}px`;

    const ftpLabels = document.createElement('div');
    ftpLabels.className = 'wb-chart-axis-overlay wb-chart-axis-overlay--ftp';
    ftpLabels.style.height = `${height}px`;
    ftpLabels.style.top = `${topOffset}px`;
    ftpLabels.style.left = `${leftOffset}px`;
    ftpLabels.style.width = `${viewWidth}px`;
    ftpLabels.appendChild(ftpLabel);

    const durationSec = totalSec || 0;
    if (durationSec > 0) {
      const durationLabel = document.createElement('div');
      durationLabel.className = 'wb-chart-axis-label wb-chart-axis-label--duration';
      durationLabel.textContent = formatDurationMinSec(durationSec);
      const labelHeight = 16;
      const durationTop = ftpY + 2;
      if (durationTop >= 0 && durationTop + labelHeight <= height) {
        durationLabel.style.top = `${durationTop}px`;
        ftpLabels.appendChild(durationLabel);
      }
    }

    chartCard.appendChild(yLabels);
    chartCard.appendChild(ftpLabels);
  }

  if (Number.isInteger(insertAfterBlockIndex) && (insertAfterBlockIndex as number) >= -1) {
    let tInsert = 0;
    if (timings.length) {
      tInsert =
        (insertAfterBlockIndex as number) < 0
          ? 0
          : timings[Math.min(insertAfterBlockIndex as number, timings.length - 1)]!.tEnd;
    }
    const x = (tInsert / timelineSec) * width;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', '0');
    line.setAttribute('y2', String(height));
    line.setAttribute('stroke', getCssVar('--wb-insert-line'));
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4 4');
    line.setAttribute('pointer-events', 'none');
    line.classList.add('wb-insert-line');
    svg.appendChild(line);
  }

  // Click wiring (select block / set insert-after). Hover/drag live in the host.
  if (onSelectBlock || onSetInsertAfter) {
    svg.addEventListener('mousedown', (e) => {
      if (e.shiftKey) e.preventDefault();
    });
    svg.addEventListener('click', (e) => {
      const targetBlock =
        e.target && (e.target as Element).closest
          ? (e.target as Element).closest('[data-block-index]')
          : null;

      if (targetBlock && (targetBlock as HTMLElement).dataset.blockIndex != null) {
        if (typeof onSelectBlock !== 'function') return;
        const idxNum = Number((targetBlock as HTMLElement).dataset.blockIndex);
        onSelectBlock(Number.isFinite(idxNum) ? idxNum : null, { shiftKey: e.shiftKey });
        if (!e.shiftKey && typeof onSetInsertAfterFromSegment === 'function') {
          const blockIndex = Number((targetBlock as HTMLElement).dataset.blockIndex);
          const segIndex = Number((targetBlock as HTMLElement).dataset.segIndex);
          const blockTiming = timings.find((t) => t.index === blockIndex);
          const block = Number.isFinite(blockIndex) ? safeBlocks[blockIndex] : null;
          let insertIdx = Number.isFinite(blockIndex) ? blockIndex : -1;
          const svgRect = svg.getBoundingClientRect();
          const localX = e.clientX - svgRect.left;
          const clampedX = Math.max(0, Math.min(width, localX));

          if (block && block.kind === 'intervals' && blockTiming) {
            if (Number.isFinite(segIndex)) {
              insertIdx = segIndex % 2 === 0 ? blockIndex - 1 : blockIndex;
            } else {
              const mid = (blockTiming.tStart + blockTiming.tEnd) / 2;
              const timeSec = (clampedX / width) * timelineSec;
              insertIdx = timeSec < mid ? blockIndex - 1 : blockIndex;
            }
          } else if (Number.isFinite(segIndex) && segmentTimings.length) {
            const seg = segmentTimings.find(
              (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
            );
            if (seg) {
              const mid = (seg.tStart + seg.tEnd) / 2;
              const timeSec = (clampedX / width) * timelineSec;
              insertIdx = timeSec < mid ? blockIndex - 1 : blockIndex;
            }
          }
          if (insertIdx < -1) insertIdx = -1;
          if (insertIdx >= timings.length) insertIdx = timings.length - 1;
          onSetInsertAfterFromSegment(insertIdx);
        }
        return;
      }

      if (typeof onSetInsertAfter !== 'function' || !timings.length) {
        if (typeof onSelectBlock === 'function') onSelectBlock(null);
        return;
      }

      const svgRect = svg.getBoundingClientRect();
      const localX = e.clientX - svgRect.left;
      const clampedX = Math.max(0, Math.min(width, localX));
      const timeSec = (clampedX / width) * timelineSec;
      let idx = -1;
      const blockTiming =
        timings.find(({ tEnd }) => timeSec <= tEnd) || timings[timings.length - 1]!;
      const block = blockTiming ? safeBlocks[blockTiming.index] : null;
      let seg: typeof segmentTimings[number] | null = null;
      if (segmentTimings.length) {
        seg = segmentTimings.find((t) => timeSec <= t.tEnd) || segmentTimings[segmentTimings.length - 1]!;
      }
      if (block && block.kind === 'intervals') {
        if (seg && Number.isFinite(seg.segIndex)) {
          idx = seg.segIndex % 2 === 0 ? blockTiming.index - 1 : blockTiming.index;
        } else {
          const mid = (blockTiming.tStart + blockTiming.tEnd) / 2;
          idx = timeSec < mid ? blockTiming.index - 1 : blockTiming.index;
        }
      } else if (seg) {
        const mid = (seg.tStart + seg.tEnd) / 2;
        idx = timeSec < mid ? seg.blockIndex - 1 : seg.blockIndex;
      } else if (blockTiming) {
        idx = blockTiming.index;
      }
      if (idx < -1) idx = -1;
      if (idx >= timings.length) idx = timings.length - 1;
      onSetInsertAfter(idx);
    });
  }
}

// --------------------------- Planner: mini history chart ---------------------------

function formatDurationLabel(sec: number): string {
  if (!sec) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (sec < 3600) return `${m}m`;
  const h = Math.floor(sec / 3600);
  const remM = Math.floor((sec % 3600) / 60);
  if (remM > 0) return `${h}h${remM}m`;
  return `${h}h`;
}

export interface DrawMiniHistoryChartArgs {
  svg: SVGSVGElement;
  width?: number;
  height?: number;
  ftp?: number;
  rawSegments?: RawSegment[];
  actualLineSegments?: number[][]; // [pStart, pEnd, dur]
  actualPowerMax?: number;
  durationSec?: number | null;
}

/**
 * Render the small per-day history/scheduled chart (planned target bands +
 * actual-power step line) into an existing <svg>. Ported from
 * docs/workout-chart.js drawMiniHistoryChart — the non-interactive subset used
 * by the planner day cards (the actualLineSegments path; actualPath / minute /
 * segment fallbacks are dropped because the planner only ever passes
 * actualLineSegments). Geometry/colors preserved verbatim.
 */
export function drawMiniHistoryChart(args: DrawMiniHistoryChartArgs): void {
  const {
    svg: rawSvg,
    width = 320,
    height = 120,
    ftp = DEFAULT_FTP,
    rawSegments = [],
    actualLineSegments = [],
    actualPowerMax = 0,
    durationSec: durationSecProp = null,
  } = args;
  const svg = rawSvg as SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds };
  if (!svg) return;
  clearSvg(svg);

  const w = Math.max(120, width);
  const h = Math.max(36, height);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;

  const totalSegSec = rawSegments.reduce(
    (sum, seg) => sum + segDurationSec(getRawMinutes(seg)),
    0,
  );
  const totalActualSecFromLines = actualLineSegments.reduce(
    (sum, seg) => sum + Math.max(0, (seg[2] as number) || 0),
    0,
  );
  const totalActualSec =
    actualLineSegments.length > 0 ? totalActualSecFromLines : 0;
  const totalSec =
    durationSecProp && durationSecProp > 0
      ? durationSecProp
      : Math.max(1, totalSegSec, totalActualSec);

  const maxTarget =
    rawSegments.reduce((max, seg) => {
      const p0 = ((seg[1] as number) || 0) * ftp * 0.01;
      const p1 = ((seg[2] != null ? (seg[2] as number) : (seg[1] as number)) || 0) * ftp * 0.01;
      return Math.max(max, p0, p1);
    }, 0) || ftp * 1.2;
  const maxActual = Math.max(
    actualPowerMax || 0,
    actualLineSegments.reduce(
      (m, seg) => Math.max(m, (seg[0] as number) || 0, (seg[1] as number) || 0),
      0,
    ),
  );
  const maxY = getScaledMaxY({ ftp, peak: Math.max(maxTarget, maxActual), minBase: 200 });

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Target bands.
  if (rawSegments.length) {
    let acc = 0;
    for (const seg of rawSegments) {
      const minutes = (seg[0] as number) || 0;
      const startPct = (seg[1] as number) || 0;
      const endPct = seg[2] != null ? (seg[2] as number) : startPct;
      const dur = segDurationSec(minutes);
      const tStart = acc;
      const tEnd = acc + dur;
      acc = tEnd;
      const isFreeride = isFreeRideSegment(seg);
      renderSegmentPolygon({
        svg,
        totalSec,
        width: w,
        height: h,
        ftp,
        maxY,
        tStart,
        tEnd,
        pStartRel: isFreeride ? FREERIDE_POWER_REL : startPct / 100,
        pEndRel: isFreeride ? FREERIDE_POWER_REL : endPct / 100,
        isFreeride,
        cadenceRpm: null,
      });
    }
  }

  // Actual power step line.
  const step: string[] = [];
  if (actualLineSegments.length) {
    const safeTotalSec = Math.max(totalSec, totalActualSec);
    let cursor = 0;
    actualLineSegments.forEach((seg, idx) => {
      const pStart = (seg[0] as number) || 0;
      const pEnd = (seg[1] as number) || 0;
      const durSec = Math.max(0, (seg[2] as number) || 0);
      const x0 = Math.max(0, Math.min(1, cursor / safeTotalSec)) * w;
      const x1 = Math.max(0, Math.min(1, (cursor + durSec) / safeTotalSec)) * w;
      const y0 = h - (Math.min(maxY, Math.max(0, pStart)) / maxY) * h;
      const y1 = h - (Math.min(maxY, Math.max(0, pEnd)) / maxY) * h;
      if (idx === 0) step.push(`M${x0.toFixed(2)},${y0.toFixed(2)}`);
      step.push(`L${x1.toFixed(2)},${y1.toFixed(2)}`);
      cursor += durSec;
    });
  }

  if (step.length) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', step.join(''));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', getCssVar('--power-line') || '#a607a6');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
}

// --------------------------- Planner: power curve (history detail) ------------

export interface PowerCurvePoint {
  durSec: number;
  power: number;
}

export interface DrawPowerCurveChartArgs {
  svg: SVGSVGElement;
  width?: number;
  height?: number;
  ftp?: number;
  points?: PowerCurvePoint[];
  maxDurationSec?: number;
}

/**
 * Render the ride-detail power-duration curve into an existing <svg>. Ported
 * from docs/workout-chart.js drawPowerCurveChart (the non-interactive subset:
 * grid/ticks, FTP line, 1h marker, the curve path — the hover dot/label/mouse
 * listeners are dropped). Log-x duration axis, linear-W y axis.
 */
export function drawPowerCurveChart(args: DrawPowerCurveChartArgs): void {
  const { svg, width = 600, height = 300, ftp = DEFAULT_FTP, points = [], maxDurationSec = 0 } =
    args;
  if (!svg) return;
  clearSvg(svg as SVGSVGElement & { _freeridePatternIds?: FreeridePatternIds });

  const w = Math.max(200, width);
  const h = Math.max(180, height);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const sorted = [...points].sort((a, b) => (a.durSec || 0) - (b.durSec || 0));
  const maxDurRaw =
    maxDurationSec || (sorted.length ? sorted[sorted.length - 1]!.durSec || 1 : 1);
  const maxDur = Math.max(1, maxDurRaw * 1.1);
  const peakPower = sorted.reduce((m, p) => Math.max(m, Math.abs(p.power || 0)), 0);
  const maxPower = getScaledMaxY({ ftp, peak: peakPower, minBase: 200 });

  const log = (v: number) => Math.log(Math.max(1, v));
  const logMin = log(1);
  const logMax = log(maxDur);
  const xFor = (dur: number) =>
    ((log(Math.max(1, dur)) - logMin) / Math.max(1e-6, logMax - logMin)) * w;
  const yFor = (p: number) => h - (Math.max(0, p) / maxPower) * h;

  const tickDurations = [
    1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 5400, 7200, 14400, 28800,
  ].filter((d) => d <= maxDur);

  tickDurations.forEach((dur, idx) => {
    const x = xFor(dur);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', '0');
    line.setAttribute('y2', String(h));
    line.setAttribute('stroke', getCssVar('--border-subtle'));
    line.setAttribute('stroke-width', '0.7');
    line.setAttribute('pointer-events', 'none');
    svg.appendChild(line);

    if (idx === tickDurations.length - 1) return;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(x + 4));
    label.setAttribute('y', String(h - 6));
    label.setAttribute('fill', getCssVar('--text-muted'));
    label.setAttribute('font-size', '14');
    label.setAttribute('pointer-events', 'none');
    label.textContent = formatDurationLabel(dur);
    svg.appendChild(label);
  });

  for (let p = 100; p <= maxPower; p += 100) {
    const y = yFor(p);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', String(w));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', getCssVar('--border-subtle'));
    line.setAttribute('stroke-width', '0.6');
    line.setAttribute('pointer-events', 'none');
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', '4');
    label.setAttribute('y', String(y - 4));
    label.setAttribute('fill', getCssVar('--text-muted'));
    label.setAttribute('font-size', '12');
    label.setAttribute('pointer-events', 'none');
    label.textContent = `${p} W`;
    svg.appendChild(label);
  }

  const ftpY = yFor(ftp);
  const ftpLine = document.createElementNS(SVG_NS, 'line');
  ftpLine.setAttribute('x1', '0');
  ftpLine.setAttribute('x2', String(w));
  ftpLine.setAttribute('y1', String(ftpY));
  ftpLine.setAttribute('y2', String(ftpY));
  ftpLine.setAttribute('stroke', getCssVar('--ftp-line'));
  ftpLine.setAttribute('stroke-width', '2.1');
  ftpLine.setAttribute('pointer-events', 'none');
  svg.appendChild(ftpLine);

  const ftpLabel = document.createElementNS(SVG_NS, 'text');
  ftpLabel.setAttribute('x', '6');
  ftpLabel.setAttribute('y', String(ftpY - 6));
  ftpLabel.setAttribute('fill', getCssVar('--ftp-line'));
  ftpLabel.setAttribute('font-size', '14');
  ftpLabel.setAttribute('pointer-events', 'none');
  ftpLabel.textContent = `FTP ${Math.round(ftp)}`;
  svg.appendChild(ftpLabel);

  const hourDur = 3600;
  if (hourDur <= maxDur) {
    const x = xFor(hourDur);
    const vline = document.createElementNS(SVG_NS, 'line');
    vline.setAttribute('x1', String(x));
    vline.setAttribute('x2', String(x));
    vline.setAttribute('y1', '0');
    vline.setAttribute('y2', String(h));
    vline.setAttribute('stroke', getCssVar('--border-strong'));
    vline.setAttribute('stroke-dasharray', '4 4');
    vline.setAttribute('stroke-width', '1.4');
    vline.setAttribute('pointer-events', 'none');
    svg.appendChild(vline);

    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(x + 6));
    lbl.setAttribute('y', '16');
    lbl.setAttribute('fill', getCssVar('--border-strong'));
    lbl.setAttribute('font-size', '14');
    lbl.setAttribute('pointer-events', 'none');
    lbl.textContent = '1h';
    svg.appendChild(lbl);
  }

  if (!sorted.length) return;

  const pathParts: string[] = [];
  sorted.forEach((pt, idx) => {
    const x = xFor(pt.durSec || 1);
    const y = yFor(pt.power || 0);
    pathParts.push(`${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  });

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathParts.join(''));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', getCssVar('--power-line'));
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
}
