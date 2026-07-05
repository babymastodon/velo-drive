// @vitest-environment happy-dom
//
// Render-lock for core/chart.ts. Calls EVERY exported chart renderer with fixed
// representative inputs and snapshots the produced SVG/DOM markup. The visual
// (pixel) gate does not exercise every chart variant (picker expanded
// mini-chart, planner ride-detail / calendar mini-charts), so this asserts the
// markup is stable (byte-identical) across changes to chart.ts.
//
// The test container has no theme CSS, so getCssVar returns '' for every var;
// that is fine — we only assert the markup is STABLE (before == after).

import { describe, expect, it } from 'vitest';
import {
  drawWorkoutChart,
  renderMiniWorkoutGraph,
  renderBuilderWorkoutGraph,
  drawMiniHistoryChart,
  drawPowerCurveChart,
} from '../../src/core/chart.js';
import { parseZwoXmlToCanonicalWorkout } from '../../src/core/zwo.js';
import type { RawSegment } from '../../src/core/model.js';
import type { Block } from '../../src/core/builder-backend.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// A small real .zwo-derived workout (warmup ramp, steady, intervals, freeride,
// cooldown ramp) parsed through the production codec so the rawSegments tuple
// shape is exactly what the app feeds the charts.
const ZWO = `<workout_file>
  <name>Render Lock</name>
  <author>Test</author>
  <description>fixture</description>
  <workout>
    <Warmup Duration="300" PowerLow="0.45" PowerHigh="0.75"/>
    <SteadyState Duration="180" Power="0.85" Cadence="90"/>
    <IntervalsT Repeat="3" OnDuration="60" OffDuration="60" OnPower="1.10" OffPower="0.55"/>
    <FreeRide Duration="120"/>
    <Cooldown Duration="240" PowerLow="0.7" PowerHigh="0.4"/>
  </workout>
</workout_file>`;

const parsed = parseZwoXmlToCanonicalWorkout(ZWO)!;
const rawSegments: RawSegment[] = parsed.rawSegments;

const liveSamples = [
  { t: 0, power: 120, hr: 95, cadence: 80 },
  { t: 30, power: 160, hr: 110, cadence: 88 },
  { t: 60, power: 210, hr: 128, cadence: 92 },
  { t: 90, power: null, hr: 130, cadence: 90 }, // gap in power
  { t: 200, power: 240, hr: 150, cadence: 95 },
  { t: 400, power: 180, hr: 140, cadence: 90 },
];

const textEvents = [
  { offsetSec: 60, durationSec: 20, text: 'Push now' },
  { offsetSec: 500, durationSec: 15, text: 'Ease off' },
];

const builderBlocks: Block[] = [
  {
    kind: 'steady',
    attrs: {},
    segments: [{ durationSec: 300, pStartRel: 0.5, pEndRel: 0.8, cadence: 85 }],
  },
  {
    kind: 'intervals',
    attrs: {},
    segments: [
      { durationSec: 60, pStartRel: 1.1, pEndRel: 1.1, cadence: 100 },
      { durationSec: 60, pStartRel: 0.55, pEndRel: 0.55, cadence: 80 },
      { durationSec: 60, pStartRel: 1.1, pEndRel: 1.1, cadence: 100 },
      { durationSec: 60, pStartRel: 0.55, pEndRel: 0.55, cadence: 80 },
    ],
  },
  {
    kind: 'freeride',
    attrs: {},
    segments: [{ durationSec: 120, pStartRel: 0.5, pEndRel: 0.5, isFreeRide: true }],
  },
];

function makeSvg(): SVGSVGElement {
  return document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
}

