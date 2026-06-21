// welcome-scene.ts
//
// Builds the per-slide welcome SVG scene (splash = a centered logo image; the
// other slides load an SVG asset, split its top-level <g> groups, and position
// each by its measured bbox center). Animation-only CSS custom properties
// (--fly-*, --float-*) are set, but the visual harness disables animations, so
// only the deterministic static transforms affect the render — keeping the pixel
// diff stable. Assets are fetched from /img and /icons (copied into the build).

const SVGNS = 'http://www.w3.org/2000/svg';
const VIEWBOX_SIZE = 360;

interface SceneLayout {
  baseWidth?: number;
  baseHeight?: number;
  steady?: string;
  enter?: string;
  exit?: string;
  assets?: Array<{
    href: string;
    width: number;
    height: number;
    delay?: number;
    center?: boolean;
    x?: number;
    y?: number;
    colorVar?: string;
    className?: string;
  }>;
  groupAsset?: { src: string; startDelay?: number; delayStep?: number };
}

export const SCENE_LAYOUTS: Record<string, SceneLayout> = {
  splash: {
    baseWidth: 360,
    baseHeight: 360,
    steady: 'none',
    enter: 'grow',
    exit: 'fade',
    assets: [{ href: 'icons/logo_sq.svg', width: 196, height: 196, delay: 80, center: true }],
  },
  trainers: { baseWidth: 360, baseHeight: 360, enter: 'fly', exit: 'rise', groupAsset: { src: 'img/trainer.svg' } },
  offline: { baseWidth: 360, baseHeight: 360, enter: 'fly', exit: 'rise', groupAsset: { src: 'img/browser.svg' } },
  workouts: { baseWidth: 360, baseHeight: 360, enter: 'fly', exit: 'rise', groupAsset: { src: 'img/builder.svg' } },
};

function svgEl<K extends string>(tag: K): SVGElement {
  return document.createElementNS(SVGNS, tag) as SVGElement;
}

const svgGroupCache = new Map<string, Promise<{ viewBox: string | null; defs: Node | null; groups: Element[] } | null>>();

function loadSvgGroupAsset(src: string) {
  if (svgGroupCache.has(src)) return svgGroupCache.get(src)!;
  const promise = fetch(src)
    .then((resp) => {
      if (!resp.ok) throw new Error(`Failed to load SVG: ${resp.status}`);
      return resp.text();
    })
    .then((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.querySelector('svg');
      if (!root) throw new Error('SVG root missing');
      const viewBox = root.getAttribute('viewBox');
      const defs = root.querySelector('defs');
      const groups = Array.from(root.children).filter(
        (n) => n.tagName && n.tagName.toLowerCase() === 'g',
      );
      return {
        viewBox,
        defs: defs ? defs.cloneNode(true) : null,
        groups: groups.map((g) => g.cloneNode(true) as Element),
      };
    })
    .catch(() => null);
  svgGroupCache.set(src, promise);
  return promise;
}

/**
 * Build the scene SVG for a slide. Returns the root <svg> and a `ready` promise
 * that resolves once async group assets have been laid out (so callers can wait
 * for a settled render before snapshotting).
 */
