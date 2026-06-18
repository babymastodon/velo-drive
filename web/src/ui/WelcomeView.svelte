<script lang="ts">
  // WelcomeView — re-host of the legacy #welcomeOverlay first-run tour
  // (docs/index.html ~59-114 + docs/welcome.js). Same classes/IDs so the
  // re-hosted welcome.css applies unchanged. 4 slides + prev/next/close. The new
  // app does NOT show welcome on boot (the ui-store starts at 'none'); the
  // harness opens it for the visual test via ui.openWelcome().
  import { onMount, tick } from 'svelte';
  import type { UiStore } from '../state/ui.svelte.js';
  import { createScene } from './welcome-scene.js';

  let { ui, open = false }: { ui: UiStore; open?: boolean } = $props();

  interface Slide {
    id: string;
    kind: 'splash' | 'scene';
    title: string;
    bodyLines: string[];
  }

  const SLIDES: Slide[] = [
    {
      id: 'splash',
      kind: 'splash',
      title: 'Welcome to VeloDrive',
      bodyLines: [
        'Indoor bike workouts that run directly in your browser.',
        'Tap or press → to continue.',
      ],
    },
    {
      id: 'trainers',
      kind: 'scene',
      title: 'Ride structured workouts on your smart trainer',
      bodyLines: [
        'Control Bluetooth-FTMS trainers like Wahoo KICKR, Tacx Neo.',
        'See live power, heart rate, cadence, and time.',
      ],
    },
    {
      id: 'offline',
      kind: 'scene',
      title: 'Local data. Offline workouts.',
      bodyLines: [
        'Install VeloDrive as a Progressive Web App so it runs like a native application.',
        'Workouts and history are stored on your filesystem, so you can ride with no internet connection.',
      ],
    },
    {
      id: 'workouts',
      kind: 'scene',
      title: 'Use community workouts or build your own',
      bodyLines: [
        'Import workouts from TrainerRoad, TrainerDay, and Zwift collections.',
        'Export them as .zwo or .fit files, or build your own sessions from scratch.',
      ],
    },
  ];

  const splashMode = $derived(ui.welcomeMode === 'splash');

  let currentIndex = $state(0);
  const slide = $derived(SLIDES[currentIndex]);
  // Splash hides text for 1000ms on first render (legacy behavior).
  let textHidden = $state(false);
  let firstRenderDone = false;

  let sceneEl = $state<HTMLDivElement | null>(null);
  let activeScene: SVGElement | null = null;

  async function renderScene(slideId: string): Promise<void> {
    if (!sceneEl) return;
    const { root, ready } = createScene(slideId);
    const prev = activeScene;
    activeScene = root;
    if (prev && prev.parentNode === sceneEl) sceneEl.removeChild(prev);
    sceneEl.appendChild(root);
    // Steady state (animations disabled in the harness): mark steady immediately.
    root.classList.add('welcome-scene--steady');
    await ready.catch(() => {});
  }

  function applyTextReveal(s: Slide): void {
    if (splashMode) return;
    if (s.id === 'splash' && !firstRenderDone) {
      textHidden = true;
      // Reveal after 1s (the shim swaps setTimeout for the virtual clock).
      setTimeout(() => {
        textHidden = false;
      }, 1000);
    } else {
      textHidden = false;
    }
    firstRenderDone = true;
  }

  async function goToIndex(i: number): Promise<void> {
    currentIndex = i;
    applyTextReveal(SLIDES[i]);
    await tick();
    await renderScene(SLIDES[i].id);
  }

  function goNext(): void {
    if (splashMode) return;
    if (currentIndex >= SLIDES.length - 1) {
      ui.close();
      return;
    }
    void goToIndex(currentIndex + 1);
  }
  function goPrev(): void {
    if (splashMode) return;
    if (currentIndex <= 0) return;
    void goToIndex(currentIndex - 1);
  }
  function close(): void {
    ui.close();
  }

  function bodyHtml(lines: string[]): string {
    return lines.map((l) => `<span class="welcome-body-line">${l}</span>`).join('<br>');
  }

  // (Re)initialise when opened, starting from ui.welcomeStartIndex if set.
  let lastOpen = false;
  $effect(() => {
    if (open && !lastOpen) {
      firstRenderDone = false;
      void goToIndex(ui.welcomeStartIndex ?? 0);
    }
    lastOpen = open;
  });

  onMount(() => {
    if (open) void goToIndex(ui.welcomeStartIndex ?? 0);
  });

  function onOverlayClick(e: MouseEvent): void {
    if (splashMode) {
      e.stopPropagation();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest('.welcome-nav') || t.closest('.welcome-close-btn')) return;
    goNext();
  }
</script>

{#if open}
  <div
    id="welcomeOverlay"
    class="welcome-overlay welcome-overlay--visible"
    class:welcome-overlay--splash-only={splashMode}
    aria-modal="true"
    role="dialog"
    aria-label="Welcome intro"
    data-testid="welcome-overlay"
    onclick={onOverlayClick}
  >
    <div class="welcome-shell">
      <button
        id="welcomeCloseBtn"
        class="welcome-close-btn"
        type="button"
        aria-label="Skip intro"
        data-testid="welcome-close"
        onclick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        ×
      </button>

      <div
        class="welcome-slide"
        class:welcome-slide--splash={slide.kind === 'splash'}
        class:welcome-slide--icon-only={slide.kind === 'splash'}
        class:welcome-text-hidden={textHidden}
        class:welcome-text-visible={!textHidden && slide.id === 'splash'}
      >
        <header class="welcome-header">
          <h1 id="welcomeTitle" class="welcome-title" data-testid="welcome-title">{slide.title}</h1>
        </header>

        <main class="welcome-main">
          <div class="welcome-scene-wrapper">
            <div id="welcomeScene" class="welcome-scene" aria-hidden="true" bind:this={sceneEl}></div>
          </div>
        </main>

        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <p id="welcomeBody" class="welcome-body" data-testid="welcome-body">{@html bodyHtml(slide.bodyLines)}</p>
      </div>

      <button
        id="welcomePrevBtn"
        class="welcome-nav welcome-nav-prev"
        type="button"
        aria-label="Previous"
        data-testid="welcome-prev"
        style="visibility: {currentIndex === 0 ? 'hidden' : 'visible'}"
        onclick={(e) => {
          e.stopPropagation();
          goPrev();
        }}
      >
        <span>❮</span>
      </button>

      <button
        id="welcomeNextBtn"
        class="welcome-nav welcome-nav-next"
        type="button"
        aria-label="Next"
        data-testid="welcome-next"
        onclick={(e) => {
          e.stopPropagation();
          goNext();
        }}
      >
        <span>❯</span>
      </button>
    </div>
  </div>
{/if}
