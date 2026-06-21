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