export function createScene(slideId: string): { root: SVGElement; ready: Promise<void> } {
  const layout: SceneLayout = SCENE_LAYOUTS[slideId] ?? SCENE_LAYOUTS.splash ?? {};
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'presentation');
  svg.classList.add('welcome-scene-root');
  const enterType = layout.enter || 'fly';
  const steadyType = layout.steady || 'float';
  const exitType = layout.exit || 'rise';
  svg.classList.add(`scene-enter-${enterType}`, `scene-steady-${steadyType}`, `scene-exit-${exitType}`);

  const baseWidth = layout.baseWidth || VIEWBOX_SIZE;
  const baseHeight = layout.baseHeight || VIEWBOX_SIZE;
  const offsetX = Math.max(0, (VIEWBOX_SIZE - baseWidth) / 2);
  const offsetY = Math.max(0, (VIEWBOX_SIZE - baseHeight) / 2);
  const contentGroup = svgEl('g');
  contentGroup.setAttribute('transform', `translate(${offsetX} ${offsetY})`);

  const addDelay = (el: SVGElement, delay: number) => {
    el.classList.add('scene-piece');
    el.style.setProperty('--delay', `${delay || 0}ms`);
  };
  const applyFlyOffset = (el: SVGElement, origin: { x: number; y: number }) => {
    if (enterType !== 'fly') return;
    const cx = VIEWBOX_SIZE / 2;
    const cy = VIEWBOX_SIZE / 2;
    const dx = origin.x - cx;
    const dy = origin.y - cy;
    let len = Math.hypot(dx, dy);
    if (!Number.isFinite(len)) len = 0;
    const growRadius = VIEWBOX_SIZE * 0.25;
    const clamped = Math.min(1, Math.max(0, len / growRadius));
    el.style.setProperty('--fly-scale', `${0.7 + clamped * 0.3}`);
    el.style.setProperty('--fly-x', `${dx * 0.9}px`);
    el.style.setProperty('--fly-y', `${dy * 0.9}px`);
  };
  const setFloatProps = (el: SVGElement) => {
    el.style.setProperty('--float-ms', `2600ms`);
    el.style.setProperty('--float-amp', `6px`);
    el.style.setProperty('--float-x', `0px`);
  };

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));

  if (Array.isArray(layout.assets)) {
    layout.assets.forEach((asset, idx) => {
      const wrapper = svgEl('g');
      addDelay(wrapper, asset.delay ?? idx * 80);
      if (asset.colorVar) wrapper.style.setProperty('color', `var(${asset.colorVar})`);
      setFloatProps(wrapper);
      wrapper.classList.add('scene-asset');
      if (asset.className) asset.className.split(' ').forEach((c) => wrapper.classList.add(c));

      const graphic = svgEl('g');
      graphic.classList.add('scene-asset-graphic');
      const image = svgEl('image');
      image.setAttribute('width', String(asset.width));
      image.setAttribute('height', String(asset.height));
      image.setAttribute('href', asset.href);
      image.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      let tx = asset.x || 0;
      let ty = asset.y || 0;
      if (asset.center) {
        tx = VIEWBOX_SIZE / 2 - (asset.width || 0) / 2;
        ty = VIEWBOX_SIZE / 2 - (asset.height || 0) / 2;
      }
      graphic.setAttribute('transform', `translate(${tx} ${ty})`);
      image.setAttribute('x', '0');
      image.setAttribute('y', '0');
      applyFlyOffset(wrapper, { x: tx + (asset.width || 0) / 2, y: ty + (asset.height || 0) / 2 });
      graphic.appendChild(image);
      wrapper.appendChild(graphic);
      contentGroup.appendChild(wrapper);
    });
  }

  const groupAsset = layout.groupAsset;
  if (groupAsset && groupAsset.src) {
    loadSvgGroupAsset(groupAsset.src)
      .then((data) => {
        if (!data) {
          resolveReady();
          return;
        }
        if (data.defs) svg.insertBefore(data.defs.cloneNode(true), contentGroup);
        const groups = data.groups || [];
        const baseDelay = groupAsset.startDelay ?? 60;
        const delayStep = groupAsset.delayStep ?? 70;
        const measureViewBox = data.viewBox || `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`;
        const vbParts = measureViewBox.trim().split(/\s+/).map((v) => parseFloat(v));
        const vbWidth = Number.isFinite(vbParts[2]) ? vbParts[2] : VIEWBOX_SIZE;
        const vbHeight = Number.isFinite(vbParts[3]) ? vbParts[3] : VIEWBOX_SIZE;
        const scaleX = vbWidth ? VIEWBOX_SIZE / vbWidth : 1;
        const scaleY = vbHeight ? VIEWBOX_SIZE / vbHeight : 1;

        groups.forEach((group, idx) => {
          const wrapper = svgEl('g');
          addDelay(wrapper, baseDelay + idx * delayStep);
          setFloatProps(wrapper);
          wrapper.classList.add('scene-asset');
          const clone = group.cloneNode(true) as Element;

          // Measure in a temporary SVG to get the group bbox (CTM-aware).
          const measureSvg = svgEl('svg') as SVGSVGElement;
          measureSvg.setAttribute('viewBox', measureViewBox);
          measureSvg.setAttribute('width', String(vbWidth));
          measureSvg.setAttribute('height', String(vbHeight));
          measureSvg.style.position = 'absolute';
          measureSvg.style.opacity = '0';
          measureSvg.style.pointerEvents = 'none';
          document.body.appendChild(measureSvg);
          const measureClone = clone.cloneNode(true) as SVGGraphicsElement;
          measureSvg.appendChild(measureClone);
          const rawBBox = measureClone.getBBox ? measureClone.getBBox() : null;
          const ctm = measureClone.getCTM ? measureClone.getCTM() : null;
          let bbox = rawBBox as { x: number; y: number; width: number; height: number } | null;
          if (rawBBox && ctm) {
            const tp = (x: number, y: number) => ({
              x: ctm.a * x + ctm.c * y + ctm.e,
              y: ctm.b * x + ctm.d * y + ctm.f,
            });
            const p1 = tp(rawBBox.x, rawBBox.y);
            const p2 = tp(rawBBox.x + rawBBox.width, rawBBox.y);
            const p3 = tp(rawBBox.x, rawBBox.y + rawBBox.height);
            const p4 = tp(rawBBox.x + rawBBox.width, rawBBox.y + rawBBox.height);
            const xs = [p1.x, p2.x, p3.x, p4.x];
            const ys = [p1.y, p2.y, p3.y, p4.y];
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          }
          measureSvg.remove();

          wrapper.appendChild(clone);
          contentGroup.appendChild(wrapper);
          const gx = bbox ? (bbox.x + bbox.width / 2) * scaleX : VIEWBOX_SIZE / 2;
          const gy = bbox ? (bbox.y + bbox.height / 2) * scaleY : VIEWBOX_SIZE / 2;
          applyFlyOffset(wrapper, { x: gx, y: gy });
        });
        resolveReady();
      })
      .catch(() => resolveReady());
  } else {
    resolveReady();
  }

  svg.appendChild(contentGroup);
  return { root: svg, ready };
}
