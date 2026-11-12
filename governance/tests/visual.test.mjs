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

const HERO_MAP = [
  { figma: '', selector: ':scope', name: 'Section' },
  { figma: 'Text', selector: 'section > div:nth-child(1)' },
  { figma: 'Text/Title', selector: 'h1' },
  { figma: 'Text/Subtitle', selector: 'p' },
  { figma: 'Buttons', selector: 'section > div:nth-child(2)' },
  { figma: 'Buttons/Button#1', selector: 'section > div:nth-child(2) > button:nth-child(1)', name: 'Secondary button' },
  { figma: 'Buttons/Button#2', selector: 'section > div:nth-child(2) > button:nth-child(2)', name: 'Primary button' },
];
const LAYOUT = { '': 'VERTICAL', Text: 'VERTICAL', Buttons: 'HORIZONTAL' };

/** Builds a Figma REST-shaped node tree from measured elements (test fixture). */
function figmaTreeFromRender(measured) {
  const paint = (css) => {
    const m = css.match(/[\d.]+/g).map(Number);
    return (m[3] ?? 1) === 0 ? [] : [{ type: 'SOLID', color: { r: m[0] / 255, g: m[1] / 255, b: m[2] / 255, a: m[3] ?? 1 } }];
  };
  const nodes = {};
  for (const [i, { figma, selector }] of HERO_MAP.entries()) {
    const e = measured[selector];
    const text = selector === 'h1' || selector === 'p';
    nodes[figma] = {
      id: `9:${i + 1}`,
      name: (figma.split('/').pop() || 'Hero').replace(/#\d+$/, ''),
      type: text ? 'TEXT' : 'FRAME',
      absoluteBoundingBox: e.box,
      fills: paint(text ? e.color : e.backgroundColor),
      strokes: e.borderStyle !== 'none' && e.borderWidth > 0 ? paint(e.borderColor) : [],
      strokeWeight: e.borderWidth,
      cornerRadius: e.radius,
      ...(LAYOUT[figma] ? { layoutMode: LAYOUT[figma], itemSpacing: 0 } : {}),
      ...(text ? { style: { fontFamily: 'Inter', fontSize: e.fontSize, fontWeight: e.fontWeight, lineHeightPx: e.lineHeight ?? undefined, letterSpacing: e.letterSpacing } } : {}),
      children: [],
    };
    if (figma) nodes[figma.split('/').slice(0, -1).join('/')].children.push(nodes[figma]);
  }
  return nodes[''];
}

// Reference = the committed base rendered by the gate itself.
{
  const base = clone('reference');
  const { bundleScene, launchBrowser, renderScene } = await import('../visual/lib/render.mjs');
  const scene = scenes.scenes[0];
  const { code } = await bundleScene({ trusted: TRUSTED, head: base, scene });
  const browser = await launchBrowser();
  try {
    const { png, measured } = await renderScene({ browser, trusted: TRUSTED, scene, code, selectors: HERO_MAP.map((m) => m.selector) });
    writeFileSync(join(TRUSTED, 'governance/visual', scene.baseline), png);
    // Node snapshot = the base render's own layout, expressed as Figma nodes,
    // so the structural check is tested independently of the real Figma data.
    writeFileSync(
      join(TRUSTED, 'governance/visual', scene.baseline.replace(/\.png$/, '.figma.json')),
      JSON.stringify({ root: (await import('../visual/lib/structure.mjs')).trimFigmaNode(figmaTreeFromRender(measured)) }),
    );
    scene.structure = { mode: 'enforce', map: HERO_MAP };
    writeFileSync(scenesPath, JSON.stringify(scenes));
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

// ---- structural check ----------------------------------------------------------
import { compareStructure, cssColour, findNode, trimFigmaNode } from '../visual/lib/structure.mjs';

const figmaColour = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a: 1 });
const fill = (hex) => [{ type: 'SOLID', color: figmaColour(hex) }];
// A Figma REST node tree: a vertical frame holding a title and a row of two buttons.
const figmaFrame = () => ({
  id: '1:1', name: 'Hero', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 50, width: 400, height: 200 },
  layoutMode: 'VERTICAL', itemSpacing: 32, paddingTop: 40, paddingBottom: 40, fills: fill('#f5f5f5'),
  children: [
    { id: '1:2', name: 'Title', type: 'TEXT', characters: 'Title', absoluteBoundingBox: { x: 260, y: 90, width: 80, height: 40 },
      fills: fill('#1e1e1e'), style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeightPx: 40, letterSpacing: 0 } },
    { id: '1:3', name: 'Buttons', type: 'FRAME', absoluteBoundingBox: { x: 200, y: 162, width: 200, height: 40 },
      layoutMode: 'HORIZONTAL', itemSpacing: 16, fills: [],
      children: [
        { id: '1:4', name: 'Button', type: 'INSTANCE', absoluteBoundingBox: { x: 200, y: 162, width: 92, height: 40 },
          fills: fill('#e3e3e3'), strokes: fill('#767676'), strokeWeight: 1, cornerRadius: 8 },
        { id: '1:5', name: 'Button', type: 'INSTANCE', absoluteBoundingBox: { x: 308, y: 162, width: 92, height: 40 },
          fills: fill('#2c2c2c'), strokes: [], cornerRadius: 8 },
      ] },
  ],
});
const MAP = [
  { figma: '', selector: ':scope', name: 'Section' },
  { figma: 'Title', selector: 'h1' },
  { figma: 'Buttons', selector: '.row' },
  { figma: 'Buttons/Button#1', selector: '.secondary', name: 'Secondary button' },
  { figma: 'Buttons/Button#2', selector: '.primary', name: 'Primary button' },
];
const el = (x, y, width, height, extra = {}) => ({
  box: { x, y, width, height }, backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(30, 30, 30)', borderWidth: 0,
  borderStyle: 'none', borderColor: 'rgb(0, 0, 0)', radius: 0, fontFamily: 'Inter, sans-serif', fontSize: 16,
  fontWeight: 400, lineHeight: null, letterSpacing: 0, ...extra,
});
// A render that matches the frame above exactly.
const matching = () => ({
  ':scope': el(0, 0, 400, 200, { backgroundColor: 'rgb(245, 245, 245)' }),
  h1: el(155, 40, 90, 40, { fontSize: 32, fontWeight: 700, lineHeight: 40 }),
  '.row': el(100, 112, 200, 40),
  '.secondary': el(100, 112, 92, 40, { backgroundColor: 'rgb(227, 227, 227)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgb(118, 118, 118)', radius: 8 }),
  '.primary': el(208, 112, 92, 40, { backgroundColor: 'rgb(44, 44, 44)', radius: 8 }),
});

