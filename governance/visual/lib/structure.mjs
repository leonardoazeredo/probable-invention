// Structural check for the visual gate: compares what the browser laid out
// (boxes and computed styles of mapped elements) with what Figma specifies
// (node geometry, fills, strokes, radius, type and auto-layout spacing).
//
// Unlike the pixel diff, this has no rasteriser noise and names the property
// that is wrong: "Subtitle: colour #1e1e1e, Figma #757575".
//
// The Figma side is a trimmed snapshot of the frame's node tree, committed next
// to the reference PNG (baselines/<scene>.figma.json) by fetch-figma.mjs. The
// mapping from Figma layers to CSS selectors lives in the base branch's
// scenes.json, so a PR can't remap layers to dodge the check.

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
const figmaHex = ({ r, g, b }) => `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;

/** The first visible solid paint, as { hex, opacity }, or null. */
function solidPaint(paints) {
  const p = (paints ?? []).find((x) => x.visible !== false && x.type === 'SOLID');
  if (!p) return null;
  return { hex: figmaHex(p.color), opacity: round((p.opacity ?? 1) * (p.color.a ?? 1)) };
}

/**
 * Trims a Figma REST node (GET /v1/files/:key/nodes, full depth) to the
 * properties the check compares. Boxes are relative to the frame's top-left.
 */
export function trimFigmaNode(node, origin = node.absoluteBoundingBox) {
  const b = node.absoluteBoundingBox ?? { x: origin.x, y: origin.y, width: 0, height: 0 };
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
    box: { x: round(b.x - origin.x), y: round(b.y - origin.y), width: round(b.width), height: round(b.height) },
  };
  if (node.visible === false) out.hidden = true;
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    out.layout = {
      mode: node.layoutMode,
      itemSpacing: node.itemSpacing ?? 0,
      padding: [node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0],
    };
  }
  const fill = solidPaint(node.fills);
  if (fill) out.fill = fill;
  const stroke = solidPaint(node.strokes);
  if (stroke) out.stroke = { ...stroke, weight: node.strokeWeight ?? 1 };
  if (node.cornerRadius != null) out.radius = node.cornerRadius;
  else if (node.rectangleCornerRadii) out.radius = node.rectangleCornerRadii[0];
  if (node.type === 'TEXT' && node.style) {
    const s = node.style;
    out.text = {
      characters: node.characters,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeightPx != null ? round(s.lineHeightPx) : undefined,
      letterSpacing: round(s.letterSpacing ?? 0),
    };
  }
  if (node.boundVariables && Object.keys(node.boundVariables).length) {
    // Variable ids per property; names are resolved separately (tokens map).
    out.variables = Object.fromEntries(
      Object.entries(node.boundVariables).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.id) : v.id]),
    );
  }
  if (node.children?.length) out.children = node.children.map((c) => trimFigmaNode(c, origin));
  return out;
}

/**
 * Finds a node by id ("2143:15060") or by layer path from the frame root
 * ("Text Content/Title"; "Button#2" is the second sibling named Button; "" is
 * the frame itself).
 */
export function findNode(root, ref) {
  if (/^\d+:\d+$/.test(ref)) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n.id === ref) return n;
      stack.push(...(n.children ?? []));
    }
    return null;
  }
  let node = root;
  for (const seg of ref.split('/').filter(Boolean)) {
    const [, name, nth] = seg.match(/^(.*?)(?:#(\d+))?$/);
    node = (node.children ?? []).filter((c) => c.name === name)[(nth ? Number(nth) : 1) - 1];
    if (!node) return null;
  }
  return node;
}

/**
 * Runs in the page: boxes relative to the scene root and the computed styles
 * the check compares, for each selector. Missing selectors come back null.
 */
export function measureInPage(selectors) {
  const root = document.querySelector('#root > *');
  const origin = root.getBoundingClientRect();
  const out = {};
  for (const sel of selectors) {
    const el = sel === ':scope' ? root : root.matches(sel) ? root : root.querySelector(sel);
    if (!el) {
      out[sel] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[sel] = {
      box: { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height },
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      borderWidth: parseFloat(cs.borderTopWidth),
      borderStyle: cs.borderTopStyle,
      borderColor: cs.borderTopColor,
      radius: parseFloat(cs.borderTopLeftRadius),
      fontFamily: cs.fontFamily,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
    };
  }
  return out;
}

/** "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" → { hex, opacity } */
export function cssColour(value) {
  const m = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (!m) return null;
  let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  a = round(a);
  return { hex: `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`, opacity: a };
}

const channelDelta = (a, b) =>
  Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))));

const DEFAULT_TOLERANCE = { box: 1, textBox: 2, colour: 2, lineHeight: 1, letterSpacing: 0.1 };

/**
 * @param {object} snapshot trimmed Figma tree (trimFigmaNode)
 * @param {Record<string, object|null>} measured measureInPage result
 * @param {Array<{ figma: string, selector: string, name?: string }>} map scene.structure.map
 * @returns {{ findings: Array<{ element: string, property: string, actual: string, expected: string, message: string }>, checked: number, errors: string[] }}
 */
export function compareStructure(snapshot, measured, map, tolerance = {}) {
  const tol = { ...DEFAULT_TOLERANCE, ...tolerance };
  const findings = [];
  const errors = [];
  let checked = 0;
  const add = (element, property, actual, expected, note = '') =>
    findings.push({
      element,
      property,
      actual: String(actual),
      expected: String(expected),
      message: `${element}: ${property} ${actual}, Figma ${expected}${note}`,
    });
  const px = (n) => `${round(n, 1)}px`;
  const resolved = [];

  for (const entry of map) {
    const node = findNode(snapshot, entry.figma);
    const label = entry.name ?? (entry.figma ? entry.figma.split('/').pop() : snapshot.name);
    if (!node) {
      errors.push(`Figma layer "${entry.figma}" isn't in the snapshot; update the scene's structure map.`);
      continue;
    }
    const el = measured[entry.selector];
    if (!el) {
      add(label, 'element', 'missing', `present (selector ${entry.selector})`);
      continue;
    }
    resolved.push({ entry, node, el, label });
    checked++;

    const isText = node.type === 'TEXT';
    const boxTol = isText ? tol.textBox : tol.box;
    // Position and size. Text width depends on the rasteriser, so only its
    // vertical position is compared; its type properties are checked below.
    for (const [k, prop] of [
      ['y', 'top'],
      ['height', 'height'],
      ...(isText ? [] : [['x', 'left'], ['width', 'width']]),
    ]) {
      if (Math.abs(el.box[k] - node.box[k]) > boxTol) add(label, prop, px(el.box[k]), px(node.box[k]));
    }

    if (isText) {
      const t = node.text ?? {};
      const colour = cssColour(el.color);
      if (node.fill && colour && channelDelta(colour.hex, node.fill.hex) > tol.colour) add(label, 'text colour', colour.hex, node.fill.hex);
      if (t.fontSize != null && Math.abs(el.fontSize - t.fontSize) > 0.01) add(label, 'font size', px(el.fontSize), px(t.fontSize));
      if (t.fontWeight != null && el.fontWeight !== t.fontWeight) add(label, 'font weight', el.fontWeight, t.fontWeight);
      if (t.lineHeight != null && el.lineHeight != null && Math.abs(el.lineHeight - t.lineHeight) > tol.lineHeight) {
        add(label, 'line height', px(el.lineHeight), px(t.lineHeight));
      }
      if (Math.abs(el.letterSpacing - (t.letterSpacing ?? 0)) > tol.letterSpacing) {
        add(label, 'letter spacing', px(el.letterSpacing), px(t.letterSpacing ?? 0));
      }
      if (t.fontFamily && !el.fontFamily.toLowerCase().includes(t.fontFamily.toLowerCase())) {
        add(label, 'font family', el.fontFamily, t.fontFamily);
      }
      continue;
    }

    const bg = cssColour(el.backgroundColor);
    const bgVisible = bg && bg.opacity > 0;
    if (node.fill) {
      if (!bgVisible) add(label, 'background', 'none', node.fill.hex);
      else if (channelDelta(bg.hex, node.fill.hex) > tol.colour) add(label, 'background', bg.hex, node.fill.hex);
    } else if (bgVisible && entry.checkBackground !== false) {
      // Only flag a background Figma doesn't have when the element isn't the
      // frame root, whose page background the screenshot always shows.
      if (entry.figma) add(label, 'background', bg.hex, 'none');
    }

    const border = el.borderStyle !== 'none' && el.borderWidth > 0 ? cssColour(el.borderColor) : null;
    if (node.stroke) {
      if (!border) add(label, 'border', 'none', `${px(node.stroke.weight)} ${node.stroke.hex}`);
      else {
        if (Math.abs(el.borderWidth - node.stroke.weight) > 0.01) add(label, 'border width', px(el.borderWidth), px(node.stroke.weight));
        if (channelDelta(border.hex, node.stroke.hex) > tol.colour) add(label, 'border colour', border.hex, node.stroke.hex);
      }
    } else if (border) {
      add(label, 'border', `${px(el.borderWidth)} ${border.hex}`, 'none');
    }

    if (node.radius != null && Math.abs(el.radius - node.radius) > 0.5) add(label, 'corner radius', px(el.radius), px(node.radius));
  }

  // Auto-layout spacing: for each mapped auto-layout frame, the gaps between
  // its mapped direct children along the layout axis, against itemSpacing.
  for (const parent of resolved) {
    const layout = parent.node.layout;
    if (!layout) continue;
    const vertical = layout.mode === 'VERTICAL';
    const kids = resolved
      .filter((r) => (parent.node.children ?? []).includes(r.node) && !r.node.hidden)
      .sort((a, b) => (vertical ? a.node.box.y - b.node.box.y : a.node.box.x - b.node.box.x));
    for (let i = 1; i < kids.length; i++) {
      const [a, b] = [kids[i - 1], kids[i]];
      const pos = vertical ? 'y' : 'x';
      const size = vertical ? 'height' : 'width';
      const gap = b.el.box[pos] - (a.el.box[pos] + a.el.box[size]);
      const figmaGap = b.node.box[pos] - (a.node.box[pos] + a.node.box[size]);
      // Text boxes can differ in height by a pixel or two; allow that here.
      const gapTol = a.node.type === 'TEXT' || b.node.type === 'TEXT' ? tol.textBox : tol.box;
      if (Math.abs(gap - figmaGap) > gapTol) {
        add(`${parent.label}`, `gap between ${a.label} and ${b.label}`, px(gap), px(figmaGap), ` (itemSpacing ${layout.itemSpacing}px)`);
      }
    }
  }

  return { findings, checked, errors };
}
