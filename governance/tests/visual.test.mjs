// Tests for the Figma fidelity gate (governance/visual).
//
// The comparison tests are pure. The scenario tests build a throwaway trusted
// checkout whose reference image is a render of the current base, so they test
// the gate's mechanics independently of the committed Figma references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { compareImages } from '../visual/lib/compare.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HERO = 'apps/web/src/features/hero/HeroActions.tsx';
const TOKENS = 'packages/design-system/src/tokens/tokens.ts';

const solid = (w, h, rgb) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) png.data.set([...rgb, 255], i * 4);
  return png;
};

test('compare: identical images have no diff', () => {
  const r = compareImages(solid(20, 10, [255, 255, 255]), solid(20, 10, [255, 255, 255]));
  assert.equal(r.diffPixels, 0);
  assert.equal(r.sizeMatches, true);
});

test('compare: changed region is counted', () => {
  const a = solid(10, 10, [255, 255, 255]);
  const b = solid(10, 10, [255, 255, 255]);
  for (let i = 0; i < 10; i++) b.data.set([0, 0, 0, 255], i * 4);
  assert.equal(compareImages(a, b).diffPixels, 10);
});

test('compare: a size mismatch is reported on its own, not folded into the diff ratio', () => {
  const r = compareImages(solid(10, 10, [255, 255, 255]), solid(10, 12, [255, 255, 255]));
  assert.equal(r.sizeMatches, false);
  assert.deepEqual(r.actualSize, [10, 12]);
  assert.equal(r.diffPixels, 0);
  assert.equal(r.missingPixels, 20);
  assert.equal(r.diffRatio, 0);
});

// A 2px-tall dark bar on white, vertically centred in a frame of the given height.
const bar = (h) => {
  const png = solid(10, h, [255, 255, 255]);
  const y = Math.floor((h - 2) / 2);
  for (let i = y * 10; i < (y + 2) * 10; i++) png.data.set([0, 0, 0, 255], i * 4);
  return png;
};

test('compare: center alignment compares content at the matching spot', () => {
  // Same centred content in a taller frame: no content drift once centred.
  const centred = compareImages(bar(20), bar(10), { align: 'center' });
  assert.equal(centred.diffPixels, 0);
  assert.deepEqual(centred.offsets.actual, [0, 5]);
  // Top-left alignment puts the bar against the frame's padding.
  assert.ok(compareImages(bar(20), bar(10), { align: 'top-left' }).diffPixels > 0);
});

test('compare: changed pixels are grouped into regions in Figma frame coordinates', () => {
  const a = solid(40, 40, [255, 255, 255]);
  const b = solid(40, 40, [255, 255, 255]);
  for (let y = 20; y < 24; y++) for (let x = 8; x < 16; x++) b.data.set([0, 0, 0, 255], (y * 40 + x) * 4);
  const [region, ...rest] = compareImages(a, b).regions;
  assert.equal(rest.length, 0);
  assert.deepEqual([region.x, region.y, region.pixels], [8, 16, 32]);
  assert.ok(region.x + region.width >= 16 && region.y + region.height >= 24);
});

test('compare: a different background is named and set aside to locate content changes', () => {
  const a = solid(40, 40, [245, 245, 245]);
  const b = solid(40, 40, [255, 255, 255]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) b.data.set([0, 0, 0, 255], (y * 40 + x) * 4);
  const r = compareImages(a, b, { threshold: 0.02 });
  assert.equal(r.dominant.expected.colour, '#f5f5f5');
  assert.equal(r.dominant.actual.colour, '#ffffff');
  assert.equal(r.diffPixels, 1600, 'the real diff still counts the background');
  assert.equal(r.content.diffPixels, 32);
  assert.equal(r.content.regions.length, 1);
});

test('the visual job runs in the Playwright image matching the pinned Playwright version', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(REPO, '.github/workflows/governance-trusted.yml'), 'utf8');
  const image = workflow.match(/image:\s*mcr\.microsoft\.com\/playwright:v([\d.]+)-/);
  assert.ok(image, 'visual job should run in mcr.microsoft.com/playwright');
  assert.equal(image[1], pkg.devDependencies.playwright);
});

// ---- scenarios ---------------------------------------------------------------
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
const edit = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

