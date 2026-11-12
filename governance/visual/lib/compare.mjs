// Pixel comparison for the visual gate. Images of different sizes are padded to
// the larger size; padded area in one image never matches real content in the
// other, so a layout that is too big or too small counts as drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const PAD = [255, 0, 255, 255];

export const readPng = (path) => PNG.sync.read(readFileSync(path));
export const writePng = (path, png) => writeFileSync(path, PNG.sync.write(png));

function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png.data;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set(PAD, i * 4);
  for (let y = 0; y < png.height; y++) {
    png.data.copy(out, y * width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return out;
}

/**
 * @param {PNG} expected reference (Figma)
 * @param {PNG} actual rendered screen
 * @param {{ threshold?: number }} opts pixelmatch per-pixel colour threshold (0..1)
 */
export function compareImages(expected, actual, { threshold = 0.1 } = {}) {
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(padTo(expected, width, height), padTo(actual, width, height), diff.data, width, height, {
    threshold,
    includeAA: false,
    alpha: 0.2,
  });
  return {
    width,
    height,
    diffPixels,
    diffRatio: diffPixels / (width * height),
    sizeMatches: expected.width === actual.width && expected.height === actual.height,
    expectedSize: [expected.width, expected.height],
    actualSize: [actual.width, actual.height],
    diff,
  };
}
