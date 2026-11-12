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
import { sceneReport } from './lib/report.mjs';

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
      // Render twice: if the two renders differ, the environment isn't
      // deterministic and no diff against Figma can be trusted.
      const first = await renderScene({ browser, trusted: TRUSTED, scene, code: bundle.code });
      const second = await renderScene({ browser, trusted: TRUSTED, scene, code: bundle.code });
      actual = PNG.sync.read(first);
      const again = PNG.sync.read(second);
      if (actual.width !== again.width || actual.height !== again.height || !actual.data.equals(again.data)) {
        row.status = 'FAIL';
        row.detail = 'render not deterministic';
        failures.push(
          `${scene.id}: two renders of the same code differed, so the result can't be trusted. This is an environment problem (fonts, animation, async content), not necessarily a design drift. Re-run the job; if it repeats, look for animations or content that loads after first paint.`,
        );
        writePng(join(OUT, `${scene.id}.actual.png`), actual);
        writePng(join(OUT, `${scene.id}.actual-2.png`), again);
        continue;
      }
    } catch (e) {
      row.status = 'FAIL';
      row.detail = 'render failed';
      failures.push(`${scene.id}: ${e.message}`);
      continue;
    }
    const expected = readPng(baselinePath);
    const r = compareImages(expected, actual, { threshold: scene.pixelThreshold, align: scene.align });
    const files = {
      actual: `${scene.id}.actual.png`,
      expected: `${scene.id}.expected.png`,
      diff: `${scene.id}.diff.png`,
      report: `${scene.id}.report.html`,
    };
    writePng(join(OUT, files.actual), actual);
    writePng(join(OUT, files.expected), expected);
    writePng(join(OUT, files.diff), r.diff);
    if (r.content) {
      files.contentDiff = `${scene.id}.content-diff.png`;
      writePng(join(OUT, files.contentDiff), r.content.diff);
    }

    const pct = (x) => `${(x * 100).toFixed(2)}%`;
    const [ew, eh] = r.expectedSize;
    const [aw, ah] = r.actualSize;
    const sizeDelta = Math.max(Math.abs(aw - ew), Math.abs(ah - eh));
    const maxSizeDelta = scene.maxSizeDelta ?? 0;
    const sizeFail = sizeDelta > maxSizeDelta;
    const ratioFail = r.diffRatio > scene.maxDiffRatio;

    // Findings, most actionable first.
    const findings = [];
    if (!r.sizeMatches) {
      const parts = [];
      if (aw !== ew) parts.push(`${Math.abs(aw - ew)}px ${aw < ew ? 'narrower' : 'wider'}`);
      if (ah !== eh) parts.push(`${Math.abs(ah - eh)}px ${ah < eh ? 'shorter' : 'taller'}`);
      findings.push(`Size: render ${aw}x${ah}, Figma ${ew}x${eh} (${parts.join(', ')}; limit ${maxSizeDelta}px). Check padding, gaps and type sizes.`);
    }
    const { expected: de, actual: da } = r.dominant;
    if (de.colour !== da.colour) {
      findings.push(
        `Most common colour (usually the background): render ${da.colour} (${pct(da.share)} of pixels), Figma ${de.colour} (${pct(de.share)}).`,
      );
    }
    findings.push(
      `${pct(r.diffRatio)} of the area both images cover differs (limit ${pct(scene.maxDiffRatio)}), compared ${r.align} aligned.`,
    );
    const where = (regions) =>
      regions
        .slice(0, 3)
        .map((g) => `x ${g.x}-${g.x + g.width}, y ${g.y}-${g.y + g.height} (${g.pixels}px)`)
        .join('; ');
    if (r.content) {
      findings.push(
        `With the background difference set aside, ${pct(r.content.diffRatio)} differs.${
          r.content.regions.length ? ` Largest changed regions, in Figma frame coordinates: ${where(r.content.regions)}.` : ''
        }`,
      );
    } else if (r.regions.length) {
      findings.push(`Largest changed regions, in Figma frame coordinates: ${where(r.regions)}.`);
    }

    row.diffRatio = r.diffRatio;
    row.detail = `${pct(r.diffRatio)} of overlap differs (limit ${pct(scene.maxDiffRatio)}); ${
      r.sizeMatches ? `${aw}x${ah}` : `size ${aw}x${ah} vs Figma ${ew}x${eh}`
    }`;
    const evidence = `See ${files.report} in the visual-diff artifact.`;
    if (sizeFail) {
      row.status = 'FAIL';
      failures.push(
        `${scene.id}: rendered size ${aw}x${ah} is ${sizeDelta}px off the Figma frame's ${ew}x${eh} (limit ${maxSizeDelta}px). ${evidence}\n${findings.map((f) => `- ${f}`).join('\n')}`,
      );
    } else if (ratioFail) {
      row.status = 'FAIL';
      failures.push(
        `${scene.id}: the rendered ${scene.export} has drifted from the Figma frame${
          scene.figma?.url ? ` (${scene.figma.url})` : ''
        }. ${evidence}\n${findings.map((f) => `- ${f}`).join('\n')}`,
      );
    } else {
      row.status = 'pass';
    }
    writeFileSync(join(OUT, files.report), sceneReport({ scene, status: row.status, findings, result: r, files }));
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