const root = mkdtempSync(join(tmpdir(), 'gov-visual-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

// Trusted checkout: this working tree's gate code + node_modules, with a scenes
// file whose reference is a render of the committed base.
const TRUSTED = join(root, 'trusted');
mkdirSync(join(TRUSTED, 'apps/web'), { recursive: true });
cpSync(join(REPO, 'package.json'), join(TRUSTED, 'package.json'));
cpSync(join(REPO, 'governance/visual'), join(TRUSTED, 'governance/visual'), { recursive: true });
symlinkSync(join(REPO, 'node_modules'), join(TRUSTED, 'node_modules'), 'dir');
symlinkSync(join(REPO, 'apps/web/node_modules'), join(TRUSTED, 'apps/web/node_modules'), 'dir');
const scenesPath = join(TRUSTED, 'governance/visual/scenes.json');
const scenes = JSON.parse(readFileSync(scenesPath, 'utf8'));
scenes.scenes = scenes.scenes.filter((s) => s.id === 'hero-actions').map((s) => ({ ...s, baseline: 'baselines/test-hero.png' }));
writeFileSync(scenesPath, JSON.stringify(scenes));

const CHECK = join(TRUSTED, 'governance/visual/visual-check.mjs');
const runCheck = (head, extra = []) =>
  spawnSync('node', [CHECK, '--trusted', TRUSTED, '--head', head, '--out', join(head, '..', 'out'), ...extra], {
    encoding: 'utf8',
  });

function clone(name) {
  const dir = join(root, name, 'head');
  git(REPO, 'clone', '-q', '--no-local', REPO, dir);
  return dir;
}

// Reference = the committed base rendered by the gate itself.
{
  const base = clone('reference');
  const { bundleScene, launchBrowser, renderScene } = await import('../visual/lib/render.mjs');
  const scene = scenes.scenes[0];
  const { code } = await bundleScene({ trusted: TRUSTED, head: base, scene });
  const browser = await launchBrowser();
  try {
    writeFileSync(join(TRUSTED, 'governance/visual', scene.baseline), await renderScene({ browser, trusted: TRUSTED, scene, code }));
  } finally {
    await browser.close();
  }
}

function scenario(name, pr) {
  const dir = clone(name);
  const baseSha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-qb', 'pr');
  pr(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'pr', '--allow-empty');
  const r = runCheck(dir, ['--base', baseSha]);
  return { pass: r.status === 0, out: r.stdout + r.stderr };
}
const expectPass = (r, re) => {
  assert.equal(r.pass, true, `expected PASS, got BLOCK:\n${r.out}`);
  if (re) assert.match(r.out, re);
};
const expectBlock = (r, re) => {
  assert.equal(r.pass, false, `expected BLOCK, got PASS:\n${r.out}`);
  if (re) assert.match(r.out, re);
};

test('PASS: PR that does not touch the screen skips the comparison', () => {
  expectPass(
    scenario('unrelated', (d) => writeFileSync(join(d, 'NOTES.md'), 'hello\n')),
    /hero-actions \| skipped/,
  );
});

test('PASS: PR that touches the screen without changing how it looks', () => {
  expectPass(
    scenario('noop-edit', (d) => edit(d, HERO, (s) => s.replace('export function HeroActions', '// harmless\nexport function HeroActions'))),
    /hero-actions \| pass/,
  );
});

test('BLOCK: PR that changes the screen layout', () => {
  expectBlock(
    scenario('layout', (d) => edit(d, HERO, (s) => s.replace('gap: tokens.space.xl', 'gap: tokens.space.section'))),
    /off the Figma frame/,
  );
});

test('BLOCK: PR that changes a token the screen uses', () => {
  expectBlock(
    scenario('token', (d) => edit(d, TOKENS, (s) => s.replace("titleHero: '72px'", "titleHero: '56px'"))),
    /off the Figma frame/,
  );
});

test('BLOCK: PR that changes a colour without changing the layout', () => {
  expectBlock(
    scenario('colour', (d) => edit(d, TOKENS, (s) => s.replace("surface: '#ffffff'", "surface: '#f0f0f0'"))),
    /drifted from the Figma frame/,
  );
});

test("BLOCK: PR that replaces the reference with its own render is still judged by the base's reference", () => {
  expectBlock(
    scenario('self-baseline', (d) => {
      edit(d, HERO, (s) => s.replace('gap: tokens.space.xl', 'gap: tokens.space.section'));
      mkdirSync(join(d, 'governance/visual/baselines'), { recursive: true });
      writeFileSync(join(d, 'governance/visual/baselines/test-hero.png'), PNG.sync.write(solid(1, 1, [0, 0, 0])));
      writeFileSync(join(d, 'governance/visual/scenes.json'), '{"scenes":[]}');
    }),
    /judged by the base branch copy/,
  );
});

test('BLOCK: PR whose screen throws at render time', () => {
  expectBlock(
    scenario('throws', (d) => edit(d, HERO, (s) => s.replace('const headingId = useId();', "const headingId = useId();\n  if (title) throw new Error('boom');"))),
    /boom/,
  );
});
