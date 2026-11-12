#!/usr/bin/env node
// Producer of the required "governance/visual" status: Figma fidelity.
//
// Runs from the BASE branch (pull_request_target), like governance/trusted.
// For each scene in the base branch's scenes.json it bundles the PR's component
// with base-branch tooling, renders it in a network-isolated Chromium, and diffs
// it against the base branch's committed Figma reference. A PR can't change the
// reference, the threshold or the harness that judges it: those are read from
// the trusted checkout only, and changing them needs code-owner approval.
//
// Usage:
//   node visual-check.mjs --trusted <base checkout> --head <PR checkout> [--base <sha>] [--out <dir>] [--all]
// --all compares every scene even if the PR didn't touch its sources.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { compareImages, readPng, writePng } from './lib/compare.mjs';
import { bundleScene, launchBrowser, renderScene } from './lib/render.mjs';

const { values } = parseArgs({
  options: {
    trusted: { type: 'string' },
    head: { type: 'string' },
    base: { type: 'string' },
    out: { type: 'string' },
    all: { type: 'boolean', default: false },
  },
});
const TRUSTED = resolve(values.trusted ?? '.');
const HEAD = resolve(values.head ?? '.');
const OUT = resolve(values.out ?? join(HEAD, '..', 'visual-result'));
const CHECK_NAME = 'governance/visual';
const VISUAL = join(TRUSTED, 'governance/visual');
// Changes to these can alter any scene's rendering without appearing in its imports.
const GLOBAL_RE = /^(?:package\.json$|pnpm-lock\.yaml$|.*\/package\.json$|.*tsconfig[^/]*\.json$)/;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
mkdirSync(OUT, { recursive: true });

let changedFiles = [];
const notes = [];
if (values.base) {
  const mergeBase = git(HEAD, 'merge-base', values.base, 'HEAD');
  changedFiles = git(HEAD, 'diff', '--name-only', `${mergeBase}...HEAD`).split('\n').filter(Boolean);
  notes.push(`merge base ${mergeBase.slice(0, 12)}; ${changedFiles.length} file(s) changed`);
  if (changedFiles.some((f) => f.startsWith('governance/visual/'))) {
    notes.push(
      'This PR changes governance/visual/ (references, thresholds or harness). It is still judged by the base branch copy; the change takes effect after a code owner approves and merges it.',
    );
  }
}
const globalChange = changedFiles.some((f) => GLOBAL_RE.test(f));

const { scenes } = JSON.parse(readFileSync(join(VISUAL, 'scenes.json'), 'utf8'));
const failures = [];
const rows = [];
const browser = await launchBrowser();
try {
  for (const scene of scenes) {
    const row = { id: scene.id, status: '', detail: '' };
    rows.push(row);
    let bundle;
    try {
      bundle = await bundleScene({ trusted: TRUSTED, head: HEAD, scene });
    } catch (e) {
      row.status = 'FAIL';
      row.detail = 'could not bundle';
      failures.push(`${scene.id}: could not bundle ${scene.module} with base-branch tooling:\n${e.message}`);
      continue;
    }
    const touched = bundle.inputs.filter((f) => changedFiles.includes(f));
    if (!values.all && values.base && !touched.length && !globalChange) {
      row.status = 'skipped';
      row.detail = `none of its ${bundle.inputs.length} source files changed`;
      continue;
    }
    const baselinePath = join(VISUAL, scene.baseline);
    if (!existsSync(baselinePath)) {
      row.status = 'FAIL';
      row.detail = 'no reference image';
      failures.push(`${scene.id}: reference ${scene.baseline} is missing on the base branch.`);
      continue;
    }
    let actual;
    try {
      actual = PNG.sync.read(await renderScene({ browser, trusted: TRUSTED, scene, code: bundle.code }));
    } catch (e) {
      row.status = 'FAIL';
      row.detail = 'render failed';
      failures.push(`${scene.id}: ${e.message}`);
      continue;
    }
    const expected = readPng(baselinePath);
    const r = compareImages(expected, actual, { threshold: scene.pixelThreshold });
    writePng(join(OUT, `${scene.id}.actual.png`), actual);
    writePng(join(OUT, `${scene.id}.expected.png`), expected);
    writePng(join(OUT, `${scene.id}.diff.png`), r.diff);
    const pct = (x) => `${(x * 100).toFixed(2)}%`;
    const size = r.sizeMatches ? `${r.width}x${r.height}` : `size ${r.actualSize.join('x')} vs Figma ${r.expectedSize.join('x')}`;
    row.detail = `${pct(r.diffRatio)} of pixels differ (limit ${pct(scene.maxDiffRatio)}); ${size}`;
    row.diffRatio = r.diffRatio;
    const sizeDelta = Math.max(
      Math.abs(r.actualSize[0] - r.expectedSize[0]),
      Math.abs(r.actualSize[1] - r.expectedSize[1]),
    );
    const maxSizeDelta = scene.maxSizeDelta ?? 0;
    if (sizeDelta > maxSizeDelta) {
      row.status = 'FAIL';
      failures.push(
        `${scene.id}: rendered size ${r.actualSize.join('x')} is ${sizeDelta}px off the Figma frame's ${r.expectedSize.join('x')} (limit ${maxSizeDelta}px); ${pct(r.diffRatio)} of pixels differ. See the ${scene.id}.diff.png artifact.`,
      );
    } else if (r.diffRatio > scene.maxDiffRatio) {
      row.status = 'FAIL';
      failures.push(
        `${scene.id}: ${row.detail}. The rendered ${scene.export} has drifted from the Figma frame${
          scene.figma?.url ? ` (${scene.figma.url})` : ''
        }. See the ${scene.id}.diff.png artifact (magenta = missing area, red = changed pixels).`,
      );
    } else {
      row.status = 'pass';
    }
  }
} finally {
  await browser.close();
}

const summary = [
  `## ${CHECK_NAME}: ${failures.length ? 'FAIL' : 'PASS'}`,
  '',
  ...(failures.length ? ['### Failures', ...failures.map((f) => `- ${f.replace(/\n/g, '\n  ')}`), ''] : []),
  '### Scenes',
  '| scene | result | detail |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.id} | ${r.status} | ${r.detail} |`),
  '',
  ...(notes.length ? ['### Notes', ...notes.map((n) => `- ${n}`)] : []),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
writeFileSync(join(OUT, 'visual-result.json'), JSON.stringify({ failures, notes, scenes: rows }, null, 2));
process.exit(failures.length ? 1 : 0);
