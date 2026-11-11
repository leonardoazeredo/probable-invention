// Debt scanner: measures every route by which lint/a11y enforcement can be
// weakened, so the ratchet can compare base and head on the same surface.
//
// Measurement surface (all keyed per rule, counted tree-wide, never per file —
// splitting a file must not reset a quota):
//   suppressions:<rule>   counts in eslint-suppressions.json (bulk suppressions)
//   inline:<rule>         eslint-disable / -line / -next-line comments ("*" = blanket)
//   inline-config:<rule>  /* eslint <rule>: off|warn */ comments
//   downgrade:<rule>      files where a governed rule's effective severity < error
//   ignored-files         tracked source files excluded from linting
//   a11y:<mode>           stories (or preview) with a11y.test set to todo/off
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SOURCE_RE = /\.(?:[cm]?js|tsx?)$/;
const DS_SRC = 'packages/design-system/src/';

function add(debt, key, n = 1) {
  debt[key] = (debt[key] ?? 0) + n;
}

export function listTrackedSources(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((f) => f && SOURCE_RE.test(f));
}

/** Count bulk suppressions (ESLint's eslint-suppressions.json). */
export function scanSuppressionFile(root, debt) {
  const file = join(root, 'eslint-suppressions.json');
  if (!existsSync(file)) return;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const rules of Object.values(data)) {
    for (const [rule, { count }] of Object.entries(rules)) add(debt, `suppressions:${rule}`, count);
  }
}

const DISABLE_RE = /\/[*/]\s*eslint-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/g;
const INLINE_CONFIG_RE = /\/\*\s*eslint\s+([^*]+?)\*\//g;

/** Count inline directives in one file's text. Exported for tests. */
export function scanInlineText(text, debt) {
  for (const m of text.matchAll(DISABLE_RE)) {
    let body = m[1].replace(/\*\/.*$/, '');
    body = body.split(/\s--\s|\s--$/)[0].trim();
    const rules = body ? body.split(',').map((r) => r.trim()).filter(Boolean) : ['*'];
    for (const r of rules) add(debt, `inline:${r}`);
  }
  for (const m of text.matchAll(INLINE_CONFIG_RE)) {
    const body = m[1].trim();
    if (/^(?:enable|disable)\b/.test(body) || body.startsWith('-')) continue;
    // "rule-a: off, rule-b: [1, ...]" — record any rule set below error.
    for (const part of body.split(/,(?![^[]*\])/)) {
      const mm = part.match(/^\s*([@\w/-]+)\s*:\s*(.+)$/);
      if (!mm) continue;
      const level = mm[2].trim().replace(/^\[\s*/, '').split(/[,\]]/)[0].trim().replace(/["']/g, '');
      if (!['2', 'error'].includes(level)) add(debt, `inline-config:${mm[1]}`);
    }
  }
}

const A11Y_RE = /a11y\s*:\s*\{[^}]*?\btest\s*:\s*['"](todo|off)['"]/gs;

export function scanA11yText(text, debt) {
  for (const m of text.matchAll(A11Y_RE)) add(debt, `a11y:${m[1]}`);
}

async function scanEslintSurface(root, files, debt) {
  const eslintEntry = createRequire(join(root, 'package.json')).resolve('eslint');
  const { ESLint } = await import(pathToFileURL(eslintEntry).href);
  const eslint = new ESLint({ cwd: root });
  const probes = {
    ds: `${DS_SRC}__governance_probe__.tsx`,
    feature: 'apps/__governance_probe__/probe.tsx',
  };
  const governed = {};
  for (const [territory, probe] of Object.entries(probes)) {
    const cfg = await eslint.calculateConfigForFile(probe);
    governed[territory] = Object.entries(cfg?.rules ?? {})
      .filter(([, v]) => severityOf(v) === 2)
      .map(([k]) => k);
  }
  for (const file of files) {
    if (await eslint.isPathIgnored(file)) {
      if (!file.startsWith('governance/tests/fixtures/')) add(debt, 'ignored-files');
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    const cfg = await eslint.calculateConfigForFile(file);
    const territory = file.startsWith(DS_SRC) ? 'ds' : 'feature';
    for (const rule of governed[territory]) {
      if (severityOf(cfg?.rules?.[rule]) < 2) add(debt, `downgrade:${rule}`);
    }
  }
}

function severityOf(v) {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === 'error' || s === 2) return 2;
  if (s === 'warn' || s === 1) return 1;
  return 0;
}

/** Scan a checked-out tree. `root` must have node_modules with eslint. */
export async function scanDebt(root, { eslintSurface = true } = {}) {
  const debt = {};
  const files = listTrackedSources(root);
  scanSuppressionFile(root, debt);
  for (const f of files) {
    if (f.startsWith('governance/')) continue; // the scanner's own patterns/fixtures
    const text = readFileSync(join(root, f), 'utf8');
    scanInlineText(text, debt);
    if (/\.stories\.tsx?$|\.storybook\/preview\.tsx?$/.test(f)) scanA11yText(text, debt);
  }
  if (eslintSurface) await scanEslintSurface(root, files, debt);
  return Object.fromEntries(Object.entries(debt).sort(([a], [b]) => a.localeCompare(b)));
}