test('structure: trims a Figma node tree to frame-relative boxes and styles', () => {
  const t = trimFigmaNode(figmaFrame());
  assert.deepEqual(t.box, { x: 0, y: 0, width: 400, height: 200 });
  assert.deepEqual(t.layout, { mode: 'VERTICAL', itemSpacing: 32, padding: [40, 0, 40, 0] });
  assert.equal(t.fill.hex, '#f5f5f5');
  const secondary = findNode(t, 'Buttons/Button#1');
  assert.deepEqual(secondary.box, { x: 100, y: 112, width: 92, height: 40 });
  assert.deepEqual(secondary.stroke, { hex: '#767676', opacity: 1, weight: 1 });
  assert.equal(findNode(t, '1:5').fill.hex, '#2c2c2c');
  assert.equal(findNode(t, 'Title').text.fontWeight, 700);
  assert.equal(findNode(t, 'Nope'), null);
});

test('structure: a matching render has no findings', () => {
  const r = compareStructure(trimFigmaNode(figmaFrame()), matching(), MAP);
  assert.deepEqual(r.findings.map((f) => f.message), []);
  assert.equal(r.checked, 5);
});

test('structure: names each wrong property with both values', () => {
  const m = matching();
  m[':scope'].backgroundColor = 'rgb(255, 255, 255)';
  m.h1.color = 'rgb(117, 117, 117)';
  m.h1.fontSize = 28;
  m['.secondary'].borderStyle = 'none';
  m['.secondary'].borderWidth = 0;
  m['.secondary'].box.width = 73;
  m['.primary'].box.x = 185; // 12px gap after the 73px button, instead of 16
  const msgs = compareStructure(trimFigmaNode(figmaFrame()), m, MAP).findings.map((f) => f.message);
  for (const want of [
    'Section: background #ffffff, Figma #f5f5f5',
    'Title: text colour #757575, Figma #1e1e1e',
    'Title: font size 28px, Figma 32px',
    'Secondary button: border none, Figma 1px #767676',
    'Secondary button: width 73px, Figma 92px',
    'Buttons: gap between Secondary button and Primary button 12px, Figma 16px (itemSpacing 16px)',
  ]) {
    assert.ok(msgs.includes(want), `missing "${want}" in:\n${msgs.join('\n')}`);
  }
});

