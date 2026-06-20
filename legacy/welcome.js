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

const svgGroupCache = new Map();

function loadSvgGroupAsset(src) {
  if (!src) return Promise.resolve(null);
  if (svgGroupCache.has(src)) return svgGroupCache.get(src);

  const promise = fetch(src)
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(`Failed to load SVG: ${resp.status}`);
      }
      return resp.text();
    })
    .then((text) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (!svgEl) throw new Error("SVG root missing");
      const viewBox = svgEl.getAttribute("viewBox") || null;
      const defs = svgEl.querySelector("defs");
      const groups = Array.from(svgEl.children || []).filter(
        (node) => node.tagName && node.tagName.toLowerCase() === "g"
      );

      return {
        viewBox,
        defs: defs ? defs.cloneNode(true) : null,
        groups: groups.map((g) => g.cloneNode(true)),
      };
    })
    .catch((err) => {
      console.warn("[Welcome] Unable to load SVG groups", err);
      return null;
    });

  svgGroupCache.set(src, promise);
  return promise;
}

const SCENE_LAYOUTS = {
  splash: {
    baseWidth: 360,
    baseHeight: 360,
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
    enter: "fly",
    exit: "rise",
    groupAsset: {src: "img/trainer.svg"},
  },
  offline: {
    baseWidth: 360,
    baseHeight: 360,
    enter: "fly",
    exit: "rise",
    groupAsset: {src: "img/browser.svg"},
  },
  workouts: {
    baseWidth: 360,
    baseHeight: 360,
    enter: "fly",
    exit: "rise",
    groupAsset: {src: "img/builder.svg"},
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

  const applyFlyOffset = (el, origin, options = {}) => {
    if (enterType !== "fly") return;
    const cx = VIEWBOX_SIZE / 2;
    const cy = VIEWBOX_SIZE / 2;
    const tx = origin?.x ?? cx;
    const ty = origin?.y ?? cy;
    let dx = tx - cx;
    let dy = ty - cy;

    // Grow more near the center; no growth when far out (25% of view size).
    let len = Math.hypot(dx, dy);
    if (!Number.isFinite(len)) len = 0;
    const growRadius = options.growRadius ?? VIEWBOX_SIZE * 0.25;
    const clamped = Math.min(1, Math.max(0, len / growRadius));
    const startScale = 0.7 + clamped * 0.3;
    el.style.setProperty("--fly-scale", `${startScale}`);

    let offsetX = 0;
    let offsetY = 0;
    const distScale = options.distScale ?? 0.9;
    // Reduce travel when startScale is small so growth and translation balance, and subtract shrink comp per axis.
    offsetX = (dx * distScale);
    offsetY = (dy * distScale);
    el.style.setProperty("--fly-x", `${offsetX}px`);
    el.style.setProperty("--fly-y", `${offsetY}px`);
  };

  const setFloatProps = (el, options = {}) => {
    const amp = options.amp ?? 4 + Math.random() * 6;
    const ms = options.ms ?? 2300 + Math.random() * 1100;
    const driftX = options.driftX ?? 0;
    el.style.setProperty("--float-ms", `${ms}ms`);
    el.style.setProperty("--float-amp", `${amp}px`);
    el.style.setProperty("--float-x", `${driftX}px`);
  };

  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  let destroyed = false;

  const markReady = () => {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
  };

  if (Array.isArray(layout.assets)) {
    layout.assets.forEach((asset, idx) => {
      const wrapper = createSvgEl("g");
      addDelay(wrapper, asset.delay || idx * 80);
      if (asset.colorVar) {
        wrapper.style.setProperty("color", `var(${asset.colorVar})`);
      }
      // Per-asset float variation
      setFloatProps(wrapper);
      wrapper.classList.add("scene-asset");
      if (asset.className) {
        asset.className.split(" ").forEach((cls) => wrapper.classList.add(cls));
      }

      const graphic = createSvgEl("g");
      graphic.classList.add("scene-asset-graphic");

      const image = createSvgEl("image");
      image.setAttribute("width", asset.width);
      image.setAttribute("height", asset.height);
      image.setAttribute("href", asset.href);
      image.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const child = image;

      if (!child) return;

      let tx = asset.x || 0;
      let ty = asset.y || 0;
      if (asset.center) {
        tx = VIEWBOX_SIZE / 2 - (asset.width || 0) / 2;
        ty = VIEWBOX_SIZE / 2 - (asset.height || 0) / 2;
      }

      graphic.setAttribute("transform", `translate(${tx} ${ty})`);

      // Position child at origin of its graphic group
      if (typeof child.setAttribute === "function") {
        if (!child.getAttribute("x")) child.setAttribute("x", 0);
        if (!child.getAttribute("y")) child.setAttribute("y", 0);
      }

      applyFlyOffset(wrapper, {x: tx + (asset.width || 0) / 2, y: ty + (asset.height || 0) / 2}, {
        sizeX: asset.width || 0,
        sizeY: asset.height || 0,
      });

      graphic.appendChild(child);
      wrapper.appendChild(graphic);
      contentGroup.appendChild(wrapper);
    });
  }

  const groupAsset = layout.groupAsset;
  if (groupAsset && (groupAsset.src || typeof groupAsset === "string")) {
    const config = typeof groupAsset === "string" ? {src: groupAsset} : groupAsset;
    loadSvgGroupAsset(config.src).then((data) => {
      if (!data || destroyed) {
        markReady();
        return;
      }
      if (data.defs) {
        svg.insertBefore(data.defs.cloneNode(true), contentGroup);
      }
      const groups = data.groups || [];
      const baseDelay = config.startDelay ?? 60;
      const delayStep = config.delayStep ?? 70;
      const measureViewBox = data.viewBox || `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`;
      const vbParts = measureViewBox
        .trim()
        .split(/\s+/)
        .map((v) => parseFloat(v));
      const vbWidth = Number.isFinite(vbParts[2]) ? vbParts[2] : VIEWBOX_SIZE;
      const vbHeight = Number.isFinite(vbParts[3]) ? vbParts[3] : VIEWBOX_SIZE;
      const scaleX = vbWidth ? VIEWBOX_SIZE / vbWidth : 1;
      const scaleY = vbHeight ? VIEWBOX_SIZE / vbHeight : 1;
      groups.forEach((group, idx) => {
        const wrapper = createSvgEl("g");
        addDelay(wrapper, baseDelay + idx * delayStep);
        setFloatProps(wrapper, {
          amp: 3 + Math.random() * 6,
          ms: 2400 + Math.random() * 1400,
          driftX: (Math.random() - 0.5) * 10,
        });
        wrapper.classList.add("scene-asset");
        const clone = group.cloneNode(true);
        // Measure in a temporary SVG to ensure layout before appending to the scene.
        const measureSvg = createSvgEl("svg");
        measureSvg.setAttribute("viewBox", measureViewBox);
        measureSvg.setAttribute("width", vbWidth);
        measureSvg.setAttribute("height", vbHeight);
        measureSvg.style.position = "absolute";
        measureSvg.style.opacity = "0";
        measureSvg.style.pointerEvents = "none";
        document.body.appendChild(measureSvg);
        const measureClone = clone.cloneNode(true);
        measureSvg.appendChild(measureClone);
        const rawBBox = measureClone.getBBox ? measureClone.getBBox() : null;
        const ctm = measureClone.getCTM ? measureClone.getCTM() : null;
        let bbox = rawBBox;
        if (rawBBox && ctm) {
          const transformPoint = (x, y) => {
            return {
              x: ctm.a * x + ctm.c * y + ctm.e,
              y: ctm.b * x + ctm.d * y + ctm.f,
            };
          };
          const p1 = transformPoint(rawBBox.x, rawBBox.y);
          const p2 = transformPoint(rawBBox.x + rawBBox.width, rawBBox.y);
          const p3 = transformPoint(rawBBox.x, rawBBox.y + rawBBox.height);
          const p4 = transformPoint(rawBBox.x + rawBBox.width, rawBBox.y + rawBBox.height);
          const xs = [p1.x, p2.x, p3.x, p4.x];
          const ys = [p1.y, p2.y, p3.y, p4.y];
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          bbox = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          };
        }
        measureSvg.remove();

        wrapper.appendChild(clone);
        contentGroup.appendChild(wrapper);
        const gx = bbox ? (bbox.x + bbox.width / 2) * scaleX : VIEWBOX_SIZE / 2;
        const gy = bbox ? (bbox.y + bbox.height / 2) * scaleY : VIEWBOX_SIZE / 2;
        applyFlyOffset(wrapper, {x: gx, y: gy}, {
          magnitude: 0,
          distScale: 0.9,
          sizeX: bbox ? bbox.width * scaleX : 0,
          sizeY: bbox ? bbox.height * scaleY : 0,
        });
      });
      markReady();
    }).catch(() => {
      markReady();
    });
  } else {
    markReady();
  }

  svg.appendChild(contentGroup);

  const cleanup = () => {
    destroyed = true;
    markReady();
  };

  return {root: svg, maxDelay, ready, cleanup};
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
        const beginSteady = () => {
          const settleMs = ENTER_MS + (next.maxDelay || 0) + 160;
          setTimeout(() => {
            if (activeScene !== next) return;
            next.root.classList.remove(enterStateClass);
            next.root.classList.add(steadyStateClass);
          }, settleMs);
        };
        if (next.ready && typeof next.ready.then === "function") {
          next.ready.catch(() => {}).finally(beginSteady);
        } else {
          beginSteady();
        }
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
    if (!slideContainer || targetIndex === currentIndex) {
      renderSlide(targetIndex);
      return;
    }
    if (isAnimating) return;

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
