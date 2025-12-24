// workout-chart.js
// Shared chart helpers: zones, colors, SVG rendering, hover, and raw-segment handling.

import {DEFAULT_FTP, formatDurationMinSec} from "./workout-metrics.js";

// --------------------------- CSS / color helpers ---------------------------

export function getCssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function parseHexColor(hex) {
  if (!hex) return null;
  let s = hex.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return {r, g, b};
}

export function mixColors(hexA, hexB, factor) {
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  if (!a || !b) return hexA;
  const f = Math.min(1, Math.max(0, factor));
  const r = Math.round(a.r * (1 - f) + b.r * f);
  const g = Math.round(a.g * (1 - f) + b.g * f);
  const bC = Math.round(a.b * (1 - f) + b.b * f);
  const toHex = (x) => x.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bC)}`;
}

// --------------------------- Zone / color mapping ---------------------------

/**
 * Maps a relative intensity (fraction of FTP) to zone name and colors.
 * Returns: { key, color, bg }
 */
export function zoneInfoFromRel(rel) {
  const pct = Math.max(0, rel) * 100;
  let key = "Recovery";
  if (pct < 60) key = "Recovery";
  else if (pct < 76) key = "Endurance";
  else if (pct < 90) key = "Tempo";
  else if (pct < 105) key = "Threshold";
  else if (pct < 119) key = "VO2Max";
  else key = "Anaerobic";

  const colorVarMap = {
    Recovery: "--zone-recovery",
    Endurance: "--zone-endurance",
    Tempo: "--zone-tempo",
    Threshold: "--zone-threshold",
    VO2Max: "--zone-vo2",
    Anaerobic: "--zone-anaerobic",
  };

  const color = getCssVar(colorVarMap[key] || "--zone-recovery");
  const bg = getCssVar("--bg") || "#f4f4f4";

  return {key, color, bg};
}

// --------------------------- SVG helpers ---------------------------

function clearSvg(svg) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/**
 * Draw a single polygon segment, with tooltip data.
 * Arguments are all primitive values; no intermediate segment objects.
 */
function renderSegmentPolygon({
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
}) {
  if (!svg || totalSec <= 0) return;

  const w = width;
  const h = height;

  const x1 = (tStart / totalSec) * w;
  const x2 = (tEnd / totalSec) * w;

  const avgRel = (pStartRel + pEndRel) / 2;
  const zone = zoneInfoFromRel(avgRel);

  const p0 = pStartRel * ftp;
  const p1 = pEndRel * ftp;

  const y0 = h - (Math.max(0, p0) / maxY) * h;
  const y1 = h - (Math.max(0, p1) / maxY) * h;

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", `${x1},${h} ${x1},${y0} ${x2},${y1} ${x2},${h}`);

  const muted = mixColors(zone.color, zone.bg, 0.3);
  const hover = mixColors(zone.color, zone.bg, 0.15);

  poly.setAttribute("fill", muted);
  poly.setAttribute("fill-opacity", "1");
  poly.setAttribute("stroke", "none");
  poly.setAttribute("shape-rendering", "crispEdges");
  poly.classList.add("chart-segment");

  const durSec = Math.max(1, Math.round(tEnd - tStart));
  const durMin = durSec / 60;
  const p0Pct = pStartRel * 100;
  const p1Pct = pEndRel * 100;

  poly.dataset.zone = zone.key;
  poly.dataset.p0 = p0Pct.toFixed(0);
  poly.dataset.p1 = p1Pct.toFixed(0);
  poly.dataset.durMin = durMin.toFixed(1);
  poly.dataset.durSec = String(durSec);
  poly.dataset.color = zone.color;
  poly.dataset.mutedColor = muted;
  poly.dataset.hoverColor = hover;

  svg.appendChild(poly);

  return poly;
}

export function drawMiniHistoryChart({
  svg,
  width = 320,
  height = 120,
  ftp = DEFAULT_FTP,
  rawSegments = [],
  actualPower = [],
  actualPowerSegments = [],
  actualLineSegments = [],
  durationSec: durationSecProp = null,
  actualPath = null,
  actualPowerMax = 0,
}) {
  if (!svg) return;
  clearSvg(svg);

  const w = Math.max(120, width);
  const h = Math.max(80, height);
  svg.setAttribute("preserveAspectRatio", "none");

  const totalSegSec = rawSegments.reduce(
    (sum, [minutes]) => sum + Math.max(1, Math.round((minutes || 0) * 60)),
    0
  );
  const totalActualSecFromSegments = actualPowerSegments.reduce(
    (sum, [, dur]) => sum + Math.max(1, Math.round(dur || 0)),
    0
  );
  const totalActualSecFromLines = actualLineSegments.reduce(
    (sum, [, , dur]) => sum + Math.max(0, dur || 0),
    0
  );
  const totalActualSec =
    actualLineSegments.length > 0
      ? totalActualSecFromLines
      : actualPowerSegments.length > 0
      ? totalActualSecFromSegments
      : actualPower.length * 60;
  const totalSec =
    durationSecProp && durationSecProp > 0
      ? durationSecProp
      : Math.max(1, totalSegSec, totalActualSec);

  const maxTarget =
    rawSegments.reduce((max, [minutes, p0, p1]) => {
      void minutes;
      const a = (p0 || 0) * ftp * 0.01;
      const b = (p1 != null ? p1 : p0 || 0) * ftp * 0.01;
      return Math.max(max, a, b);
    }, 0) || ftp * 1.2;
  const maxActual = Math.max(
    actualPowerMax || 0,
    actualPower.reduce((m, p) => Math.max(m, p || 0), 0),
    actualLineSegments.reduce(
      (m, [p0, p1]) => Math.max(m, p0 || 0, p1 || 0),
      0
    )
  );
  const maxY = Math.max(100, maxTarget, maxActual, ftp * 1.1);

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // Target bands
  if (rawSegments.length) {
    let acc = 0;
    rawSegments.forEach(([minutes, startPct, endPct]) => {
      const dur = Math.max(1, Math.round((minutes || 0) * 60));
      const tStart = acc;
      const tEnd = acc + dur;
      acc = tEnd;
      renderSegmentPolygon({
        svg,
        totalSec,
        width: w,
        height: h,
        ftp,
        maxY,
        tStart,
        tEnd,
        pStartRel: (startPct || 0) / 100,
        pEndRel: (endPct != null ? endPct : startPct || 0) / 100,
      });
    });
  }

  // Actual power line (step plot from cached segments or minute samples)
  const step = [];
  if (actualPath) {
    // When using cached path, it is encoded on a 0..1000 x-axis and power (W) y-axis.
    svg.setAttribute("viewBox", `0 0 1000 ${Math.max(maxY, maxActual || 100)}`);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", actualPath);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", getCssVar("--power-line") || "#a607a6");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return;
  }
  if (actualLineSegments.length) {
    const safeTotalSec = Math.max(totalSec, totalActualSec);
    let cursor = 0;
    actualLineSegments.forEach(([pStart, pEnd, dur], idx) => {
      const durSec = Math.max(0, dur || 0);
      const x0 = Math.max(0, Math.min(1, cursor / safeTotalSec)) * w;
      const x1 = Math.max(0, Math.min(1, (cursor + durSec) / safeTotalSec)) * w;
      const y0 = h - (Math.min(maxY, Math.max(0, pStart || 0)) / maxY) * h;
      const y1 = h - (Math.min(maxY, Math.max(0, pEnd || 0)) / maxY) * h;
      if (idx === 0) {
        step.push(`M${x0.toFixed(2)},${y0.toFixed(2)}`);
      }
      step.push(`L${x1.toFixed(2)},${y1.toFixed(2)}`);
      cursor += durSec;
    });
  } else if (actualPowerSegments.length) {
    const safeTotalSec = Math.max(totalSec, totalActualSecFromSegments);
    let elapsed = 0;
    actualPowerSegments.forEach(([pStartRaw, durRaw, pEndRaw], idx) => {
      const dur = Math.max(1, Math.round(durRaw || 0));
      const pStart = Math.min(maxY, Math.max(0, pStartRaw || 0));
      const pEnd =
        pEndRaw != null
          ? Math.min(maxY, Math.max(0, pEndRaw || 0))
          : pStart;
      const yStart = h - (pStart / maxY) * h;
      const yEnd = h - (pEnd / maxY) * h;
      const xStart = (elapsed / safeTotalSec) * w;
      const xEnd = ((elapsed + dur) / safeTotalSec) * w;
      if (idx === 0) {
        step.push(`M${xStart.toFixed(2)},${yStart.toFixed(2)}`);
      }
      // draw ramp or flat
      step.push(`L${xEnd.toFixed(2)},${yEnd.toFixed(2)}`);
      const next = actualPowerSegments[idx + 1];
      if (next) {
        const nextP = Math.min(maxY, Math.max(0, next[0] || 0));
        const yNext = h - (nextP / maxY) * h;
        const pctDiff =
          pEnd === 0 ? (nextP === 0 ? 0 : 1) : Math.abs(pEnd - nextP) / Math.max(1, pEnd);
        if (pctDiff > 0.01) {
          // vertical jump
          step.push(`L${xEnd.toFixed(2)},${yNext.toFixed(2)}`);
        }
      }
      elapsed += dur;
    });
  } else if (actualPower.length) {
    const safeTotalSec = Math.max(totalSec, actualPower.length * 60);
    const clamped = actualPower.map((p) => Math.min(maxY, Math.max(0, p || 0)));
    if (clamped.length) {
      let lastVal = clamped[0];
      let startMinute = 0;
      const emitSegment = (minuteIndex, value) => {
        const tEnd = minuteIndex * 60;
        const y = h - (value / maxY) * h;
        if (step.length === 0) {
          step.push(`M0,${y.toFixed(2)}`);
        }
        step.push(`L${((tEnd / safeTotalSec) * w).toFixed(2)},${y.toFixed(2)}`);
      };

      for (let i = 1; i < clamped.length; i += 1) {
        if (clamped[i] !== lastVal) {
          emitSegment(i, lastVal);
          const yNext = h - (clamped[i] / maxY) * h;
          const tNext = i * 60;
          step.push(`L${((tNext / safeTotalSec) * w).toFixed(2)},${yNext.toFixed(2)}`);
          startMinute = i;
          lastVal = clamped[i];
        }
      }
      emitSegment(clamped.length, lastVal);
    }
  }

  if (step.length) {
    const d = step.join("");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", getCssVar("--power-line") || "#a607a6");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
}

function formatDurationLabel(sec) {
  if (!sec) return "0s";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (sec < 3600) {
    return `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const remM = Math.floor((sec % 3600) / 60);
  if (remM > 0) return `${h}h${remM}m`;
  return `${h}h`;
}

