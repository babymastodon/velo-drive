<script lang="ts">
  // StatusOverlay — the big centered "3 / 2 / 1 / Start", "Workout Paused",
  // "Workout Resumed" message layer.
  //
  // The Beeper owns the message text + show/hide timing (it reads
  // #statusOverlay/#statusText by id), so this component is purely the DOM the
  // Beeper drives. It renders hidden (the .status-overlay CSS sets display:none +
  // opacity:0), so when idle it contributes nothing to the HUD render.
</script>

<div id="statusOverlay" data-testid="status-overlay" class="status-overlay">
  <div id="statusText" data-testid="status-text"></div>
</div>