describe('chart.ts render-lock (byte-identical SVG markup)', () => {
  it('drawWorkoutChart (HUD live chart)', () => {
    const svg = makeSvg();
    const panel = document.createElement('div');
    const tooltip = document.createElement('div');
    panel.appendChild(svg);
    panel.appendChild(tooltip);
    document.body.appendChild(panel);
    drawWorkoutChart({
      svg,
      width: 600,
      height: 240,
      ftp: 250,
      rawSegments,
      elapsedSec: 200,
      liveSamples,
      showProgress: true,
      textEvents,
      panel,
      tooltipEl: tooltip,
    });
    expect(panel.innerHTML).toMatchSnapshot();
    panel.remove();
  });

  it('drawWorkoutChart (no progress, no hover wiring)', () => {
    const svg = makeSvg();
    drawWorkoutChart({
      svg,
      width: 600,
      height: 240,
      ftp: 200,
      rawSegments,
      elapsedSec: 0,
      liveSamples: [],
      showProgress: false,
    });
    expect(svg.outerHTML).toMatchSnapshot();
  });

  it('renderMiniWorkoutGraph (picker expanded mini-chart)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderMiniWorkoutGraph(container, { rawSegments }, 230);
    expect(container.innerHTML).toMatchSnapshot();
    container.remove();
  });

  it('renderBuilderWorkoutGraph (builder chart)', () => {
    // Reproduce the host structure the renderer reads: a scroll element parent
    // inside a .wb-chart-card so the scroll-pinned axis overlay path runs.
    const card = document.createElement('div');
    card.className = 'wb-chart-card';
    const scrollEl = document.createElement('div');
    const container = document.createElement('div');
    scrollEl.appendChild(container);
    card.appendChild(scrollEl);
    document.body.appendChild(card);
    renderBuilderWorkoutGraph(container, builderBlocks, 250, {
      selectedBlockIndices: [1],
      insertAfterBlockIndex: 0,
      textEvents,
      activeTextEventIndex: 0,
    });
    expect(card.innerHTML).toMatchSnapshot();
    card.remove();
  });

  it('drawMiniHistoryChart (planner calendar mini-chart)', () => {
    const svg = makeSvg();
    drawMiniHistoryChart({
      svg,
      width: 320,
      height: 120,
      ftp: 240,
      rawSegments,
      actualLineSegments: [
        [120, 130, 60],
        [200, 210, 120],
        [160, 150, 180],
      ],
      actualPowerMax: 260,
      durationSec: 900,
    });
    expect(svg.outerHTML).toMatchSnapshot();
  });

  it('drawPowerCurveChart (planner ride-detail chart)', () => {
    const svg = makeSvg();
    drawPowerCurveChart({
      svg,
      width: 600,
      height: 300,
      ftp: 250,
      points: [
        { durSec: 1, power: 800 },
        { durSec: 5, power: 600 },
        { durSec: 60, power: 400 },
        { durSec: 300, power: 320 },
        { durSec: 1200, power: 280 },
        { durSec: 3600, power: 250 },
      ],
      maxDurationSec: 3600,
    });
    expect(svg.outerHTML).toMatchSnapshot();
  });

  // Theme coverage: getCssVar reads document theme. The test container has no
  // theme CSS so both renders return '' for every var — we only assert the two
  // renders are identical to each other (the refactor must not perturb the
  // getCssVar coupling / call order).
  it('drawWorkoutChart is deterministic across repeated renders (palette path)', () => {
    const a = makeSvg();
    const b = makeSvg();
    const argsBase = {
      width: 600,
      height: 240,
      ftp: 250,
      rawSegments,
      elapsedSec: 120,
      liveSamples,
      showProgress: true,
    };
    drawWorkoutChart({ svg: a, ...argsBase });
    document.documentElement.classList.add('theme-dark');
    drawWorkoutChart({ svg: b, ...argsBase });
    document.documentElement.classList.remove('theme-dark');
    // freeride pattern ids carry a module-global counter; normalize them out so
    // the structural comparison is stable.
    const norm = (s: string) => s.replace(/freeride-pattern-\d+/g, 'freeride-pattern-N');
    expect(norm(a.outerHTML)).toEqual(norm(b.outerHTML));
  });
});

// --------------------------- power-curve hover ---------------------------
//
// happy-dom lays out nothing, so getBoundingClientRect is stubbed per element
// to give the hover engine a real coordinate space. viewBox coords == screen
// px here (rect width/height match the drawn width/height).

