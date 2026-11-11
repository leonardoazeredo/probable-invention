#!/usr/bin/env node
// The single producer of the required "governance/trusted" status.
//
// Runs from the BASE branch's copy of this repository (pull_request_target), so
// a PR cannot edit the code that judges it. It never executes PR code: PR files
// are linted and type-compiled with the base branch's config and dependencies.
//
// Usage: node trusted-check.mjs --trusted <base checkout> --head <PR checkout>
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { scanDebt } from './lib/scan.mjs';
import { evaluateRatchet, BUDGET_PATH } from './lib/ratchet.mjs';

const { values } = parseArgs({
  options: { trusted: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' } },
});
const TRUSTED = resolve(values.trusted ?? '.');
const HEAD = resolve(values.head ?? '.');
const CHECK_NAME = 'governance/trusted';
const DS = 'packages/design-system';

// Files the PR may change only with code-owner approval, and which are always
// taken from the base branch when judging the PR.
const OVERLAY = ['eslint.config.js', 'governance', 'packages/design-system/api-extractor.json'];
const PROTECTED_RE =
  /^(?:\.github\/|CODEOWNERS$|eslint\.config\.|governance\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|.*\/package\.json$|.*api-extractor\.json$|.*\.api\.md$|.*\.storybook\/)/;

const failures = [];
const notes = [];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gitShow = (cwd, spec, fallback = '') => {
  try {
    return execFileSync('git', ['show', spec], { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return fallback;
  }
};

// ---- 1. merge base and diff --------------------------------------------------
const baseRef = values.base ?? git(TRUSTED, 'rev-parse', 'HEAD');
const mergeBase = git(HEAD, 'merge-base', baseRef, 'HEAD');
const changedFiles = git(HEAD, 'diff', '--name-only', `${mergeBase}...HEAD`).split('\n').filter(Boolean);
notes.push(`merge base ${mergeBase.slice(0, 12)}; ${changedFiles.length} file(s) changed`);

const protectedChanges = changedFiles.filter((f) => PROTECTED_RE.test(f));
if (protectedChanges.length) {
  notes.push(`Protected files changed (code-owner approval required): ${protectedChanges.join(', ')}`);
}

// ---- 2. impostor guard -------------------------------------------------------
// A PR-added workflow can emit a check with the same name under the same
// GitHub Actions app identity. Refuse any workflow change that declares it.
for (const f of changedFiles.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) {
  const p = join(HEAD, f);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8');
  if (f !== '.github/workflows/governance-trusted.yml' && /governance\/trusted|governance-trusted/.test(text)) {
    failures.push(`${f} declares a job that could impersonate the required "${CHECK_NAME}" check.`);
  }
}

// ---- 3. build a judged tree: PR sources + base-branch tooling ----------------
// Materialise the merge base as a worktree too, for the baseline measurement.
const tmp = mkdtempSync(join(tmpdir(), 'governance-'));
const mbTree = join(tmp, 'merge-base');
git(HEAD, 'worktree', 'add', '--detach', mbTree, mergeBase);

function overlayTrusted(tree) {
  for (const p of OVERLAY) {
    rmSync(join(tree, p), { recursive: true, force: true });
    if (existsSync(join(TRUSTED, p))) cpSync(join(TRUSTED, p), join(tree, p), { recursive: true });
  }
  for (const nm of ['node_modules', 'packages/design-system/node_modules', 'apps/web/node_modules']) {
    if (!existsSync(join(TRUSTED, nm)) || !existsSync(join(tree, nm, '..'))) continue;
    rmSync(join(tree, nm), { recursive: true, force: true });
    symlinkSync(join(TRUSTED, nm), join(tree, nm), 'dir');
  }
}
overlayTrusted(HEAD);
overlayTrusted(mbTree);

const run = (cwd, cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message) };
  }
};
const bin = (name, pkg = '.') => join(TRUSTED, pkg, 'node_modules/.bin', name);

// ---- 4. lint gate (base config, PR sources) ----------------------------------
const lint = run(HEAD, bin('eslint'), ['.', '--max-warnings', '0']);
if (!lint.ok) failures.push(`ESLint (base-branch config) failed:\n${lint.out.trim()}`);

// ---- 5. ratchet (debt at merge base vs head, budget from merge base) ---------
// Budgets are read from git objects: the overlay replaced governance/ in both
// trees with the trusted copy, and the PR's working tree is not authoritative.
const budgetAt = (rev) => JSON.parse(gitShow(HEAD, `${rev}:${BUDGET_PATH}`, '{}'));
const debtBase = await scanDebt(mbTree);
const debtHead = await scanDebt(HEAD);
const ratchet = evaluateRatchet({
  debtBase,
  debtHead,
  budgetBase: budgetAt(mergeBase),
  budgetHead: budgetAt('HEAD'),
  changedFiles,
});
failures.push(...ratchet.failures);
notes.push(...ratchet.notes);

// ---- 6. public API gate (API Extractor, report from merge base) -------------
const tscOk = run(join(HEAD, DS), bin('tsc', DS), ['-p', 'tsconfig.build.json']);
if (!tscOk.ok) {
  failures.push(`Design-system declaration build failed:\n${tscOk.out.trim()}`);
} else {
  const ae = run(join(HEAD, DS), bin('api-extractor', DS), ['run', '--local']);
  if (!ae.ok) failures.push(`API Extractor failed:\n${ae.out.trim()}`);
  const generated = readFileSync(join(HEAD, DS, 'etc/design-system.api.md'), 'utf8');
  const committedHead = gitShow(HEAD, `HEAD:${DS}/etc/design-system.api.md`);
  const committedBase = gitShow(HEAD, `${mergeBase}:${DS}/etc/design-system.api.md`);
  const norm = (s) => s.replace(/\r\n/g, '\n').trim();
  if (norm(generated) !== norm(committedHead)) {
    failures.push(
      'Design-system public API changed but etc/design-system.api.md was not updated. Run `pnpm api:update` and commit it; the report change then needs design-system owner approval.',
    );
  } else if (norm(generated) !== norm(committedBase)) {
    notes.push('Design-system public API changed: design-system code-owner approval required (CODEOWNERS on *.api.md).');
  }
}

// ---- 7. report ---------------------------------------------------------------
git(HEAD, 'worktree', 'remove', '--force', mbTree);
const summary = [
  `## ${CHECK_NAME}: ${failures.length ? 'FAIL' : 'PASS'}`,
  '',
  ...(failures.length ? ['### Failures', ...failures.map((f) => `- ${f.replace(/\n/g, '\n  ')}`), ''] : []),
  '### Notes',
  ...notes.map((n) => `- ${n}`),
  '',
  '### Debt (merge base -> head)',
  '| key | base | head |',
  '| --- | ---: | ---: |',
  ...[...new Set([...Object.keys(debtBase), ...Object.keys(debtHead)])]
    .sort()
    .map((k) => `| ${k} | ${debtBase[k] ?? 0} | ${debtHead[k] ?? 0} |`),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
writeFileSync(join(HEAD, '..', 'governance-result.json'), JSON.stringify({ failures, notes, debtBase, debtHead }, null, 2));
process.exit(failures.length ? 1 : 0);
