<script lang="ts">
  import type { EngineViewModel } from '../core/engine.js';
  import { drawWorkoutChart } from '../core/chart.js';
  import { DEFAULT_FTP } from '../core/metrics.js';

  let {
    vm,
    bikeConnected,
  }: { vm: EngineViewModel; bikeConnected: boolean } = $props();

  let chartSvg = $state<SVGSVGElement | null>(null);
  let chartPanel = $state<HTMLElement | null>(null);

  // Empty-state decision (ported from docs/workout.js drawChart, same priority).
  type EmptyKind = 'noBike' | 'noWorkout' | 'readyToStart' | 'resume' | 'none';
  const emptyKind = $derived.by((): EmptyKind => {
    if (bikeConnected && vm.workoutPaused === true && vm.workoutRunning) return 'resume';
    if (
      bikeConnected &&
      vm.canonicalWorkout &&
      !vm.workoutStarting &&
      !vm.workoutRunning &&
      (vm.elapsedSec || 0) === 0
    )
      return 'readyToStart';
    if (!vm.canonicalWorkout && !vm.workoutRunning) return 'noWorkout';
    if (!bikeConnected) return 'noBike';
    return 'none';
  });

  const emptyMessage = $derived(
    emptyKind === 'noBike'
      ? 'Connect your bike'
      : emptyKind === 'noWorkout'
        ? 'Select a workout'
        : emptyKind === 'readyToStart'
          ? 'Pedal to start workout'
          : emptyKind === 'resume'
            ? 'Pedal to resume'
            : '',
  );
  const arrowDir = $derived(
    emptyKind === 'noBike' ? 'left' : emptyKind === 'resume' ? 'none' : 'right',
  );

  function redraw(): void {
    if (!chartSvg || !chartPanel) return;
    const rect = chartPanel.getBoundingClientRect();
    const width = Math.max(200, rect.width || window.innerWidth || 1000);
    const height = Math.max(200, rect.height || 400);
    drawWorkoutChart({
      svg: chartSvg,
      width,
      height,
      ftp: vm.currentFtp || DEFAULT_FTP,
      rawSegments: vm.canonicalWorkout?.rawSegments || [],
      elapsedSec: vm.elapsedSec,
      liveSamples: vm.liveSamples,
      manualErgTarget: vm.manualErgTarget,
    });
  }

  // Redraw on every VM change and whenever the SVG mounts.
  $effect(() => {
    // touch reactive deps so the effect re-runs
    void vm.elapsedSec;
    void vm.liveSamples;
    void vm.canonicalWorkout;
    void vm.currentFtp;
    if (chartSvg && chartPanel) redraw();
  });
</script>

<section
  id="chartPanel"
  class="chart-panel"
  aria-label="Workout profile and live data"
  bind:this={chartPanel}
>
  <div
    id="chartEmptyOverlay"
    data-testid="chart-empty-overlay"
    class="chart-empty-state"
    style="display: {emptyKind === 'none' ? 'none' : 'flex'}"
  >
    <div id="chartEmptyMessage" class="chart-empty-message">{emptyMessage}</div>
    <svg
      id="chartEmptyArrow"
      class="chart-empty-arrow"
      class:chart-empty-arrow--left={arrowDir === 'left'}
      class:chart-empty-arrow--right={arrowDir === 'right'}
      style="display: {arrowDir === 'none' ? 'none' : ''}"
      viewBox="0 0 52.916665 52.916666"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g>
        <path
          class="chart-empty-arrow-main"
          d="M 51.472993,14.207927 C 46.120999,17.671066 40.269075,17.583209 34.622628,17.157855 29.288422,16.788704 23.874176,16.262741 18.609072,18.089194 14.872863,19.770591 12.035953,24.626821 9.8229085,29.694766 7.5506784,35.257104 6.0236691,40.53837 4.6810022,46.394288"
        />
        <path
          class="chart-empty-arrow-main"
          d="m 2.9466055,41.671853 c 0.066234,0.595617 0.2291127,1.842722 0.2430367,2.548134 0.1721301,1.129681 -0.047682,2.299663 0.8821012,3.521698 1.0543304,-0.189198 1.9004822,-1.093461 2.8846226,-1.547496 0.804207,-0.437777 0.8540386,-0.58115 1.6908182,-0.913426"
        />
      </g>
    </svg>
  </div>

  <svg
    id="chartSvg"
    data-testid="chart-svg"
    viewBox="0 0 1000 400"
    preserveAspectRatio="none"
    bind:this={chartSvg}
  ></svg>
  <div id="chartTooltip" class="chart-tooltip"></div>
</section>
