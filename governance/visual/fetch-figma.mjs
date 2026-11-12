#!/usr/bin/env node
// Fetches a scene's reference image from the Figma REST API and records where
// it came from. Run by a person (or the agent on their machine) with a
// read-only token; CI never needs Figma access. The result is committed under
// governance/visual/baselines/, which is code-owner protected.
//
//   FIGMA_TOKEN=... node governance/visual/fetch-figma.mjs --scene hero-actions [--file-key KEY]
//   node governance/visual/fetch-figma.mjs --scene hero-actions --token-file ~/figma-token.txt
//   ... --verify   re-fetches and compares with the committed reference instead of writing it
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { compareImages } from './lib/compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    scene: { type: 'string' },
    'file-key': { type: 'string' },
    'token-file': { type: 'string' },
    verify: { type: 'boolean', default: false },
  },
});
const token = (process.env.FIGMA_TOKEN || (values['token-file'] && readFileSync(values['token-file'], 'utf8')) || '').trim();
if (!token) throw new Error('Set FIGMA_TOKEN or pass --token-file (a token with File content: read-only).');

const scenesPath = join(HERE, 'scenes.json');
const config = JSON.parse(readFileSync(scenesPath, 'utf8'));
const scene = config.scenes.find((s) => s.id === values.scene);
if (!scene) throw new Error(`unknown scene ${values.scene}`);
const fileKey = values['file-key'] ?? scene.figma.fileKey;
const nodeId = scene.figma.nodeId;

const api = async (path) => {
  const res = await fetch(`https://api.figma.com/v1/${path}`, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const file = await api(`files/${fileKey}?depth=1`);
const nodes = await api(`files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`);
const node = nodes.nodes[nodeId]?.document;
if (!node) throw new Error(`node ${nodeId} not found in ${fileKey}`);
const images = await api(`images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`);
const png = Buffer.from(await (await fetch(images.images[nodeId])).arrayBuffer());
const img = PNG.sync.read(png);
const baselinePath = join(HERE, scene.baseline);

if (values.verify) {
  const r = compareImages(PNG.sync.read(readFileSync(baselinePath)), img, { threshold: scene.pixelThreshold });
  console.log(`${scene.id}: committed reference vs Figma now: ${(r.diffRatio * 100).toFixed(3)}% differ, size match ${r.sizeMatches}`);
  process.exit(r.diffRatio > 0.001 || !r.sizeMatches ? 1 : 0);
}

writeFileSync(baselinePath, png);
const box = node.absoluteBoundingBox ?? {};
const manifest = {
  scene: scene.id,
  fileKey,
  nodeId,
  nodeName: node.name,
  nodeType: node.type,
  fileName: file.name,
  version: file.version,
  lastModified: file.lastModified,
  frame: { width: box.width, height: box.height },
  png: { scale: 1, width: img.width, height: img.height, sha256: createHash('sha256').update(png).digest('hex') },
  fetchedAt: new Date().toISOString(),
};
writeFileSync(baselinePath.replace(/\.png$/, '.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