function stubRect(
  target: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  (target as HTMLElement).getBoundingClientRect = () =>
    ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('drawPowerCurveChart hover', () => {
  const curvePoints = [
    { durSec: 1, power: 800 },
    { durSec: 5, power: 600 },
    { durSec: 60, power: 400 },
    { durSec: 300, power: 320 },
    { durSec: 1200, power: 280 },
    { durSec: 3600, power: 250 },
  ];

  function setup(points = curvePoints, maxDurationSec = 3600) {
    const svg = makeSvg();
    const panel = document.createElement('div');
    const tooltip = document.createElement('div');
    panel.appendChild(svg);
    panel.appendChild(tooltip);
    document.body.appendChild(panel);
    stubRect(svg, { left: 0, top: 0, width: 600, height: 300 });
    stubRect(panel, { left: 0, top: 0, width: 600, height: 300 });
    drawPowerCurveChart({
      svg,
      width: 600,
      height: 300,
      ftp: 250,
      points,
      maxDurationSec,
      panel,
      tooltipEl: tooltip,
    });
    return { svg, panel, tooltip };
  }

  // Fixture y coords (maxPower scales to 1000 W over a 300px height):
  // 1s/800W → y=60, 60s/400W → y=180, 3600s/250W → y=225.
  function move(svg: SVGSVGElement, clientX: number, clientY: number): void {
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
  }

  function hoverDot(svg: SVGSVGElement): SVGCircleElement | null {
    return svg.querySelector('circle');
  }

  it('snaps to the nearest point by x and shows duration + power', () => {
    const { svg, panel, tooltip } = setup();
    // x=300 is closest to the 60s point (log-x scale); y=180 is on the line.
    move(svg, 300, 180);
    expect(tooltip.textContent).toBe('Best 1m: 400 W');
    expect(tooltip.style.display).toBe('block');
    const dot = hoverDot(svg)!;
    expect(dot.style.display).toBe('block');
    expect(Number(dot.getAttribute('cx'))).toBeGreaterThan(0);
    panel.remove();
  });

  it('clamps to the first/last point at the chart edges', () => {
    const { svg, panel, tooltip } = setup();
    move(svg, 0, 60); // left edge, at the 1s point's height
    expect(tooltip.textContent).toBe('Best 1s: 800 W');
    move(svg, 600, 225); // right edge, past the last point (maxDur has a 1.1 margin)
    expect(tooltip.textContent).toBe('Best 1h: 250 W');
    panel.remove();
  });

  it('stays inert when the cursor is vertically far from the line', () => {
    const { svg, panel, tooltip } = setup();
    move(svg, 300, 60); // 120px above the 60s point (y=180) → outside the hit radius
    expect(tooltip.style.display).toBe('none');
    expect(hoverDot(svg)!.style.display).toBe('none');
    move(svg, 300, 170); // within 16px of the line → shows again
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.textContent).toBe('Best 1m: 400 W');
    move(svg, 300, 197); // 17px below → hides again
    expect(tooltip.style.display).toBe('none');
    panel.remove();
  });

  it('labels sub-hour durations with a seconds remainder (90s ≠ 1m)', () => {
    const { svg, panel, tooltip } = setup([{ durSec: 90, power: 500 }], 0);
    move(svg, 300, 10); // single 500W point tops the 500W scale (y=0)
    expect(tooltip.textContent).toBe('Best 1m30s: 500 W');
    panel.remove();
  });

  it('hides the tooltip and dot on mouseleave', () => {
    const { svg, panel, tooltip } = setup();
    move(svg, 300, 180);
    svg.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltip.style.display).toBe('none');
    expect(hoverDot(svg)!.style.display).toBe('none');
    panel.remove();
  });

  it('a redraw detaches the previous hover wiring and hides the tooltip', () => {
    const { svg, panel, tooltip } = setup();
    move(svg, 300, 180);
    expect(tooltip.style.display).toBe('block');
    // Redraw without hover wiring (e.g. tooltip removed from the DOM).
    drawPowerCurveChart({ svg, width: 600, height: 300, ftp: 250, points: curvePoints });
    expect(tooltip.style.display).toBe('none');
    move(svg, 300, 180);
    expect(tooltip.style.display).toBe('none');
    expect(hoverDot(svg)).toBeNull();
    panel.remove();
  });

  it('does not attach hover for an empty curve', () => {
    const { svg, panel, tooltip } = setup([], 0);
    move(svg, 300, 150);
    expect(tooltip.style.display).toBe('none');
    expect(hoverDot(svg)).toBeNull();
    panel.remove();
  });
});
