<script lang="ts">
  import type { EngineViewModel } from '../core/engine.js';
  import {
    formatTimeMMSS,
    formatTimeHHMMSS,
    powerText,
    hrText,
    cadenceText,
    targetPowerText,
    cadenceIndicator,
    statColor,
  } from './hud-format.js';

  let { vm }: { vm: EngineViewModel } = $props();

  const color = $derived(statColor(vm));
  const indicator = $derived(cadenceIndicator(vm));

  let panelEl = $state<HTMLElement | null>(null);

  // Dynamic stat font sizing: scale each .stat-value to fill its card; the two
  // time cards (.stat-lg) get a wider divisor (6 vs 3). This is what produces
  // the large clock digits in the HUD.
  function adjustStatFontSizes(): void {
    if (!panelEl) return;
    const cards = panelEl.querySelectorAll('.stat-card');
    cards.forEach((card) => {
      const valueEl = card.querySelector('.stat-value') as HTMLElement | null;
      if (!valueEl) return;
      const labelEl = card.querySelector('.stat-label');
      const cardRect = card.getBoundingClientRect();
      if (!cardRect.width || !cardRect.height) return;
      const labelRect = labelEl ? labelEl.getBoundingClientRect() : { height: 0 };
      const availableHeight = cardRect.height - labelRect.height - 6;
      const availableWidth = cardRect.width;
      const isDouble = valueEl.classList.contains('stat-lg');
      const fs = Math.max(18, Math.min(availableHeight, availableWidth / (isDouble ? 6 : 3)) * 0.9);
      valueEl.style.fontSize = `${fs}px`;
    });
  }

  $effect(() => {
    // re-run when text content changes (e.g. mm:ss width) and on mount
    void vm.elapsedSec;
    void vm.intervalElapsedSec;
    adjustStatFontSizes();
  });

  $effect(() => {
    const onResize = () => adjustStatFontSizes();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<section class="top-panel" aria-label="Workout stats" bind:this={panelEl}>
  <div class="stat-card" data-key="power">
    <div class="stat-label">Power</div>
    <div class="stat-value">
      <span id="stat-power" data-testid="stat-power" style="color: {color}">{powerText(vm)}</span>
    </div>
  </div>
  <div class="stat-card" data-key="intervalTime">
    <div class="stat-label">Interval Time</div>
    <div class="stat-value stat-lg">
      <span id="stat-interval-time" data-testid="stat-interval-time" style="color: {color}"
        >{formatTimeMMSS(vm.intervalElapsedSec || 0)}</span
      >
    </div>
  </div>
  <div class="stat-card" data-key="heartRate">
    <div class="stat-label">Heart Rate</div>
    <div class="stat-value">
      <span id="stat-hr" data-testid="stat-hr" style="color: {color}">{hrText(vm)}</span>
    </div>
  </div>
  <div class="stat-card" data-key="targetPower">
    <div class="stat-label">Target Power</div>
    <div class="stat-value">
      <span id="stat-target-power" data-testid="stat-target-power" style="color: {color}"
        >{targetPowerText(vm)}</span
      >
    </div>
  </div>
  <div class="stat-card" data-key="elapsedTime">
    <div class="stat-label">Workout Time</div>
    <div class="stat-value stat-lg">
      <span id="stat-elapsed-time" data-testid="stat-elapsed-time" style="color: {color}"
        >{formatTimeHHMMSS(vm.elapsedSec || 0)}</span
      >
    </div>
  </div>
  <div class="stat-card" data-key="cadence">
    <div class="stat-label">Cadence</div>
    <div class="stat-value">
      <span id="stat-cadence" data-testid="stat-cadence" style="color: {color}">{cadenceText(vm)}</span>
      <span
        id="stat-cadence-indicator"
        data-testid="stat-cadence-indicator"
        class="stat-cadence-indicator"
        style="color: {color}"
        class:stat-cadence-indicator--visible={!!indicator}>{indicator}</span
      >
    </div>
  </div>
</section>
