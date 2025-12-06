// welcome.js
// First-run welcome / tour overlay for VeloDrive.

const SLIDES = [
  {
    id: "splash",
    kind: "splash", // logo + text only
    title: "Welcome to VeloDrive",
    bodyLines: [
      "Indoor bike workouts that run directly in your browser.",
      "Tap or press \u2192 to continue.",
    ],
  },
  {
    id: "trainers",
    kind: "scene",
    title: "Ride structured workouts on your smart trainer",
    bodyLines: [
      "Control Bluetooth-FTMS trainers like Wahoo KICKR, Tacx Neo.",
      "See live power, heart rate, cadence, and time.",
    ],
  },
  {
    id: "offline",
    kind: "scene",
    title: "Local data. Offline workouts.",
    bodyLines: [
      "Install VeloDrive as a Progressive Web App so it runs like a native application.",
      "Workouts and history are stored on your filesystem, so you can ride with no internet connection.",
    ],
  },
  {
    id: "workouts",
    kind: "scene",
    title: "Use community workouts or build your own",
    bodyLines: [
      "Import workouts from TrainerRoad, TrainerDay, and Zwift collections.",
      "Export them as .zwo or .fit files, or build your own sessions from scratch.",
    ],
  },
];

function createSvgEl(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

const SCENE_LAYOUTS = {
  splash: {
    baseWidth: 360,
    baseHeight: 360,
    orb: null,
    pathD: null,
    pills: [],
    pulses: [],
    steady: "none",
    enter: "grow",
    exit: "fade",
    assets: [
      {href: "icons/logo_sq.svg", width: 196, height: 196, delay: 80, center: true},
    ],
  },
  trainers: {
    baseWidth: 360,
    baseHeight: 360,
    orb: {cx: 180, cy: 150, r: 110},
    pathD: "M60 140 C 130 110, 230 190, 300 140",
    pills: [
      {x: 250, y: 188, width: 80, height: 26},
      {x: 70, y: 182, width: 88, height: 30},
    ],
    pulses: [
      {d: "M70 230 C 150 200, 220 250, 300 210"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/wahoo.svg", x: 40, y: 150, width: 124, height: 42, delay: 80},
      {href: "img/tacx.svg", x: 240, y: 100, width: 118, height: 40, delay: 140},
      {href: "img/smart_frame.svg", x: 140, y: 110, width: 136, height: 108, delay: 220},
    ],
  },
  offline: {
    baseWidth: 360,
    baseHeight: 360,
    orb: {cx: 190, cy: 170, r: 108},
    pathD: "M60 180 C 140 140, 220 210, 320 160",
    pills: [
      {x: 86, y: 110, width: 78, height: 26},
      {x: 230, y: 210, width: 104, height: 30},
    ],
    pulses: [
      {d: "M80 240 C 160 210, 230 240, 310 220"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/smart_frame.svg", x: 120, y: 120, width: 150, height: 120, delay: 60},
      {href: "img/wahoo.svg", x: 50, y: 200, width: 130, height: 44, delay: 140},
      {href: "img/tacx.svg", x: 230, y: 70, width: 122, height: 40, delay: 220},
    ],
  },
  workouts: {
    baseWidth: 360,
    baseHeight: 360,
    orb: {cx: 180, cy: 160, r: 110},
    pathD: "M70 140 C 140 100, 240 170, 310 130",
    pills: [
      {x: 80, y: 200, width: 96, height: 32},
      {x: 230, y: 190, width: 96, height: 28},
    ],
    pulses: [
      {d: "M80 230 C 170 200, 230 250, 310 210"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/smart_frame.svg", x: 140, y: 110, width: 150, height: 120, delay: 60},
      {href: "img/wahoo.svg", x: 40, y: 170, width: 132, height: 44, delay: 140},
      {href: "img/tacx.svg", x: 230, y: 70, width: 124, height: 42, delay: 220},
    ],
  },
};

function createSceneFromLayout(layout) {
  const VIEWBOX_SIZE = 360;
  const svg = createSvgEl("svg");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "presentation");
  svg.classList.add("welcome-scene-root");
  const enterType = layout.enter || "fly";
  const steadyType = layout.steady || "float";
  const exitType = layout.exit || "rise";
  svg.classList.add(
    `scene-enter-${enterType}`,
    `scene-steady-${steadyType}`,
    `scene-exit-${exitType}`
  );

  const baseWidth = layout.baseWidth || VIEWBOX_SIZE;
  const baseHeight = layout.baseHeight || VIEWBOX_SIZE;
  const offsetX = Math.max(0, (VIEWBOX_SIZE - baseWidth) / 2);
  const offsetY = Math.max(0, (VIEWBOX_SIZE - baseHeight) / 2);
  const contentGroup = createSvgEl("g");
  contentGroup.setAttribute("transform", `translate(${offsetX} ${offsetY})`);

  let maxDelay = 0;

  const addDelay = (el, delay) => {
    el.classList.add("scene-piece");
    el.style.setProperty("--delay", `${delay || 0}ms`);
    if (delay && delay > maxDelay) {
      maxDelay = delay;
    }
  };

  const applyFlyOffset = (el, origin) => {
    if (enterType !== "fly") return;
    const cx = VIEWBOX_SIZE / 2;
    const cy = VIEWBOX_SIZE / 2;
    const tx = origin?.x ?? cx;
    const ty = origin?.y ?? cy;
    const dx = tx < cx ? -48 : tx > cx ? 48 : 0;
    const dy = ty < cy ? -48 : ty > cy ? 48 : 0;
    el.style.setProperty("--fly-x", `${dx}px`);
    el.style.setProperty("--fly-y", `${dy}px`);
  };

  if (layout.orb) {
    const orb = createSvgEl("circle");
    orb.setAttribute("cx", layout.orb.cx);
    orb.setAttribute("cy", layout.orb.cy);
    orb.setAttribute("r", layout.orb.r);
    orb.classList.add("scene-orb");
    addDelay(orb, 20);
    applyFlyOffset(orb, layout.orb);
    contentGroup.appendChild(orb);
  }

  if (layout.pathD) {
    const path = createSvgEl("path");
    path.setAttribute("d", layout.pathD);
    path.classList.add("scene-path");
    addDelay(path, 80);
    applyFlyOffset(path, {x: VIEWBOX_SIZE / 2, y: VIEWBOX_SIZE / 2});
    contentGroup.appendChild(path);
  }

  if (Array.isArray(layout.pills)) {
    layout.pills.forEach((pill, idx) => {
      const rect = createSvgEl("rect");
      rect.setAttribute("x", pill.x);
      rect.setAttribute("y", pill.y);
      rect.setAttribute("width", pill.width);
      rect.setAttribute("height", pill.height);
      rect.setAttribute("rx", 12);
      rect.classList.add("scene-pill");
      addDelay(rect, 120 + idx * 40);
      applyFlyOffset(rect, {x: pill.x + pill.width / 2, y: pill.y + pill.height / 2});
      contentGroup.appendChild(rect);
    });
  }

  if (Array.isArray(layout.pulses)) {
    layout.pulses.forEach((pulse, idx) => {
      const path = createSvgEl("path");
      path.setAttribute("d", pulse.d);
      path.classList.add("scene-pulse");
      addDelay(path, 160 + idx * 60);
      applyFlyOffset(path, {x: VIEWBOX_SIZE / 2, y: VIEWBOX_SIZE / 2});
      contentGroup.appendChild(path);
    });
  }

  if (Array.isArray(layout.assets)) {
    layout.assets.forEach((asset, idx) => {
      const g = createSvgEl("g");
      addDelay(g, asset.delay || idx * 80);

      const image = createSvgEl("image");
      image.setAttribute("width", asset.width);
      image.setAttribute("height", asset.height);
      image.setAttribute("href", asset.href);
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      if (asset.center) {
        const cx = VIEWBOX_SIZE / 2 - (asset.width || 0) / 2;
        const cy = VIEWBOX_SIZE / 2 - (asset.height || 0) / 2;
        image.setAttribute("x", cx);
        image.setAttribute("y", cy);
        applyFlyOffset(g, {x: cx + (asset.width || 0) / 2, y: cy + (asset.height || 0) / 2});
      } else {
        image.setAttribute("x", asset.x);
        image.setAttribute("y", asset.y);
        applyFlyOffset(g, {x: asset.x + asset.width / 2, y: asset.y + asset.height / 2});
      }
      g.appendChild(image);

      contentGroup.appendChild(g);
    });
  }

  svg.appendChild(contentGroup);

  return {root: svg, maxDelay};
}

function createSceneManager(rootEl) {
  const ENTER_MS = 900;
  let activeScene = null;
  let enterTimer = null;

  function showScene(slideId) {
    if (!rootEl) return;
    if (enterTimer) {
      clearTimeout(enterTimer);
      enterTimer = null;
    }
    const layout = SCENE_LAYOUTS[slideId] || SCENE_LAYOUTS.splash;
    const next = createSceneFromLayout(layout);
    if (!next || !next.root) return;
    const enterStateClass = "welcome-scene--enter";
    const steadyStateClass = "welcome-scene--steady";

    const prev = activeScene;
    activeScene = next;

    const startEnter = () => {
      rootEl.appendChild(next.root);
      requestAnimationFrame(() => {
        next.root.classList.add(enterStateClass);
        const settleMs = ENTER_MS + (next.maxDelay || 0) + 30;
        setTimeout(() => {
          next.root.classList.remove(enterStateClass);
          next.root.classList.add(steadyStateClass);
        }, settleMs);
      });
    };

    if (prev && prev.root) {
      prev.root.classList.remove(enterStateClass, steadyStateClass);
      if (prev.root.parentNode === rootEl) {
        rootEl.removeChild(prev.root);
      }
      if (typeof prev.cleanup === "function") {
        prev.cleanup();
      }
      startEnter();
    } else {
      startEnter();
    }
  }

  return {
    showScene,
  };
}

export function initWelcomeTour(options = {}) {
  const {onFinished, onVisibilityChanged} = options;

  const overlay = document.getElementById("welcomeOverlay");
  const titleEl = document.getElementById("welcomeTitle");
  const bodyEl = document.getElementById("welcomeBody");
  const sceneEl = document.getElementById("welcomeScene");

  const prevBtn = document.getElementById("welcomePrevBtn");
  const nextBtn = document.getElementById("welcomeNextBtn");
  const closeBtn = document.getElementById("welcomeCloseBtn");
  const slideContainer = overlay
    ? overlay.querySelector(".welcome-slide")
    : null;

  if (
    !overlay ||
    !titleEl ||
    !bodyEl ||
    !sceneEl ||
    !slideContainer
  ) {
    console.warn("[Welcome] Required DOM elements not found; tour disabled.");
    return {
      open() {},
      close() {},
      goToSlide() {},
      playSplash() {},
    };
  }

  let currentIndex = 0;
  let isOpen = false;
  let isAnimating = false;
  let currentMode = "full"; // "full" | "splash"
  let autoCloseTimer = null;
  let splashTextTimer = null;
  let firstRenderDone = false;
  const sceneManager = createSceneManager(sceneEl);

  const visibilityCb =
    typeof onVisibilityChanged === "function" ? onVisibilityChanged : null;

  function notifyVisibility(isVisible) {
    if (visibilityCb) {
      visibilityCb({isOpen: isVisible, mode: currentMode});
    }
  }

  function clearAutoClose() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  function setOverlayMode(mode) {
    currentMode = mode === "splash" ? "splash" : "full";
    overlay.classList.toggle(
      "welcome-overlay--splash-only",
      currentMode === "splash"
    );
  }

  function computeBodyHtml(lines) {
    if (!lines || !lines.length) return "";
    return lines
      .map((line) => `<span class="welcome-body-line">${line}</span>`)
      .join("<br>");
  }

  function applySlideClasses(slide) {
    slideContainer.classList.toggle("welcome-slide--splash", slide.kind === "splash");
    slideContainer.classList.toggle(
      "welcome-slide--icon-only",
      slide.kind === "splash"
    );
  }

  function renderSlide(index) {
    const slide = SLIDES[index];
    if (!slide) return;

    currentIndex = index;

    titleEl.textContent = slide.title;

    bodyEl.innerHTML = computeBodyHtml(slide.bodyLines);

    applySlideClasses(slide);
    if (sceneManager) {
      sceneManager.showScene(slide.id);
    }

    if (splashTextTimer) {
      clearTimeout(splashTextTimer);
      splashTextTimer = null;
    }

    if (slide.id === "splash" && !firstRenderDone) {
      slideContainer.classList.remove("welcome-text-visible");
      slideContainer.classList.add("welcome-text-hidden");
      const navEls = [prevBtn, nextBtn, closeBtn].filter(Boolean);
      navEls.forEach((el) => el.classList.add("welcome-nav-hidden"));
      splashTextTimer = setTimeout(() => {
        slideContainer.classList.remove("welcome-text-hidden");
        slideContainer.classList.add("welcome-text-visible");
        navEls.forEach((el) => el.classList.remove("welcome-nav-hidden"));
      }, 1000);
    } else {
      slideContainer.classList.remove("welcome-text-hidden", "welcome-text-visible");
      [prevBtn, nextBtn, closeBtn].filter(Boolean).forEach((el) => {
        el.classList.remove("welcome-nav-hidden");
      });
    }

    if (prevBtn) {
      prevBtn.style.visibility = index === 0 ? "hidden" : "visible";
    }
    if (nextBtn) {
      nextBtn.style.visibility = "visible";
    }

    firstRenderDone = true;
  }

  function animateSlideChange(targetIndex, direction) {
    if (!slideContainer || targetIndex === currentIndex || isAnimating) {
      renderSlide(targetIndex);
      return;
    }

    isAnimating = true;
    const goingPrev = direction === "prev";
    const outClass = goingPrev
      ? "welcome-slide--animating-out-backward"
      : "welcome-slide--animating-out-forward";
    const inClass = goingPrev
      ? "welcome-slide--animating-in-backward"
      : "welcome-slide--animating-in-forward";

    // Animate out current slide first
    slideContainer.classList.remove(inClass, "welcome-slide--active");
    slideContainer.classList.add(outClass);

    const finishIn = () => {
      slideContainer.classList.remove(inClass, "welcome-slide--active");
      slideContainer.style.transform = "";
      slideContainer.style.opacity = "";
      isAnimating = false;
    };

    const startIn = () => {
      renderSlide(targetIndex);
      slideContainer.classList.remove(outClass, inClass, "welcome-slide--active");

      slideContainer.style.transition = "none";
      slideContainer.style.transform = goingPrev ? "translateX(-8%)" : "translateX(8%)";
      slideContainer.style.opacity = "0.1";
      // force reflow
      // eslint-disable-next-line no-unused-expressions
      slideContainer.offsetWidth;
      slideContainer.style.transition = "";
      slideContainer.classList.add(inClass);

      requestAnimationFrame(() => {
        slideContainer.classList.add("welcome-slide--active");
        slideContainer.style.transform = "translateX(0)";
        slideContainer.style.opacity = "1";
        const handleInEnd = (evt) => {
          if (evt && evt.target !== slideContainer) return;
          slideContainer.removeEventListener("transitionend", handleInEnd);
          finishIn();
        };
        slideContainer.addEventListener("transitionend", handleInEnd);
        setTimeout(finishIn, 330);
      });
    };

    const handleOutEnd = (evt) => {
      if (evt && evt.target !== slideContainer) return;
      slideContainer.removeEventListener("transitionend", handleOutEnd);
      startIn();
    };

    slideContainer.addEventListener("transitionend", handleOutEnd);
    setTimeout(handleOutEnd, 330);
  }

  function closeOverlay() {
    if (!isOpen) return;
    clearAutoClose();
    isOpen = false;
    const wasSplash = currentMode === "splash";
    overlay.classList.add("welcome-overlay--hiding");
    document.body.classList.remove("welcome-active");
    overlay.classList.remove("welcome-overlay--visible");

    let done = false;
    const finalize = () => {
      if (done) return;
      done = true;
      overlay.removeEventListener("transitionend", finalize);
      overlay.style.display = "none";
      overlay.classList.remove(
        "welcome-overlay--visible",
        "welcome-overlay--hiding"
      );
      if (!wasSplash) {
        overlay.classList.remove("welcome-overlay--splash-only");
      }
      notifyVisibility(false);
      if (typeof onFinished === "function") {
        onFinished();
      }
    };

    // Keep splash-only visuals until fully hidden to avoid caret flashing in splash mode.

    overlay.addEventListener("transitionend", finalize);
    window.setTimeout(finalize, 1000); // fallback if transitionend doesn’t fire
  }

  function openOverlay(startIndex = 0, opts = {}) {
    if (isOpen) return;
    clearAutoClose();
    const {mode = "full", autoCloseMs = null} =
      opts && typeof opts === "object" ? opts : {};
    setOverlayMode(mode);
    isOpen = true;

    if (startIndex < 0 || startIndex >= SLIDES.length) {
      startIndex = 0;
    }

    renderSlide(startIndex);

    overlay.style.display = "flex";
    overlay.classList.remove("welcome-overlay--hiding");

    notifyVisibility(true);

    requestAnimationFrame(() => {
      overlay.classList.add("welcome-overlay--visible");
    });

    if (autoCloseMs) {
      autoCloseTimer = window.setTimeout(() => {
        closeOverlay();
      }, autoCloseMs);
    }
  }

  function goToNext() {
    if (currentMode === "splash") return;
    if (currentIndex >= SLIDES.length - 1) {
      closeOverlay();
      return;
    }
    const nextIndex = currentIndex + 1;
    animateSlideChange(nextIndex, "next");
  }

  function goToPrev() {
    if (currentMode === "splash") return;
    if (currentIndex <= 0) return;
    const prevIndex = currentIndex - 1;
    animateSlideChange(prevIndex, "prev");
  }

  function handleOverlayClick(event) {
    if (!isOpen) return;
    if (currentMode === "splash") {
      event.stopPropagation();
      return;
    }

    const target = event.target;

    // Ignore clicks on controls
    if (
      target.closest(".welcome-nav") ||
      target.closest(".welcome-close-btn")
    ) {
      return;
    }

    goToNext();
  }

  function handleKeydown(event) {
    if (!isOpen) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.stopPropagation();
    event.stopImmediatePropagation();

    const {key} = event;

    if (currentMode === "splash") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (key === "Escape") {
        closeOverlay();
      }
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeOverlay();
    } else if (key === "ArrowRight" || key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      goToNext();
    } else if (key === "ArrowLeft" || key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      goToPrev();
    } else if (key === " " || key === "Enter") {
      const active = document.activeElement;
      if (active === overlay || active === document.body) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        goToNext();
      }
    }
  }

  overlay.addEventListener("click", handleOverlayClick);

  if (prevBtn) {
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      goToPrev();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      goToNext();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverlay();
    });
  }

  document.addEventListener("keydown", handleKeydown);

  return {
    open: openOverlay,
    close: closeOverlay,
    playSplash(durationMs = 2000) {
      openOverlay(0, {mode: "splash", autoCloseMs: durationMs});
    },
    goToSlide(index) {
      if (index < 0 || index >= SLIDES.length) return;
      if (!isOpen) {
        openOverlay(index);
      } else {
        const dir = index > currentIndex ? "next" : "prev";
        animateSlideChange(index, dir);
      }
    },
  };
}
