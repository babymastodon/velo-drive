<script lang="ts">
  // StatusOverlay — the big centered "3 / 2 / 1 / Start", "Workout Paused",
  // "Workout Resumed" message layer (legacy docs/index.html:1291 +
  // docs/beeper.js showStatusMessage/showPausedOverlay/runStartCountdown).
  //
  // The Beeper still owns the message text + show/hide timing (it reads
  // #statusOverlay/#statusText by id, exactly like legacy), so this component is
  // purely the re-hosted DOM the Beeper drives. It renders hidden (the
  // .status-overlay CSS sets display:none + opacity:0), so when idle it
  // contributes nothing to the HUD render — the idle visual diff stays 0.
</script>

<div id="statusOverlay" data-testid="status-overlay" class="status-overlay">
  <div id="statusText" data-testid="status-text"></div>
</div>