// --------------------------- Power curve (history detail) ---------------------------

export function drawPowerCurveChart({
  svg,
  width = 600,
  height = 300,
  ftp = DEFAULT_FTP,
  points = [], // [{durSec, power}]
  maxDurationSec = 0,
}) {
  if (!svg) return;
  if (typeof svg._powerCurveCleanup === "function") {
    svg._powerCurveCleanup();
  }
  clearSvg(svg);

  const w = Math.max(200, width);
  const h = Math.max(180, height);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");

  const sorted = [...points].sort((a, b) => (a.durSec || 0) - (b.durSec || 0));
  const maxDurRaw =
    maxDurationSec || (sorted.length ? sorted[sorted.length - 1].durSec || 1 : 1);
  const maxDur = Math.max(1, maxDurRaw * 1.1);
  const maxPower = sorted.reduce(
    (m, p) => Math.max(m, Math.abs(p.power || 0)),
    Math.max(ftp * 2, 100),
  );

  const log = (v) => Math.log(Math.max(1, v));
  const logMin = log(1);
  const logMax = log(maxDur);
  const xFor = (dur) =>
    ((log(Math.max(1, dur)) - logMin) / Math.max(1e-6, logMax - logMin)) * w;
  const yFor = (p) => h - (Math.max(0, p) / maxPower) * h;

  // grid / ticks
  const tickDurations = [
    1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 5400, 7200, 14400, 28800,
  ].filter((d) => d <= maxDur);

  tickDurations.forEach((dur, idx) => {
    const x = xFor(dur);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("y2", String(h));
    line.setAttribute("stroke", getCssVar("--border-subtle"));
    line.setAttribute("stroke-width", "0.7");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);

    if (idx === tickDurations.length - 1) return;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x + 4));
    label.setAttribute("y", String(h - 6));
    label.setAttribute("fill", getCssVar("--text-muted"));
    label.setAttribute("font-size", "14");
    label.setAttribute("pointer-events", "none");
    label.textContent = formatDurationLabel(dur);
    svg.appendChild(label);
  });

  // FTP line and Y ticks
  const yTicks = [];
  for (let p = 0; p <= maxPower; p += 100) yTicks.push(p);
  yTicks.forEach((p) => {
    if (p === 0) return;
    const y = yFor(p);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(w));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", getCssVar("--border-subtle"));
    line.setAttribute("stroke-width", "0.6");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "4");
    label.setAttribute("y", String(y - 4));
    label.setAttribute("fill", getCssVar("--text-muted"));
    label.setAttribute("font-size", "12");
    label.setAttribute("pointer-events", "none");
    label.textContent = `${p} W`;
    svg.appendChild(label);
  });

  // FTP line
  const ftpY = yFor(ftp);
  const ftpLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  ftpLine.setAttribute("x1", "0");
  ftpLine.setAttribute("x2", String(w));
  ftpLine.setAttribute("y1", String(ftpY));
  ftpLine.setAttribute("y2", String(ftpY));
  ftpLine.setAttribute("stroke", getCssVar("--ftp-line"));
  ftpLine.setAttribute("stroke-width", "2.1");
  ftpLine.setAttribute("pointer-events", "none");
  svg.appendChild(ftpLine);

  const ftpLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  ftpLabel.setAttribute("x", "6");
  ftpLabel.setAttribute("y", String(ftpY - 6));
  ftpLabel.setAttribute("fill", getCssVar("--ftp-line"));
  ftpLabel.setAttribute("font-size", "14");
  ftpLabel.setAttribute("pointer-events", "none");
  ftpLabel.textContent = `FTP ${Math.round(ftp)}`;
  svg.appendChild(ftpLabel);

  // 1h vertical marker
  const hourDur = 3600;
  if (hourDur <= maxDur) {
    const x = xFor(hourDur);
    const vline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    vline.setAttribute("x1", String(x));
    vline.setAttribute("x2", String(x));
    vline.setAttribute("y1", "0");
    vline.setAttribute("y2", String(h));
    vline.setAttribute("stroke", getCssVar("--border-strong"));
    vline.setAttribute("stroke-dasharray", "4 4");
    vline.setAttribute("stroke-width", "1.4");
    vline.setAttribute("pointer-events", "none");
    svg.appendChild(vline);

    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lbl.setAttribute("x", String(x + 6));
    lbl.setAttribute("y", "16");
    lbl.setAttribute("fill", getCssVar("--border-strong"));
    lbl.setAttribute("font-size", "14");
    lbl.setAttribute("pointer-events", "none");
    lbl.textContent = "1h";
    svg.appendChild(lbl);
  }

  if (!sorted.length) return;

  const pathParts = [];
  sorted.forEach((pt, idx) => {
    const x = xFor(pt.durSec || 1);
    const y = yFor(pt.power || 0);
    pathParts.push(`${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  });

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathParts.join(""));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", getCssVar("--power-line"));
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  const hoverDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hoverDot.setAttribute("r", "4");
  hoverDot.setAttribute("fill", getCssVar("--power-line"));
  hoverDot.style.display = "none";
  svg.appendChild(hoverDot);

  const hoverLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  hoverLabel.setAttribute("fill", getCssVar("--power-line"));
  hoverLabel.setAttribute("font-size", "14");
  hoverLabel.setAttribute("pointer-events", "none");
  hoverLabel.style.display = "none";
  svg.appendChild(hoverLabel);

  const findInterpolatedPoint = (targetDur) => {
    if (!sorted.length) return null;
    if (targetDur >= (sorted[sorted.length - 1].durSec || 0)) {
      return sorted[sorted.length - 1];
    }
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((sorted[mid].durSec || 0) < targetDur) lo = mid + 1;
      else hi = mid;
    }
    const idx2 = lo;
    const idx1 = Math.max(0, idx2 - 1);
    const p1 = sorted[idx1];
    const p2 = sorted[idx2] || p1;
    if (!p1) return null;
    if (p1 === p2) return {durSec: targetDur, power: p1.power};
    const span = (p2.durSec || 1) - (p1.durSec || 1);
    const t =
      span > 0 ? (targetDur - (p1.durSec || 1)) / span : 0;
    const power = (p1.power || 0) + t * ((p2.power || 0) - (p1.power || 0));
    return {durSec: targetDur, power};
  };

  const onMove = (evt) => {
    const rect = svg.getBoundingClientRect();
    const relX = evt.clientX - rect.left;
    const clampedX = Math.max(0, Math.min(w, relX));
    const ratio = clampedX / w;
    const dur = Math.exp(ratio * (logMax - logMin) + logMin);
    const pt = findInterpolatedPoint(dur);
    if (!pt) return;
    const x = xFor(pt.durSec || 1);
    const y = yFor(pt.power || 0);
    hoverDot.setAttribute("cx", String(x));
    hoverDot.setAttribute("cy", String(y));
    hoverDot.style.display = "block";

    const label = `${Math.round(pt.power || 0)} W · ${formatDurationLabel(
      Math.round(pt.durSec || 0)
    )}`;
    hoverLabel.textContent = label;
    const textWidth = label.length * 6.5;
    let lx = x + 8;
    if (lx + textWidth > w) lx = x - textWidth - 8;
    let ly = y - 8;
    if (ly < 12) ly = y + 14;
    hoverLabel.setAttribute("x", String(lx));
    hoverLabel.setAttribute("y", String(ly));
    hoverLabel.style.display = "block";
  };

  const onLeave = () => {
    hoverDot.style.display = "none";
    hoverLabel.style.display = "none";
  };

  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);
  svg._powerCurveCleanup = () => {
    svg.removeEventListener("mousemove", onMove);
    svg.removeEventListener("mouseleave", onLeave);
  };
}

// Track last hovered segment across charts (main + mini)
let lastHoveredSegment = null;
const hoverCleanupMap = new WeakMap();
const lastHoverPosByContainer = new WeakMap();

/**
 * Attaches hover behavior for segments: shows tooltip and highlights polygon.
 */
function attachSegmentHover(svg, tooltipEl, containerEl, ftp) {
  if (!svg || !tooltipEl || !containerEl) return;

  const cleanup = hoverCleanupMap.get(svg);
  if (cleanup) cleanup();

  const applyHoverAtClientPos = (clientX, clientY, {remember = true} = {}) => {
    if (lastHoveredSegment && !document.contains(lastHoveredSegment)) {
      lastHoveredSegment = null;
    }

    let segment = null;
    const dragBlockIndex = Number(containerEl.dataset.dragBlockIndex);
    const dragSegIndex = Number(containerEl.dataset.dragSegIndex);
    if (
      Number.isFinite(dragBlockIndex) &&
      Number.isFinite(dragSegIndex)
    ) {
      segment = svg.querySelector(
        `[data-block-index="${dragBlockIndex}"][data-seg-index="${dragSegIndex}"]`,
      );
    }
    if (!segment) {
      const hitEl = document.elementFromPoint(clientX, clientY);
      segment = hitEl && hitEl.closest ? hitEl.closest(".chart-segment") : null;
      if (!segment && hitEl && hitEl.closest) {
        const handleEl = hitEl.closest("[data-block-index][data-seg-index]");
        if (handleEl && svg.contains(handleEl)) {
          const blockIndex = handleEl.dataset.blockIndex;
          const segIndex = handleEl.dataset.segIndex;
          segment = svg.querySelector(
            `.chart-segment[data-block-index="${blockIndex}"][data-seg-index="${segIndex}"]`,
          );
        }
      }
    }

    if (!segment || !svg.contains(segment)) {
      tooltipEl.style.display = "none";
      if (lastHoveredSegment) {
        const prevColor =
          lastHoveredSegment.dataset.mutedColor ||
          lastHoveredSegment.dataset.color;
        if (prevColor) lastHoveredSegment.setAttribute("fill", prevColor);
        lastHoveredSegment = null;
      }
      return;
    }

    if (remember) {
      lastHoverPosByContainer.set(containerEl, {clientX, clientY});
    }

    const zone = segment.dataset.zone;
    const p0 = segment.dataset.p0;
    const p1 = segment.dataset.p1;
    const durSec = Math.max(1, Math.round(Number(segment.dataset.durSec) || 0));
    const durMin = durSec / 60;
    const dur =
      durSec >= 60 ? `${durMin.toFixed(1)} min` : `${durSec} sec`;
    const w0 = Math.round((p0 * ftp) / 100);
    const w1 = Math.round((p1 * ftp) / 100);

    tooltipEl.textContent =
      p0 === p1
        ? `${zone}: ${p0}% FTP, ${w0}W, ${dur}`
        : `${zone}: ${p0}–${p1}% FTP, ${w0}-${w1}W, ${dur}`;
    tooltipEl.style.display = "block";

    const panelRect = containerEl.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const scrollEl = containerEl.parentElement;
    const isScrollable =
      scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth + 1;
    const scrollLeft = isScrollable ? scrollEl.scrollLeft : 0;
    const baseLeft = svgRect.left - panelRect.left;
    const viewWidth = isScrollable
      ? scrollEl.clientWidth
      : svgRect.width || panelRect.width;
    let tx = clientX - panelRect.left + 8;
    let ty = clientY - panelRect.top + 8;

    const ttRect = tooltipEl.getBoundingClientRect();
    const minX = baseLeft + scrollLeft;
    const maxX = minX + viewWidth - ttRect.width - 4;
    if (tx > maxX) tx = maxX;
    if (tx < minX) tx = minX;
    if (ty + ttRect.height > panelRect.height - 4) {
      ty = panelRect.height - ttRect.height - 4;
    }
    if (ty < 0) ty = 0;

    tooltipEl.style.left = `${tx}px`;
    tooltipEl.style.top = `${ty}px`;

    if (lastHoveredSegment && lastHoveredSegment !== segment) {
      const prevColor =
        lastHoveredSegment.dataset.mutedColor ||
        lastHoveredSegment.dataset.color;
      if (prevColor) lastHoveredSegment.setAttribute("fill", prevColor);
    }

    const hoverColor =
      segment.dataset.hoverColor ||
      segment.dataset.color ||
      segment.dataset.mutedColor;
    if (hoverColor) segment.setAttribute("fill", hoverColor);

    lastHoveredSegment = segment;
  };

  const onMouseMove = (e) => {
    lastHoverPosByContainer.set(containerEl, {
      clientX: e.clientX,
      clientY: e.clientY,
    });
    applyHoverAtClientPos(e.clientX, e.clientY, {remember: false});
  };

  const onMouseLeave = () => {
    tooltipEl.style.display = "none";
    if (lastHoveredSegment) {
      const prevColor =
        lastHoveredSegment.dataset.mutedColor ||
        lastHoveredSegment.dataset.color;
      if (prevColor) lastHoveredSegment.setAttribute("fill", prevColor);
      lastHoveredSegment = null;
    }
    lastHoverPosByContainer.delete(containerEl);
  };

  const scrollEl = containerEl.parentElement;
  const onScroll = () => {
    const lastPos = lastHoverPosByContainer.get(containerEl);
    if (!lastPos) return;
    requestAnimationFrame(() =>
      applyHoverAtClientPos(lastPos.clientX, lastPos.clientY, {remember: false})
    );
  };
  if (scrollEl) {
    scrollEl.addEventListener("scroll", onScroll, {passive: true});
  }

  svg.addEventListener("mousemove", onMouseMove);
  svg.addEventListener("mouseleave", onMouseLeave);

  hoverCleanupMap.set(svg, () => {
    svg.removeEventListener("mousemove", onMouseMove);
    svg.removeEventListener("mouseleave", onMouseLeave);
    if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
  });

  const lastPos = lastHoverPosByContainer.get(containerEl);
  if (lastPos && Number.isFinite(lastPos.clientX) && Number.isFinite(lastPos.clientY)) {
    requestAnimationFrame(() =>
      applyHoverAtClientPos(lastPos.clientX, lastPos.clientY, {remember: false})
    );
  }
}

// --------------------------- rawSegments helpers ---------------------------

function totalDurationSec(rawSegments) {
  return rawSegments.reduce(
    (sum, [minutes]) => sum + Math.max(1, Math.round((minutes || 0) * 60)),
    0
  );
}

/**
 * Draw all canonicalWorkout.rawSegments as polygons, using a running time cursor.
 */
function renderSegmentsFromRaw({
  svg,
  rawSegments,
  totalSec,
  width,
  height,
  ftp,
  maxY,
}) {
  let t = 0;
  for (const [minutes, startPct, endPct] of rawSegments) {
    const durSec = Math.max(1, Math.round((minutes || 0) * 60));
    const pStartRel = (startPct || 0) / 100;
    const pEndRel = (endPct != null ? endPct : startPct || 0) / 100;

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
    });

    t += durSec;
  }
}

// --------------------------- Mini workout graph (picker) ---------------------------

/**
 * Renders a small workout profile chart into a container for the picker.
 *
 * - container: DOM element where the SVG + tooltip go.
 * - workout: CanonicalWorkout (must have rawSegments)
 * - currentFtp: current FTP used in the picker view.
 */
export function renderMiniWorkoutGraph(container, workout, currentFtp) {
  // Clear previous contents
  container.innerHTML = "";

  const rawSegments = workout?.rawSegments || [];
  if (!rawSegments.length) {
    container.textContent = "No workout structure available.";
    container.classList.add("picker-detail-empty");
    return;
  }

  const ftp =
    currentFtp ||
    workout.baseFtp ||
    workout.ftpAtSelection ||
    workout.ftpFromFile ||
    DEFAULT_FTP;

  const totalSec = totalDurationSec(rawSegments);
  if (!totalSec) {
    container.textContent = "No workout structure available.";
    container.classList.add("picker-detail-empty");
    return;
  }

  // Match the SVG size to the container's bounding rect
  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;

  // Fallbacks in case the container has 0 size at render time
  if (!width) width = container.clientWidth || 400;
  if (!height) height = container.clientHeight || 120;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Internal coordinate system matches the pixel size of the container
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // Physically size the SVG to the container
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("picker-graph-svg");
  svg.setAttribute("shape-rendering", "crispEdges");

  // Transparent background rect so the whole area is hoverable
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "transparent");
  svg.appendChild(bg);


  // Vertical scale: same logic as before
  const maxY = Math.max(200, ftp * 2);

  // Draw workout segments
  renderSegmentsFromRaw({
    svg,
    rawSegments,
    totalSec,
    width,
    height,
    ftp,
    maxY,
  });

  // Tooltip element lives inside the same container
  const tooltip = document.createElement("div");
  tooltip.className = "picker-tooltip";

  container.appendChild(svg);
  container.appendChild(tooltip);

  // Hover handling shared with main chart
  attachSegmentHover(svg, tooltip, container, ftp);
}

// --------------------------- Builder mini chart ---------------------------

function computeBlockTimings(blocks) {
  const timings = [];
  let totalSec = 0;

  (blocks || []).forEach((block, idx) => {
    const start = totalSec;
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    for (const seg of segs) {
      const durSec = Math.max(1, Math.round((seg?.durationSec || 0)));
      totalSec += durSec;
    }
    timings.push({index: idx, tStart: start, tEnd: totalSec});
  });

  return {timings, totalSec};
}

/**
 * Renders the builder workout chart that operates on parsed blocks (not just flattened rawSegments).
 * Adds block-level highlighting + click handling to select/deselect blocks.
 */
export function renderBuilderWorkoutGraph(container, blocks, currentFtp, options = {}) {
  const {
    selectedBlockIndex = null,
    selectedBlockIndices = null,
    insertAfterBlockIndex = null,
    onSelectBlock,
    onSetInsertAfter,
    onSetInsertAfterFromSegment,
    lockTimelineSec = null,
  } = options;

  container.innerHTML = "";
  const scrollEl = container.parentElement;
  const chartCard = container.closest(".wb-chart-card");
  if (chartCard) {
    chartCard
      .querySelectorAll(".wb-chart-axis-overlay")
      .forEach((node) => node.remove());
  }

  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  const ftp = currentFtp || DEFAULT_FTP;

  const {timings, totalSec} = computeBlockTimings(safeBlocks);
  const segmentTimings = [];
  let segCursor = 0;
  (safeBlocks || []).forEach((block, blockIndex) => {
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    segs.forEach((seg, segIndex) => {
      const durSec = Math.max(1, Math.round((seg?.durationSec || 0)));
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

  const timelineSec = Math.max(
    3600,
    totalSec || 0,
    lockTimelineSec || 0,
  );
  const width = Math.max(1, Math.round((timelineSec / 3600) * baseWidth));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("picker-graph-svg");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "transparent");
  svg.appendChild(bg);

  const maxY = Math.max(200, ftp * 2);
  const gridStep = 100;
  const tickStepSec = 600;
  const hourStepSec = 3600;
  const tickBaseLen = 24;
  const tickHourLen = 32;

  for (let yVal = 0; yVal <= maxY; yVal += gridStep) {
    const y = height - (yVal / maxY) * height;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(width));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", getCssVar("--grid-line-subtle"));
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);
  }

  for (let t = tickStepSec; t <= timelineSec; t += tickStepSec) {
    const x = (t / timelineSec) * width;
    const isHour = t % hourStepSec === 0;
    const tickLen = isHour ? tickHourLen : tickBaseLen;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", String(x));
    tick.setAttribute("x2", String(x));
    tick.setAttribute("y1", "0");
    tick.setAttribute("y2", String(tickLen));
    tick.setAttribute("stroke", getCssVar("--grid-line-subtle"));
    tick.setAttribute("stroke-width", isHour ? "2" : "1.4");
    tick.setAttribute("pointer-events", "none");
    svg.appendChild(tick);

    const labelInset = 8;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x - labelInset));
    label.setAttribute("y", "2");
    label.setAttribute("dominant-baseline", "hanging");
    label.setAttribute("font-size", "16");
    label.setAttribute("font-weight", "300");
    label.setAttribute("fill", getCssVar("--text-muted"));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("pointer-events", "none");
    label.style.userSelect = "none";
    label.textContent = String(Math.round(t / 60));
    svg.appendChild(label);
  }

  const ftpY = height - (ftp / maxY) * height;

  const selectedSet = new Set(
    Array.isArray(selectedBlockIndices)
      ? selectedBlockIndices
      : selectedBlockIndex != null
        ? [selectedBlockIndex]
        : [],
  );

  // Block-wide highlight bands (pointer-events none so hover still works)
  timings.forEach(({index, tStart, tEnd}) => {
    const x1 = (tStart / timelineSec) * width;
    const x2 = (tEnd / timelineSec) * width;
    const w = Math.max(1, x2 - x1);

    const band = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    band.setAttribute("x", String(x1));
    band.setAttribute("y", "0");
    band.setAttribute("width", String(w));
    band.setAttribute("height", String(height));
    band.setAttribute("fill", "transparent");
    band.setAttribute("pointer-events", "none");
    band.classList.add("wb-block-band");
    band.dataset.blockIndex = String(index);
    if (selectedSet.has(index)) {
      band.classList.add("is-active");
    }
    svg.appendChild(band);
  });

  const HANDLE_TOP_HEIGHT = 18;
  const HANDLE_RIGHT_WIDTH = 18;
  const rightHandles = [];
  const topHandles = [];

  // Workout segments, preserving block ownership for styling
  let cursor = 0;
  (blocks || []).forEach((block, idx) => {
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    for (let segIndex = 0; segIndex < segs.length; segIndex += 1) {
      const seg = segs[segIndex];
      const durSec = Math.max(1, Math.round((seg?.durationSec || 0)));
      const pStartRel = seg?.pStartRel || 0;
      const pEndRel = seg?.pEndRel != null ? seg.pEndRel : pStartRel;

      const x1 = (cursor / timelineSec) * width;
      const x2 = ((cursor + durSec) / timelineSec) * width;
      const segWidth = Math.max(1, x2 - x1);

      const p0 = pStartRel * ftp;
      const p1 = pEndRel * ftp;
      const y0 = height - (Math.max(0, p0) / maxY) * height;
      const y1 = height - (Math.max(0, p1) / maxY) * height;

      const poly = renderSegmentPolygon({
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
      });

      if (poly) {
        poly.dataset.blockIndex = String(idx);
        poly.dataset.segIndex = String(segIndex);
        poly.dataset.x1 = String(x1);
        poly.dataset.x2 = String(x2);
        poly.dataset.y0 = String(y0);
        poly.dataset.y1 = String(y1);
        poly.dataset.dragHandle = "move";
        poly.classList.add("wb-block-segment");
        poly.classList.add("wb-drag-handle", "wb-drag-handle--move");
        if (selectedSet.has(idx)) {
          poly.classList.add("is-active");
        }
      }

      const topHandle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      const clampY = (val) => Math.max(0, Math.min(height, val));
      const y0t = clampY(y0 - HANDLE_TOP_HEIGHT);
      const y1t = clampY(y1 - HANDLE_TOP_HEIGHT);
      const y0b = clampY(y0 + HANDLE_TOP_HEIGHT);
      const y1b = clampY(y1 + HANDLE_TOP_HEIGHT);
      topHandle.setAttribute(
        "points",
        `${x1},${y0t} ${x2},${y1t} ${x2},${y1b} ${x1},${y0b}`,
      );
      topHandle.setAttribute("fill", "transparent");
      topHandle.setAttribute("pointer-events", "all");
      topHandle.dataset.blockIndex = String(idx);
      topHandle.dataset.segIndex = String(segIndex);
      topHandle.dataset.dragHandle = "top";
      topHandle.dataset.x1 = String(x1);
      topHandle.dataset.x2 = String(x2);
      const handleBaseWidth = Math.min(
        HANDLE_RIGHT_WIDTH,
        Math.max(6, segWidth),
      );
      const nextSeg =
        segIndex + 1 < segs.length
          ? segs[segIndex + 1]
          : blocks?.[idx + 1]?.segments?.[0];
      const nextDurationSec = Math.max(
        0,
        Math.round(nextSeg?.durationSec || 0),
      );
      const leftExtend = handleBaseWidth * 0.75;
      const rightExtend = nextDurationSec > 90
        ? handleBaseWidth * 0.5
        : handleBaseWidth * 0.25;
      const handleWidth = leftExtend + rightExtend;
      const rightHandle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rightHandle.setAttribute("x", String(x2 - leftExtend));
      rightHandle.setAttribute("y", "0");
      rightHandle.setAttribute("width", String(handleWidth));
      rightHandle.setAttribute("height", String(height));
      rightHandle.setAttribute("fill", "transparent");
      rightHandle.setAttribute("pointer-events", "all");
      rightHandle.dataset.blockIndex = String(idx);
      rightHandle.dataset.segIndex = String(segIndex);
      rightHandle.dataset.dragHandle = "right";
      rightHandle.classList.add("wb-drag-handle", "wb-drag-handle--right");
      rightHandles.push(rightHandle);

      topHandle.classList.add("wb-drag-handle", "wb-drag-handle--top");
      topHandles.push(topHandle);

      cursor += durSec;
    }
  });

  rightHandles.forEach((handle) => svg.appendChild(handle));
  topHandles.forEach((handle) => svg.appendChild(handle));

  const ftpLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  ftpLine.setAttribute("x1", "0");
  ftpLine.setAttribute("x2", String(width));
  ftpLine.setAttribute("y1", String(ftpY));
  ftpLine.setAttribute("y2", String(ftpY));
  ftpLine.setAttribute("stroke", getCssVar("--ftp-line"));
  ftpLine.setAttribute("stroke-width", "1.4");
  ftpLine.setAttribute("pointer-events", "none");
  svg.appendChild(ftpLine);

  const tooltip = document.createElement("div");
  tooltip.className = "picker-tooltip";

  container.appendChild(svg);
  container.appendChild(tooltip);

  if (scrollEl && chartCard) {
    const labelStep = gridStep;
    const leftOffset = scrollEl.offsetLeft;
    const topOffset = scrollEl.offsetTop;
    const viewWidth = scrollEl.clientWidth;

    const yLabels = document.createElement("div");
    yLabels.className = "wb-chart-axis-overlay wb-chart-axis-overlay--grid";
    yLabels.style.height = `${height}px`;
    yLabels.style.top = `${topOffset}px`;
    yLabels.style.left = `${leftOffset}px`;
    yLabels.style.width = `${viewWidth}px`;

    for (let yVal = 0; yVal <= maxY; yVal += labelStep) {
      const y = height - (yVal / maxY) * height;
      const labelTop = y - 24;
      if (labelTop < 0 || labelTop > height - 20) continue;
      const label = document.createElement("div");
      label.className = "wb-chart-axis-label";
      label.textContent = String(yVal);
      label.style.top = `${labelTop}px`;
      yLabels.appendChild(label);
    }

    const ftpLabel = document.createElement("div");
    ftpLabel.className = "wb-chart-axis-label wb-chart-axis-label--ftp";
    ftpLabel.textContent = `FTP ${Math.round(ftp)}`;
    const ftpOffset = 24;
    const ftpLabelTop = Math.max(0, Math.min(height - 20, ftpY - ftpOffset));
    ftpLabel.style.top = `${ftpLabelTop}px`;

    const ftpLabels = document.createElement("div");
    ftpLabels.className = "wb-chart-axis-overlay wb-chart-axis-overlay--ftp";
    ftpLabels.style.height = `${height}px`;
    ftpLabels.style.top = `${topOffset}px`;
    ftpLabels.style.left = `${leftOffset}px`;
    ftpLabels.style.width = `${viewWidth}px`;
    ftpLabels.appendChild(ftpLabel);

    const durationSec = totalSec || 0;
    if (durationSec > 0) {
      const durationLabel = document.createElement("div");
      durationLabel.className = "wb-chart-axis-label wb-chart-axis-label--duration";
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

  if (
    Number.isInteger(insertAfterBlockIndex) &&
    insertAfterBlockIndex >= -1
  ) {
    let tInsert = 0;
    if (timings.length) {
      tInsert =
        insertAfterBlockIndex < 0
          ? 0
          : timings[Math.min(insertAfterBlockIndex, timings.length - 1)].tEnd;
    }
    const x = (tInsert / timelineSec) * width;
    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("y2", String(height));
    line.setAttribute("stroke", getCssVar("--wb-insert-line"));
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 4");
    line.setAttribute("pointer-events", "none");
    line.classList.add("wb-insert-line");
    svg.appendChild(line);
  }

  attachSegmentHover(svg, tooltip, container, ftp);

  svg.addEventListener("mousedown", (e) => {
    if (e.shiftKey) {
      e.preventDefault();
    }
  });

  svg.addEventListener("click", (e) => {
    const targetBlock =
      e.target && e.target.closest
        ? e.target.closest("[data-block-index]")
        : null;

    if (targetBlock && targetBlock.dataset.blockIndex != null) {
      if (typeof onSelectBlock !== "function") return;
      const idx = Number(targetBlock.dataset.blockIndex);
      onSelectBlock(Number.isFinite(idx) ? idx : null, {shiftKey: e.shiftKey});
      if (!e.shiftKey && typeof onSetInsertAfterFromSegment === "function") {
        const blockIndex = Number(targetBlock.dataset.blockIndex);
        const segIndex = Number(targetBlock.dataset.segIndex);
        const blockTiming = timings.find((t) => t.index === blockIndex);
        const block =
          Number.isFinite(blockIndex) && blocks ? blocks[blockIndex] : null;
        let insertIdx = Number.isFinite(blockIndex) ? blockIndex : -1;

        const svgRect = svg.getBoundingClientRect();
        const localX = e.clientX - svgRect.left;
        const clampedX = Math.max(0, Math.min(width, localX));
        const svgX = (clampedX / Math.max(1, svgRect.width)) * width;

        if (block && block.kind === "intervals" && blockTiming) {
          if (Number.isFinite(segIndex)) {
            const isOn = segIndex % 2 === 0;
            insertIdx = isOn ? blockIndex - 1 : blockIndex;
          } else {
            const mid = (blockTiming.tStart + blockTiming.tEnd) / 2;
            const timeSec = (clampedX / width) * timelineSec;
            insertIdx = timeSec < mid ? blockIndex - 1 : blockIndex;
          }
        } else if (Number.isFinite(segIndex) && segmentTimings.length) {
          if (typeof targetBlock.getBBox === "function") {
            const bbox = targetBlock.getBBox();
            const midX = bbox.x + bbox.width / 2;
            insertIdx = svgX < midX ? blockIndex - 1 : blockIndex;
          } else {
            const seg = segmentTimings.find(
              (t) => t.blockIndex === blockIndex && t.segIndex === segIndex,
            );
            if (seg) {
              const mid = (seg.tStart + seg.tEnd) / 2;
              const timeSec = (clampedX / width) * timelineSec;
              insertIdx = timeSec < mid ? blockIndex - 1 : blockIndex;
            }
          }
        }

        if (insertIdx < -1) insertIdx = -1;
        if (insertIdx >= timings.length) insertIdx = timings.length - 1;
        onSetInsertAfterFromSegment(insertIdx);
      }
      return;
    }

    if (typeof onSetInsertAfter !== "function" || !timings.length) {
      if (typeof onSelectBlock === "function") onSelectBlock(null);
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    const localX = e.clientX - svgRect.left;
    const clampedX = Math.max(0, Math.min(width, localX));
    const timeSec = (clampedX / width) * timelineSec;

    let idx = -1;
    const blockTiming =
      timings.find(({tEnd}) => timeSec <= tEnd) ||
      timings[timings.length - 1];
    const block =
      blockTiming && blocks ? blocks[blockTiming.index] : null;

    let seg = null;
    if (segmentTimings.length) {
      seg = segmentTimings.find((t) => timeSec <= t.tEnd);
      if (!seg) seg = segmentTimings[segmentTimings.length - 1];
    }

    if (block && block.kind === "intervals") {
      if (seg && Number.isFinite(seg.segIndex)) {
        const isOn = seg.segIndex % 2 === 0;
        idx = isOn ? blockTiming.index - 1 : blockTiming.index;
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


// --------------------------- Main workout chart ---------------------------

export function drawWorkoutChart({
  svg,
  panel,
  tooltipEl,
  width,
  height,
  mode,
  ftp,
  rawSegments,     // CanonicalWorkout.rawSegments
  elapsedSec,
  liveSamples,
  manualErgTarget,
  showProgress = true,
}) {
  if (!svg || !panel) return;
  clearSvg(svg);

  // Treat long data gaps as breaks in the line so we don't visually interpolate
  const GAP_BREAK_SECONDS = 6;

  const w = width;
  const h = height;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("shape-rendering", "crispEdges");

  const maxY = Math.max(200, ftp * 2);

  // grid
  const step = 100;
  for (let yVal = 0; yVal <= maxY; yVal += step) {
    const y = h - (yVal / maxY) * h;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(w));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", getCssVar("--grid-line-subtle"));
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "4");
    label.setAttribute("y", String(y - 6));
    label.setAttribute("font-size", "16");
    label.setAttribute("fill", getCssVar("--text-muted"));
    label.setAttribute("pointer-events", "none");
    label.textContent = String(yVal);
    svg.appendChild(label);
  }

  // horizontal span (seconds)
  const samples = liveSamples || [];
  let totalFromStructure =
    rawSegments && rawSegments.length ? totalDurationSec(rawSegments) : 0;

  let safeTotalSec = Math.max(
    1,
    totalFromStructure,
    elapsedSec || 0,
    samples.length ? samples[samples.length - 1].t || 0 : 0
  );

  const elapsedClamped = Math.max(0, Math.min(safeTotalSec, elapsedSec || 0));

  // workout segments (from rawSegments)
  if (mode === "workout" && rawSegments && rawSegments.length) {
    renderSegmentsFromRaw({
      svg,
      rawSegments,
      totalSec: safeTotalSec,
      width: w,
      height: h,
      ftp,
      maxY,
    });
  }

  // ERG mode target (no structure needed)
  if (mode === "erg") {
    const ftpForErg = ftp > 0 ? ftp : DEFAULT_FTP;
    const pctFtp = manualErgTarget / ftpForErg;
    renderSegmentPolygon({
      svg,
      totalSec: safeTotalSec,
      width: w,
      height: h,
      ftp,
      maxY,
      tStart: 0,
      tEnd: safeTotalSec,
      pStartRel: pctFtp,
      pEndRel: pctFtp,
    });
  }

  // past shade
  if (showProgress && elapsedClamped > 0 && safeTotalSec > 0) {
    const xPast = Math.min(w, (elapsedClamped / safeTotalSec) * w);
    const shade = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    shade.setAttribute("x", "0");
    shade.setAttribute("y", "0");
    shade.setAttribute("width", String(xPast));
    shade.setAttribute("height", String(h));
    shade.setAttribute("fill", getCssVar("--shade-bg"));
    shade.setAttribute("fill-opacity", "0.05");
    shade.setAttribute("pointer-events", "none");
    svg.appendChild(shade);
  }

  // FTP line
  const ftpY = h - (ftp / maxY) * h;
  const ftpLineWidth = 1.5;
  const ftpLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  ftpLine.setAttribute("x1", "0");
  ftpLine.setAttribute("x2", String(w));
  ftpLine.setAttribute("y1", String(ftpY));
  ftpLine.setAttribute("y2", String(ftpY));
  ftpLine.setAttribute("stroke", getCssVar("--ftp-line"));
  ftpLine.setAttribute("stroke-width", String(ftpLineWidth));
  ftpLine.setAttribute("pointer-events", "none");
  svg.appendChild(ftpLine);

  const ftpFontSize = 16;
  const ftpLabelOffset = 6;
  const ftpLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  ftpLabel.setAttribute("x", String(w - 4));
  ftpLabel.setAttribute("y", String(ftpY - ftpLabelOffset));
  ftpLabel.setAttribute("font-size", String(ftpFontSize));
  ftpLabel.setAttribute("fill", getCssVar("--ftp-line"));
  ftpLabel.setAttribute("text-anchor", "end");
  ftpLabel.setAttribute("pointer-events", "none");
  ftpLabel.textContent = `FTP ${ftp}`;
  svg.appendChild(ftpLabel);

  if (totalFromStructure > 0) {
    const durationLabel = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    durationLabel.setAttribute("x", String(w - 4));
    durationLabel.setAttribute("y", String(ftpY + ftpLabelOffset + ftpFontSize - ftpLineWidth * 2));
    durationLabel.setAttribute("font-size", String(ftpFontSize));
    durationLabel.setAttribute("fill", getCssVar("--ftp-line"));
    durationLabel.setAttribute("text-anchor", "end");
    durationLabel.setAttribute("pointer-events", "none");
    durationLabel.textContent = formatDurationMinSec(totalFromStructure);
    svg.appendChild(durationLabel);
  }

  // position line
  if (showProgress && elapsedClamped > 0) {
    const xNow = Math.min(w, (elapsedClamped / safeTotalSec) * w);
    const posLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    posLine.setAttribute("x1", String(xNow));
    posLine.setAttribute("x2", String(xNow));
    posLine.setAttribute("y1", "0");
    posLine.setAttribute("y2", String(h));
    posLine.setAttribute("stroke", "#fdd835");
    posLine.setAttribute("stroke-width", "1.5");
    posLine.setAttribute("pointer-events", "none");
    svg.appendChild(posLine);
  }

  // live sample lines
  const powerColor = getCssVar("--power-line");
  const hrColor = getCssVar("--hr-line");
  const cadColor = getCssVar("--cad-line");

  if (samples.length) {
    const pathsForKey = (key) => {
      const paths = [];
      let d = "";
      let lastT = null;

      samples.forEach((s) => {
        const t = s.t;
        const val = s[key];
        const hasVal = val != null && Number.isFinite(val);
        const hasTime = Number.isFinite(t);

        if (!hasVal || !hasTime) {
          if (d) {
            paths.push(d);
            d = "";
          }
          lastT = null;
          return;
        }

        const gap = lastT == null ? 0 : t - lastT;
        if (lastT != null && gap > GAP_BREAK_SECONDS) {
          if (d) paths.push(d);
          d = "";
        }

        const x = Math.min(w, (t / safeTotalSec) * w);
        const yVal = Math.min(maxY, Math.max(0, val));
        const y = h - (yVal / maxY) * h;
        d += (d ? " L " : "M ") + x + " " + y;
        lastT = t;
      });

      if (d) paths.push(d);
      return paths;
    };

    const addPaths = (segments, color, strokeWidth) => {
      segments.forEach((d) => {
        if (!d) return;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", color);
        p.setAttribute("stroke-width", String(strokeWidth));
        p.setAttribute("pointer-events", "none");
        svg.appendChild(p);
      });
    };

    addPaths(pathsForKey("power"), powerColor, 2.5);
    addPaths(pathsForKey("hr"), hrColor, 1.5);
    addPaths(pathsForKey("cadence"), cadColor, 1.5);
  }

  attachSegmentHover(svg, tooltipEl, panel, ftp);
}
