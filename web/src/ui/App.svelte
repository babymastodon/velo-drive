<script lang="ts">
  // App shell — boots the composition root and mounts the riding (HUD) view.
  // Reproduces the legacy riding-view DOM/classes so the re-hosted global CSS
  // applies unchanged.
  import { bootApp, type AppContext } from '../app/app.js';
  import HudView from './HudView.svelte';

  let ctx = $state<AppContext | null>(null);

  $effect(() => {
    let cancelled = false;
    bootApp()
      .then((c) => {
        if (!cancelled) ctx = c;
      })
      .catch((err) => {
        console.error('[App] boot failed:', err);
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if ctx}
  <HudView store={ctx.store} engine={ctx.engine} transport={ctx.transport} />
{/if}
