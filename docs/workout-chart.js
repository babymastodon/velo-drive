// workout-chart.js
// Shared chart helpers: zones, colors, SVG rendering, hover, and raw-segment handling.

import {DEFAULT_FTP} from "./workout-metrics.js";

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

  const y0 = h - (Math.min(maxY, Math.max(0, p0)) / maxY) * h;
  const y1 = h - (Math.min(maxY, Math.max(0, p1)) / maxY) * h;

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", `${x1},${h} ${x1},${y0} ${x2},${y1} ${x2},${h}`);

  const muted = mixColors(zone.color, zone.bg, 0.3);
  const hover = mixColors(zone.color, zone.bg, 0.15);

  poly.setAttribute("fill", muted);
  poly.setAttribute("fill-opacity", "1");
  poly.setAttribute("stroke", "none");
  poly.classList.add("chart-segment");

  const durMin = (tEnd - tStart) / 60;
  const p0Pct = pStartRel * 100;
  const p1Pct = pEndRel * 100;

  poly.dataset.zone = zone.key;
  poly.dataset.p0 = p0Pct.toFixed(0);
  poly.dataset.p1 = p1Pct.toFixed(0);
  poly.dataset.durMin = durMin.toFixed(1);
  poly.dataset.color = zone.color;
  poly.dataset.mutedColor = muted;
  poly.dataset.hoverColor = hover;

  svg.appendChild(poly);

  return poly;
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

    const hitEl = document.elementFromPoint(clientX, clientY);
    const segment =
      hitEl && hitEl.closest ? hitEl.closest(".chart-segment") : null;

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
    const durMin = Number(segment.dataset.durMin);
    const durSec = Math.round(durMin * 60);
    const dur = durMin >= 1 ? `${durMin} min` : `${durSec} sec`;
    const w0 = Math.round((p0 * ftp) / 100);
    const w1 = Math.round((p1 * ftp) / 100);

    tooltipEl.textContent =
      p0 === p1
        ? `${zone}: ${p0}% FTP, ${w0}W, ${dur}`
        : `${zone}: ${p0}–${p1}% FTP, ${w0}-${w1}W, ${dur}`;
    tooltipEl.style.display = "block";

    const panelRect = containerEl.getBoundingClientRect();
    let tx = clientX - panelRect.left + 8;
    let ty = clientY - panelRect.top + 8;

    const ttRect = tooltipEl.getBoundingClientRect();
    if (tx + ttRect.width > panelRect.width - 4) {
      tx = panelRect.width - ttRect.width - 4;
    }
    if (tx < 0) tx = 0;
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

  svg.addEventListener("mousemove", onMouseMove);
  svg.addEventListener("mouseleave", onMouseLeave);

  hoverCleanupMap.set(svg, () => {
    svg.removeEventListener("mousemove", onMouseMove);
    svg.removeEventListener("mouseleave", onMouseLeave);
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
    insertAfterBlockIndex = null,
    onSelectBlock,
  } = options;

  container.innerHTML = "";

  if (!Array.isArray(blocks) || !blocks.length) {
    container.textContent = "No workout structure available.";
    container.classList.add("picker-detail-empty");
    return;
  }

  const ftp =
    currentFtp ||
    DEFAULT_FTP;

  const {timings, totalSec} = computeBlockTimings(blocks);
  if (!totalSec) {
    container.textContent = "No workout structure available.";
    container.classList.add("picker-detail-empty");
    return;
  }

  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;

  if (!width) width = container.clientWidth || 400;
  if (!height) height = container.clientHeight || 120;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("picker-graph-svg");
  svg.setAttribute("shape-rendering", "crispEdges");

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "transparent");
  svg.appendChild(bg);

  const maxY = Math.max(200, ftp * 2);

  // Block-wide highlight bands (pointer-events none so hover still works)
  timings.forEach(({index, tStart, tEnd}) => {
    const x1 = (tStart / totalSec) * width;
    const x2 = (tEnd / totalSec) * width;
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
    if (index === selectedBlockIndex) {
      band.classList.add("is-active");
    }
    svg.appendChild(band);
  });

  // Workout segments, preserving block ownership for styling
  let cursor = 0;
  (blocks || []).forEach((block, idx) => {
    const segs = Array.isArray(block?.segments) ? block.segments : [];
    for (const seg of segs) {
      const durSec = Math.max(1, Math.round((seg?.durationSec || 0)));
      const pStartRel = seg?.pStartRel || 0;
      const pEndRel = seg?.pEndRel != null ? seg.pEndRel : pStartRel;

      const poly = renderSegmentPolygon({
        svg,
        totalSec,
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
        poly.classList.add("wb-block-segment");
        if (idx === selectedBlockIndex) {
          poly.classList.add("is-active");
        }
      }

      cursor += durSec;
    }
  });

  const tooltip = document.createElement("div");
  tooltip.className = "picker-tooltip";

  container.appendChild(svg);
  container.appendChild(tooltip);

  if (
    Number.isInteger(insertAfterBlockIndex) &&
    insertAfterBlockIndex >= 0 &&
    insertAfterBlockIndex < timings.length
  ) {
    const tInsert = timings[insertAfterBlockIndex].tEnd;
    const x = (tInsert / totalSec) * width;
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

  svg.addEventListener("click", (e) => {
    if (typeof onSelectBlock !== "function") return;

    const targetBlock =
      e.target && e.target.closest
        ? e.target.closest("[data-block-index]")
        : null;

    if (targetBlock && targetBlock.dataset.blockIndex != null) {
      const idx = Number(targetBlock.dataset.blockIndex);
      onSelectBlock(Number.isFinite(idx) ? idx : null);
    } else {
      onSelectBlock(null);
    }
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
}) {
  if (!svg || !panel) return;
  clearSvg(svg);

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
  if (elapsedSec > 0 && safeTotalSec > 0) {
    const xPast = Math.min(w, (elapsedSec / safeTotalSec) * w);
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

  const durationMinutes =
    totalFromStructure > 0 ? Math.round(totalFromStructure / 60) : null;
  if (durationMinutes) {
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
    durationLabel.textContent = `${durationMinutes} min`;
    svg.appendChild(durationLabel);
  }

  // position line
  const xNow = Math.min(w, (elapsedSec / safeTotalSec) * w);
  const posLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  posLine.setAttribute("x1", String(xNow));
  posLine.setAttribute("x2", String(xNow));
  posLine.setAttribute("y1", "0");
  posLine.setAttribute("y2", String(h));
  posLine.setAttribute("stroke", "#fdd835");
  posLine.setAttribute("stroke-width", "1.5");
  posLine.setAttribute("pointer-events", "none");
  svg.appendChild(posLine);

  // live sample lines
  const powerColor = getCssVar("--power-line");
  const hrColor = getCssVar("--hr-line");
  const cadColor = getCssVar("--cad-line");

  if (samples.length) {
    const pathForKey = (key) => {
      let d = "";
      samples.forEach((s) => {
        const t = s.t;
        const val = s[key];
        if (val == null) return;
        const x = Math.min(w, (t / safeTotalSec) * w);
        const yVal = Math.min(maxY, Math.max(0, val));
        const y = h - (yVal / maxY) * h;
        d += (d ? " L " : "M ") + x + " " + y;
      });
      return d;
    };

    const addPath = (d, color, strokeWidth) => {
      if (!d) return;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", String(strokeWidth));
      p.setAttribute("pointer-events", "none");
      svg.appendChild(p);
    };

    addPath(pathForKey("power"), powerColor, 2.5);
    addPath(pathForKey("hr"), hrColor, 1.5);
    addPath(pathForKey("cadence"), cadColor, 1.5);
  }

  attachSegmentHover(svg, tooltipEl, panel, ftp);
}
