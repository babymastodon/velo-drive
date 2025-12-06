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
    orb: null,
    pathD: null,
    pills: [],
    pulses: [],
    steady: "none",
    enter: "grow",
    exit: "fade",
    assets: [
      {href: "icons/logo_sq.svg", x: 120, y: 46, width: 180, height: 180, delay: 80},
    ],
  },
  trainers: {
    orb: {cx: 198, cy: 110, r: 112},
    pathD: "M64 92 C 140 76, 224 132, 322 94",
    pills: [
      {x: 260, y: 146, width: 78, height: 26},
      {x: 70, y: 144, width: 88, height: 30},
    ],
    pulses: [
      {d: "M70 196 C 148 168, 224 226, 322 184"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/wahoo.svg", x: 38, y: 120, width: 124, height: 42, delay: 80},
      {href: "img/tacx.svg", x: 254, y: 74, width: 118, height: 40, delay: 140},
      {href: "img/smart_frame.svg", x: 150, y: 92, width: 136, height: 108, delay: 220},
    ],
  },
  offline: {
    orb: {cx: 220, cy: 126, r: 108},
    pathD: "M58 142 C 140 108, 214 170, 332 124",
    pills: [
      {x: 86, y: 74, width: 78, height: 26},
      {x: 252, y: 166, width: 104, height: 30},
    ],
    pulses: [
      {d: "M84 204 C 156 180, 216 214, 310 194"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/smart_frame.svg", x: 104, y: 76, width: 150, height: 120, delay: 60},
      {href: "img/wahoo.svg", x: 46, y: 156, width: 130, height: 44, delay: 140},
      {href: "img/tacx.svg", x: 252, y: 48, width: 122, height: 40, delay: 220},
    ],
  },
  workouts: {
    orb: {cx: 196, cy: 118, r: 110},
    pathD: "M70 96 C 132 72, 240 126, 316 94",
    pills: [
      {x: 74, y: 154, width: 96, height: 32},
      {x: 244, y: 142, width: 96, height: 28},
    ],
    pulses: [
      {d: "M84 202 C 166 172, 222 226, 312 186"},
    ],
    enter: "fly",
    exit: "rise",
    assets: [
      {href: "img/smart_frame.svg", x: 140, y: 80, width: 150, height: 120, delay: 60},
      {href: "img/wahoo.svg", x: 34, y: 124, width: 132, height: 44, delay: 140},
      {href: "img/tacx.svg", x: 252, y: 38, width: 124, height: 42, delay: 220},
    ],
  },
};

function createSceneFromLayout(layout) {
  const svg = createSvgEl("svg");
  svg.setAttribute("viewBox", "0 0 420 240");
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

  const addDelay = (el, delay) => {
    el.classList.add("scene-piece");
    el.style.setProperty("--delay", `${delay || 0}ms`);
  };

  if (layout.orb) {
    const orb = createSvgEl("circle");
    orb.setAttribute("cx", layout.orb.cx);
    orb.setAttribute("cy", layout.orb.cy);
    orb.setAttribute("r", layout.orb.r);
    orb.classList.add("scene-orb");
    addDelay(orb, 20);
    svg.appendChild(orb);
  }

  if (layout.pathD) {
    const path = createSvgEl("path");
    path.setAttribute("d", layout.pathD);
    path.classList.add("scene-path");
    addDelay(path, 80);
    svg.appendChild(path);
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
      svg.appendChild(rect);
    });
  }

  if (Array.isArray(layout.pulses)) {
    layout.pulses.forEach((pulse, idx) => {
      const path = createSvgEl("path");
      path.setAttribute("d", pulse.d);
      path.classList.add("scene-pulse");
      addDelay(path, 160 + idx * 60);
      svg.appendChild(path);
    });
  }

  if (Array.isArray(layout.assets)) {
    layout.assets.forEach((asset, idx) => {
      const g = createSvgEl("g");
      addDelay(g, asset.delay || idx * 80);

      const image = createSvgEl("image");
      image.setAttribute("x", asset.x);
      image.setAttribute("y", asset.y);
      image.setAttribute("width", asset.width);
      image.setAttribute("height", asset.height);
      image.setAttribute("href", asset.href);
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      g.appendChild(image);

      svg.appendChild(g);
    });
  }

  return {root: svg};
}

function createSceneManager(rootEl) {
  const ENTER_MS = 900;
  const EXIT_MS = 800;
  let activeScene = null;

  function showScene(slideId) {
    if (!rootEl) return;
    const layout = SCENE_LAYOUTS[slideId] || SCENE_LAYOUTS.splash;
    const next = createSceneFromLayout(layout);
    if (!next || !next.root) return;
    const enterStateClass = "welcome-scene--enter";
    const steadyStateClass = "welcome-scene--steady";
    const exitStateClass = "welcome-scene--exit";

    const prev = activeScene;
    activeScene = next;

    rootEl.appendChild(next.root);

    requestAnimationFrame(() => {
      next.root.classList.add(enterStateClass);
      setTimeout(() => {
        next.root.classList.remove(enterStateClass);
        next.root.classList.add(steadyStateClass);
      }, ENTER_MS);
    });

    if (prev && prev.root) {
      prev.root.classList.remove(enterStateClass, steadyStateClass);
      prev.root.classList.add(exitStateClass);
      setTimeout(() => {
        if (prev.root.parentNode === rootEl) {
          rootEl.removeChild(prev.root);
        }
        if (typeof prev.cleanup === "function") {
          prev.cleanup();
        }
      }, EXIT_MS);
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

    if (prevBtn) {
      prevBtn.style.visibility = index === 0 ? "hidden" : "visible";
    }
    if (nextBtn) {
      nextBtn.style.visibility = "visible";
    }
  }

  function animateSlideChange(targetIndex, direction) {
    if (!slideContainer || targetIndex === currentIndex || isAnimating) {
      renderSlide(targetIndex);
      return;
    }

    isAnimating = true;

    const outDir = direction === "prev" ? 1 : -1;
    const inDir = -outDir;

    slideContainer.classList.add("welcome-slide--animating");
    slideContainer.style.transform = `translateX(${outDir * 14}px)`;
    slideContainer.style.opacity = "0";

    const handleOutEnd = () => {
      slideContainer.removeEventListener("transitionend", handleOutEnd);

      renderSlide(targetIndex);
      slideContainer.style.transition = "none";
      slideContainer.style.transform = `translateX(${inDir * 14}px)`;
      slideContainer.style.opacity = "0";

      // Force reflow
      // eslint-disable-next-line no-unused-expressions
      slideContainer.offsetWidth;

      slideContainer.style.transition = "";
      slideContainer.style.transform = "translateX(0)";
      slideContainer.style.opacity = "1";

      const handleInEnd = () => {
        slideContainer.removeEventListener("transitionend", handleInEnd);
        slideContainer.classList.remove("welcome-slide--animating");
        isAnimating = false;
      };

      slideContainer.addEventListener("transitionend", handleInEnd);
    };

    slideContainer.addEventListener("transitionend", handleOutEnd);
  }

  function closeOverlay() {
    if (!isOpen) return;
    clearAutoClose();
    isOpen = false;
    const wasSplash = currentMode === "splash";
    overlay.classList.add("welcome-overlay--hiding");
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
    window.setTimeout(finalize, 260); // fallback if transitionend doesn’t fire
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

  // Initial render (hidden until open())
  renderSlide(0);

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
