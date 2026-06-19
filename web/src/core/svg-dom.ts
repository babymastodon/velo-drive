// svg-dom.ts
//
// Tiny internal SVG-assembly helpers extracted from core/chart.ts (Q7). These
// are a PURE MECHANICAL replacement for the repeated
// `document.createElementNS(SVG_NS, tag)` + `setAttribute(...)` sequences — they
// do NOT change any element, attribute value, attribute ORDER, or geometry.
//
// Attribute ordering note: SVG/DOM serialization emits attributes in insertion
// order, and JS object literals iterate string keys in insertion order, so
// `el('line', { x1, x2, y1, y2, stroke })` produces byte-identical markup to the
// equivalent hand-written setAttribute calls in the same order. Keep the key
// order in each call site matching the original.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Attribute values: numbers/booleans are coerced to string via String() to
 * mirror the legacy `setAttribute(name, String(x))` / string-literal calls. */
type AttrValue = string | number | boolean;

/**
 * Create an SVG element and set the given attributes in order. A `null`/
 * `undefined` value skips that attribute (so optional attrs can be expressed
 * inline without changing output for the present-attribute case).
 */
export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, AttrValue | null | undefined>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v == null) continue;
      node.setAttribute(key, String(v));
    }
  }
  return node;
}

/** Create + append an SVG element to `parent` in one step. */
export function appendEl<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs?: Record<string, AttrValue | null | undefined>,
): SVGElementTagNameMap[K] {
  const node = el(tag, attrs);
  parent.appendChild(node);
  return node;
}

/**
 * Append a horizontal grid line + optional left/right axis label, matching the
 * 100-W grid loop used by the HUD and builder charts. The label is only created
 * when `label` is supplied. Returns nothing; appends directly to `svg`.
 *
 * This collapses the verbatim 9-line `line` + 6-line `text` createElementNS
 * blocks into one call WITHOUT changing any coordinate, attribute, value, or
 * append order (line first, then label).
 */
export function appendGridLine(
  svg: SVGSVGElement,
  args: {
    x1: AttrValue;
    x2: AttrValue;
    y: AttrValue;
    stroke: string;
    strokeWidth: string;
    label?: {
      x: AttrValue;
      y: AttrValue;
      fontSize: string;
      fill: string;
      text: string;
    };
  },
): void {
  const line = el('line', {
    x1: args.x1,
    x2: args.x2,
    y1: args.y,
    y2: args.y,
    stroke: args.stroke,
    'stroke-width': args.strokeWidth,
    'pointer-events': 'none',
  });
  svg.appendChild(line);

  if (args.label) {
    const label = el('text', {
      x: args.label.x,
      y: args.label.y,
      'font-size': args.label.fontSize,
      fill: args.label.fill,
      'pointer-events': 'none',
    });
    label.textContent = args.label.text;
    svg.appendChild(label);
  }
}