test('structure: a missing element and an unknown layer are reported', () => {
  const m = matching();
  delete m['.primary'];
  const r = compareStructure(trimFigmaNode(figmaFrame()), { ...m, '.primary': null }, [...MAP, { figma: 'Ghost', selector: '.ghost' }]);
  assert.ok(r.findings.some((f) => f.message.startsWith('Primary button: element missing')));
  assert.match(r.errors.join('\n'), /"Ghost" isn't in the snapshot/);
});

test('structure: parses computed colours', () => {
  assert.deepEqual(cssColour('rgb(245, 245, 245)'), { hex: '#f5f5f5', opacity: 1 });
  assert.deepEqual(cssColour('rgba(0, 0, 0, 0)'), { hex: '#000000', opacity: 0 });
});

test('BLOCK (structural): PR that changes a font weight names the layer and both values', () => {
  expectBlock(
    scenario('weight', (d) => edit(d, HERO, (s) => s.replace('fontSize: tokens.font.subtitle, fontWeight: tokens.font.weightRegular', 'fontSize: tokens.font.subtitle, fontWeight: tokens.font.weightBold'))),
    /Subtitle: font weight 700, Figma 400/,
  );
});

test('BLOCK (structural): PR that changes a gap names the gap and both sizes', () => {
  expectBlock(
    scenario('gap', (d) => edit(d, HERO, (s) => s.replace('gap: tokens.space.md', 'gap: tokens.space.sm'))),
    /Buttons: gap between Secondary button and Primary button \d+px, Figma \d+px/,
  );
});

// ---- token hints ---------------------------------------------------------------
import { makeVariableHint, parseTokens } from '../visual/lib/tokens.mjs';

test('tokens: parses tokens.ts groups, one-line groups and the SDS variable comments', () => {
  const t = parseTokens(readFileSync(join(REPO, 'packages/design-system/src/tokens/tokens.ts'), 'utf8'));
  const find = (p) => t.find((x) => x.path === p);
  assert.deepEqual(find('tokens.color.textSecondary'), { path: 'tokens.color.textSecondary', value: '#757575', variable: 'Text/Default/Secondary' });
  assert.equal(find('tokens.space.xxl').variable, 'Space/800');
  assert.equal(find('tokens.radius.md').variable, 'Radius/200');
  assert.equal(find('tokens.font.subtitle').variable, 'Subtitle/Size/Base');
});

test('tokens: a finding names the Figma variable and the token to use, or says none exists', () => {
  const variables = JSON.parse(readFileSync(join(REPO, 'governance/visual/figma-variables.json'), 'utf8')).variables;
  const hint = makeVariableHint(variables, parseTokens(readFileSync(join(REPO, 'packages/design-system/src/tokens/tokens.ts'), 'utf8')));
  assert.equal(hint('VariableID:3919:36451'), ' → Figma variable Text/Default/Secondary; use tokens.color.textSecondary');
  assert.equal(hint('VariableID:66:10177'), ' → Figma variable Subtitle/Size Base; use tokens.font.subtitle');
  assert.match(hint('VariableID:3919:36424'), /Background\/Default\/Secondary \(#f5f5f5\); no design-system token maps to it yet/);
  assert.equal(hint('VariableID:0:0'), '');

  const snap = trimFigmaNode(figmaFrame());
  findNode(snap, 'Title').variables = { fills: ['VariableID:3919:36451'] };
  const m = matching();
  m.h1.color = 'rgb(0, 0, 0)';
  const [f] = compareStructure(snap, m, MAP, {}, { variableHint: hint }).findings;
  assert.equal(f.variable, 'VariableID:3919:36451');
  assert.match(f.message, /Title: text colour #000000, Figma #1e1e1e → Figma variable Text\/Default\/Secondary; use tokens\.color\.textSecondary/);
});
