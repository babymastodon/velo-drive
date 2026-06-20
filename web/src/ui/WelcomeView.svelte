<script lang="ts">
  // WelcomeView — re-host of the legacy #welcomeOverlay first-run tour
  // (docs/index.html ~59-114 + docs/welcome.js). Same classes/IDs so the
  // re-hosted welcome.css applies unchanged. 4 slides + prev/next/close. The new
  // app does NOT show welcome on boot (the ui-store starts at 'none'); the
  // harness opens it for the visual test via ui.openWelcome().
  import { onMount, tick } from 'svelte';
  import type { UiStore } from '../state/ui.svelte.js';
  import { createScene } from './welcome-scene.js';
  import type { OverlayKeyHandler } from '../state/ui.svelte.js';

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
  // During that same first-render window the nav arrows + close button stay
  // hidden, then fade in — the legacy splash "boot reveal" (docs/welcome.js
  // 514-528 hid prev/next/close for 1000ms). The prev arrow stays hidden beyond
  // it because the splash is the first slide (nothing to go back to).
  const splashBooting = $derived(slide.id === 'splash' && textHidden);

  let sceneEl = $state<HTMLDivElement | null>(null);
  let slideEl = $state<HTMLDivElement | null>(null);
  let activeScene: SVGElement | null = null;
  // Guards the in/out slide transition so rapid next/prev can't interleave.
  let isAnimating = false;

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

  function prefersReducedMotion(): boolean {
    try {
      return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch {
      return false;
    }
  }

  // Skip the slide animation when motion is off. Checks the element's COMPUTED
  // transition-duration rather than relying on matchMedia alone: the e2e harness
  // stubs matchMedia (for theme) and kills transitions via
  // `transition:none!important`, which would otherwise leave the animation
  // awaiting a fallback timer on the harness's virtual clock and never advance.
  // A real reduced-motion user is honored via prefersReducedMotion().
  function animationsDisabled(el: HTMLElement): boolean {
    if (prefersReducedMotion()) return true;
    const dur = getComputedStyle(el).transitionDuration;
    return !dur || parseFloat(dur) === 0;
  }

  // Resolve when the slide's CSS transition ends, or after `ms` as a fallback.
  // (The e2e harness disables transitions, so transitionend never fires there —
  // but reduced-motion also short-circuits the animation before this is reached.)
  function waitSlideTransition(el: HTMLElement, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (e: TransitionEvent): void => {
        if (e.target === el) finish();
      };
      el.addEventListener('transitionend', onEnd);
      setTimeout(finish, ms);
    });
  }

  async function swapContent(i: number): Promise<void> {
    currentIndex = i;
    applyTextReveal(SLIDES[i]);
    await tick();
    await renderScene(SLIDES[i].id);
  }

  // Port of docs/welcome.js animateSlideChange (541-603): slide the current panel
  // out toward the travel direction, swap content at the midpoint, then slide the
  // new panel in from the opposite edge — 330ms each leg, matching the legacy
  // welcome-slide--animating-{out,in}-{forward,backward} CSS. The nav arrows live
  // outside .welcome-slide, so they don't travel with it (legacy parity).
  async function animateSlideChange(target: number, goingPrev: boolean): Promise<void> {
    const el = slideEl;
    if (!el) {
      await swapContent(target);
      return;
    }
    isAnimating = true;
    const outClass = goingPrev
      ? 'welcome-slide--animating-out-backward'
      : 'welcome-slide--animating-out-forward';
    const inClass = goingPrev
      ? 'welcome-slide--animating-in-backward'
      : 'welcome-slide--animating-in-forward';

    // 1. Animate the current slide out.
    el.classList.add('welcome-slide--animating', outClass);
    await waitSlideTransition(el, 330);

    // 2. Swap content at the midpoint (title/body/scene + arrow visibility).
    await swapContent(target);

    // 3. Park the new slide at the opposite edge with transitions off, force a
    //    reflow so that start state applies, then animate it in.
    el.classList.remove(outClass);
    el.style.transition = 'none';
    el.style.transform = goingPrev ? 'translateX(-8%)' : 'translateX(8%)';
    el.style.opacity = '0.1';
    void el.offsetWidth; // force reflow
    el.style.transition = '';
    el.classList.add(inClass);

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    el.classList.add('welcome-slide--active');
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
    await waitSlideTransition(el, 330);

    // 4. Cleanup: drop the animation hooks and inline overrides.
    el.classList.remove(inClass, 'welcome-slide--active', 'welcome-slide--animating');
    el.style.transform = '';
    el.style.opacity = '';
    el.style.transition = '';
    isAnimating = false;
  }

  async function goToIndex(i: number, direction?: 'next' | 'prev'): Promise<void> {
    if (direction && slideEl && i !== currentIndex && !isAnimating && !animationsDisabled(slideEl)) {
      await animateSlideChange(i, direction === 'prev');
    } else {
      await swapContent(i);
    }
  }

  function goNext(): void {
    if (splashMode || isAnimating) return;
    if (currentIndex >= SLIDES.length - 1) {
      ui.close();
      return;
    }
    void goToIndex(currentIndex + 1, 'next');
  }
  function goPrev(): void {
    if (splashMode || isAnimating) return;
    if (currentIndex <= 0) return;
    void goToIndex(currentIndex - 1, 'prev');
  }
  function close(): void {
    ui.close();
  }

  function bodyHtml(lines: string[]): string {
    return lines.map((l) => `<span class="welcome-body-line">${l}</span>`).join('<br>');
  }

  // (Re)initialise when opened, starting from ui.welcomeStartIndex if set.
  let lastOpen = false;
  let splashTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (open && !lastOpen) {
      firstRenderDone = false;
      void goToIndex(ui.welcomeStartIndex ?? 0);
      // Configured-PWA splash auto-dismisses after ~1100ms (legacy
      // playSplash(1100), docs/workout.js:1272-1273; J-WEL-03). The full tour
      // stays open until the user dismisses it.
      if (splashTimer != null) clearTimeout(splashTimer);
      if (splashMode) {
        splashTimer = setTimeout(() => {
          splashTimer = null;
          if (ui.activeOverlay === 'welcome') ui.close();
        }, 1100);
      }
    } else if (!open && lastOpen) {
      if (splashTimer != null) {
        clearTimeout(splashTimer);
        splashTimer = null;
      }
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

  // Welcome keyboard navigation (mirrors docs/welcome.js keydown 718-747).
  // Registered via the App overlay-key router so it runs while welcome is the
  // active overlay (the App suppresses all global hotkeys then). In splash mode,
  // nav keys are swallowed (consumed, no effect) so app shortcuts never leak.
  const handleWelcomeKey: OverlayKeyHandler = (e: KeyboardEvent): boolean => {
    if (e.key === 'Escape') {
      close();
      return true;
    }
    if (splashMode) {
      // Splash swallows nav keys without acting (matches legacy splash bail).
      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp' ||
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'Spacebar'
      ) {
        return true;
      }
      return false;
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      goNext();
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      goPrev();
      return true;
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
      goNext();
      return true;
    }
    return false;
  };

  $effect(() => {
    if (open) {
      ui.registerOverlayKeyHandler('welcome', handleWelcomeKey);
      return () => ui.registerOverlayKeyHandler('welcome', null);
    }
    return undefined;
  });
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
        class:welcome-nav-hidden={splashBooting}
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
        bind:this={slideEl}
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
        class:welcome-nav-hidden={currentIndex === 0 || splashBooting}
        type="button"
        aria-label="Previous"
        data-testid="welcome-prev"
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
        class:welcome-nav-hidden={splashBooting}
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
