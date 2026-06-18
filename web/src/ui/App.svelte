<script lang="ts">
  // App shell — boots the composition root, mounts the riding (HUD) view, and
  // hosts the overlay layer (welcome/settings), the dialog host, and the global
  // keymap. Reproduces the legacy riding-view DOM/classes so the re-hosted
  // global CSS applies unchanged.
  import { bootApp, type AppContext } from '../app/app.js';
  import HudView from './HudView.svelte';
  import SettingsView from './SettingsView.svelte';
  import WelcomeView from './WelcomeView.svelte';
  import Dialog from './Dialog.svelte';
  import { UiStore } from '../state/ui.svelte.js';
  import { DialogStore } from '../state/dialog.svelte.js';

  let ctx = $state<AppContext | null>(null);
  const ui = new UiStore();
  const dialogs = new DialogStore();

  // Expose the UI/dialog stores so e2e tests can drive overlays that have no
  // on-screen entry point (e.g. open the welcome tour for its visual diff).
  (window as unknown as { __VELO_APP__: unknown }).__VELO_APP__ = { ui, dialogs };

  const welcomeActive = $derived(ui.activeOverlay === 'welcome');

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

  // Hide the HUD behind the welcome overlay exactly like legacy
  // (`body.welcome-active .page-root/.bottom-nav { visibility:hidden }`).
  $effect(() => {
    document.body.classList.toggle('welcome-active', welcomeActive);
  });

  function isEditable(el: EventTarget | null): boolean {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (ui.handleEscape()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Keys suppressed while typing in a field or while an overlay is open.
    if (isEditable(e.target)) return;
    if (ui.activeOverlay !== 'none') return;

    const key = (e.key || '').toLowerCase();
    if (key === 's') {
      e.preventDefault();
      ui.open('settings');
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if ctx}
  <HudView
    store={ctx.store}
    engine={ctx.engine}
    transport={ctx.transport}
    onOpenSettings={() => ui.open('settings')}
  />

  <SettingsView
    store={ctx.store}
    engine={ctx.engine}
    fileStore={ctx.fileStore}
    beeper={ctx.beeper}
    {ui}
    open={ui.activeOverlay === 'settings'}
  />
{/if}

<WelcomeView {ui} open={welcomeActive} />

<Dialog {dialogs} />
