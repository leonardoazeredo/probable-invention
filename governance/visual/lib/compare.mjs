// Pixel comparison for the visual gate.
//
// The two images are placed on one canvas (top-left or centred, per scene) and
// only the area where both have pixels is diffed, so a size mismatch is reported
// as a size mismatch instead of inflating the diff ratio, and content is compared
// against the matching spot in the frame rather than against padding. Area that
// only one image covers is drawn magenta in the diff image but not counted.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const PAD = [255, 0, 255, 255];
const DIFF = [255, 0, 0];
const CELL = 8; // px; changed pixels closer than this are grouped into one region

export const readPng = (path) => PNG.sync.read(readFileSync(path));
export const writePng = (path, png) => writeFileSync(path, PNG.sync.write(png));

function crop(png, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    png.data.copy(out, row * w * 4, ((y + row) * png.width + x) * 4, ((y + row) * png.width + x + w) * 4);
  }
  return out;
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** The most common opaque colour, as #rrggbb, and its share of the image. */
export function dominantColour(png) {
  const counts = new Map();
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [k, c] of counts) if (c > bestCount) [best, bestCount] = [k, c];
  return { colour: hex(best >> 16, (best >> 8) & 255, best & 255), share: bestCount / (png.width * png.height) };
}

/**
 * Groups changed pixels into rectangular regions (connected 8px cells), largest
 * first. Coordinates are in the diffed area's own space.
 */
function changedRegions(mask, w, h) {
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  const cells = new Uint32Array(cw * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (mask[y * w + x]) cells[Math.floor(y / CELL) * cw + Math.floor(x / CELL)]++;
  }
  const seen = new Uint8Array(cw * ch);
  const regions = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let [x0, y0, x1, y1, pixels] = [Infinity, Infinity, -1, -1, 0];
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cw;
      const cy = (c - cx) / cw;
      pixels += cells[c];
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx;
        if (cells[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    regions.push({
      x: x0 * CELL,
      y: y0 * CELL,
      width: Math.min(w, (x1 + 1) * CELL) - x0 * CELL,
      height: Math.min(h, (y1 + 1) * CELL) - y0 * CELL,
      pixels,
    });
  }
  return regions.sort((a, b) => b.pixels - a.pixels);
}

/**
 * @param {PNG} expected reference (Figma)
 * @param {PNG} actual rendered screen
 * @param {{ threshold?: number, align?: 'top-left' | 'center' }} opts
 *   threshold: pixelmatch per-pixel colour threshold (0..1).
 *   align: how to place images of different sizes before diffing.
 */
export function compareImages(expected, actual, { threshold = 0.1, align = 'top-left' } = {}) {
  if (align !== 'top-left' && align !== 'center') throw new Error(`unknown align "${align}"`);
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const place = (png) =>
    align === 'center' ? [Math.floor((width - png.width) / 2), Math.floor((height - png.height) / 2)] : [0, 0];
  const [ex, ey] = place(expected);
  const [ax, ay] = place(actual);

  // The area both images cover, in canvas coordinates.
  const ox = Math.max(ex, ax);
  const oy = Math.max(ey, ay);
  const ow = Math.min(ex + expected.width, ax + actual.width) - ox;
  const oh = Math.min(ey + expected.height, ay + actual.height) - oy;
  const overlapPixels = Math.max(0, ow) * Math.max(0, oh);

  const canvas = () => {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) png.data.set(PAD, i * 4);
    return png;
  };
  const paint = (png, out) => {
    for (let row = 0; row < oh; row++) out.copy(png.data, ((oy + row) * width + ox) * 4, row * ow * 4, (row + 1) * ow * 4);
  };
  const diff = canvas();
  const dominant = { expected: dominantColour(expected), actual: dominantColour(actual) };
  let diffPixels = 0;
  let regions = [];
  let content = null;
  if (overlapPixels) {
    const exp = crop(expected, ox - ex, oy - ey, ow, oh);
    const act = crop(actual, ox - ax, oy - ay, ow, oh);
    const run = (a) => {
      const out = Buffer.alloc(ow * oh * 4);
      const count = pixelmatch(exp, a, out, ow, oh, { threshold, includeAA: false, alpha: 0.2, diffColor: DIFF });
      const mask = new Uint8Array(ow * oh);
      for (let i = 0; i < ow * oh; i++) {
        mask[i] = out[i * 4] === DIFF[0] && out[i * 4 + 1] === DIFF[1] && out[i * 4 + 2] === DIFF[2] ? 1 : 0;
      }
      // Report regions in the Figma frame's coordinates.
      const regions = changedRegions(mask, ow, oh).map((r) => ({ ...r, x: r.x + ox - ex, y: r.y + oy - ey }));
      return { count, out, regions };
    };
    const main = run(act);
    diffPixels = main.count;
    regions = main.regions;
    paint(diff, main.out);

    // A different background flags every pixel and buries everything else. When
    // both images have a clear background colour and they differ, diff again
    // with the render's background repainted in Figma's, so the report can
    // still say where the content differs. Pass/fail uses the real diff only.
    if (dominant.expected.colour !== dominant.actual.colour && dominant.expected.share > 0.3 && dominant.actual.share > 0.3) {
      const from = parseInt(dominant.actual.colour.slice(1), 16);
      const to = parseInt(dominant.expected.colour.slice(1), 16);
      const repainted = Buffer.from(act);
      for (let i = 0; i < repainted.length; i += 4) {
        if (((repainted[i] << 16) | (repainted[i + 1] << 8) | repainted[i + 2]) === from) {
          repainted[i] = to >> 16;
          repainted[i + 1] = (to >> 8) & 255;
          repainted[i + 2] = to & 255;
        }
      }
      const c = run(repainted);
      const contentDiff = canvas();
      paint(contentDiff, c.out);
      content = { diffPixels: c.count, diffRatio: c.count / overlapPixels, regions: c.regions, diff: contentDiff };
    }
  }

  return {
    width,
    height,
    align,
    diffPixels,
    overlapPixels,
    // Share of the overlapping area that differs. A size mismatch is reported
    // separately (sizeMatches, expectedSize, actualSize), not folded in here.
    diffRatio: overlapPixels ? diffPixels / overlapPixels : 1,
    missingPixels: width * height - overlapPixels,
    sizeMatches: expected.width === actual.width && expected.height === actual.height,
    expectedSize: [expected.width, expected.height],
    actualSize: [actual.width, actual.height],
    offsets: { expected: [ex, ey], actual: [ax, ay] },
    regions,
    dominant,
    // Set only when the backgrounds differ: the diff with that difference set aside.
    content,
    diff,
  };
}
