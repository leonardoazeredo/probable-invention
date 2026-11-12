// System-level acceptance suite for governance/trusted-check.mjs.
//
// Each scenario clones this repository, applies a change as a PR branch, and
// runs the trusted check with THIS checkout as the trusted base. Scenarios
// cover both directions: things that must be blocked and legitimate work that
// must pass. Forge-level behaviour (identity, approval-then-push, check
// impersonation at the GitHub level) is not testable here; see
// governance/CANARY.md for that drill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK = join(REPO, 'governance/trusted-check.mjs');
const FEATURE = 'apps/web/src/features/checkout';

const sh = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const git = (cwd, ...args) =>
  sh(cwd, 'git', '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args);

// The suite judges committed state; refuse to run against a dirty tree so a
// result can't come from uncommitted trusted code.
const dirty = sh(REPO, 'git', 'status', '--porcelain', '--untracked-files=no');
if (dirty) console.warn(`warning: trusted checkout has uncommitted changes:\n${dirty}`);

function write(dir, rel, text) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** Clone, optionally build a base commit, apply the PR change, run the check. */
function scenario({ base, pr }) {
  const root = mkdtempSync(join(tmpdir(), 'gov-accept-'));
  const dir = join(root, 'head');
  git(REPO, 'clone', '-q', '--no-local', REPO, dir);
  if (base) {
    base(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
  }
  const baseSha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-qb', 'pr');
  pr(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'pr', '--allow-empty');
  const r = spawnSync('node', [CHECK, '--trusted', REPO, '--head', dir, '--base', baseSha], {
    encoding: 'utf8',
  });
  rmSync(root, { recursive: true, force: true });
  return { pass: r.status === 0, out: r.stdout + r.stderr };
}

/** Regenerate the API report in a clone the way a developer would (pnpm api:update). */
function regenerateApiReport(d) {
  const ds = join(d, 'packages/design-system');
  const links = [join(d, 'node_modules'), join(ds, 'node_modules')];
  symlinkSync(join(REPO, 'node_modules'), links[0], 'dir');
  symlinkSync(join(REPO, 'packages/design-system/node_modules'), links[1], 'dir');
  try {
    sh(ds, join(ds, 'node_modules/.bin/tsc'), '-p', 'tsconfig.build.json');
    sh(ds, join(ds, 'node_modules/.bin/api-extractor'), 'run', '--local');
  } finally {
    for (const l of links) rmSync(l, { force: true });
    rmSync(join(ds, 'dist'), { recursive: true, force: true });
    rmSync(join(ds, 'temp'), { recursive: true, force: true });
  }
}

const expectBlock = (r, re) => {
  assert.equal(r.pass, false, `expected BLOCK, got PASS:\n${r.out}`);
  if (re) assert.match(r.out, re);
};
const expectPass = (r) => assert.equal(r.pass, true, `expected PASS, got BLOCK:\n${r.out}`);

const component = (body) => `import { Button, tokens } from '@pi/design-system';\nvoid Button; void tokens;\n${body}\n`;
const exportLine = "export const Extra = 1;\n";
const budget = (obj) => JSON.stringify(obj, null, 2) + '\n';
const DISABLED = component(
  "// eslint-disable-next-line no-restricted-syntax -- legacy\nexport const Legacy = () => <button>x</button>;",
);

// ---- Shared API --------------------------------------------------------------
test('BLOCK: unapproved public export (API report not updated)', () => {
  expectBlock(
    scenario({ pr: (d) => appendFileSync(join(d, 'packages/design-system/src/index.ts'), exportLine) }),
    /public API changed/,
  );
});

test('PASS: public export with updated API report (owner review via CODEOWNERS)', () => {
  const r = scenario({
    pr: (d) => {
      appendFileSync(join(d, 'packages/design-system/src/index.ts'), exportLine);
      regenerateApiReport(d);
    },
  });
  expectPass(r);
  assert.match(r.out, /code-owner approval required/);
});

// ---- Alternative primitives in feature code ----------------------------------
for (const [name, body] of [
  ['raw <button>', 'export const X = () => <button>x</button>;'],
  ['role="button" on a div', 'export const X = () => <div role="button">x</div>;'],
  ['polymorphic as="button"', 'const Box = (p: { as: string }) => null;\nexport const X = () => <Box as="button" />;'],
  ['createElement("button") factory', "import { createElement } from 'react';\nexport const X = () => createElement('button');"],
  ['styled("button")', "declare const styled: (t: string) => unknown;\nexport const X = styled('button');"],
  ['styled.button', 'declare const styled: { button: unknown };\nexport const X = styled.button;'],
  ['headless-UI import', "import * as R from '@radix-ui/react-dialog';\nexport const X = R;"],
  ['deep import into design-system internals', "import { Button as B } from '@pi/design-system/src/button/Button';\nexport const X = B;"],
  ['raw colour value', "export const X = () => <p style={{ color: '#ff0000' }}>x</p>;"],
  ['positive tabIndex', 'export const X = () => <p tabIndex={3}>x</p>;'],
  ['same-file component wrapping a native button', 'function Submit() { return <button type="submit" />; }\nexport const X = Submit;'],
]) {
  test(`BLOCK: ${name} in feature code`, () => {
    expectBlock(scenario({ pr: (d) => write(d, `${FEATURE}/Alt.tsx`, component(body)) }), /ESLint/);
  });
}

test('PASS: legitimate composition (Button, aria-labelledby, forwardRef, createContext)', () => {
  const body = `import { forwardRef, createContext, useId } from 'react';
export const Ctx = createContext<string | null>(null);
export const Panel = forwardRef<HTMLElement, { onGo: () => void }>(function Panel({ onGo }, ref) {
  const id = useId();
  return (
    <section ref={ref} aria-labelledby={id} aria-describedby={id + '-d'} style={{ padding: tokens.space.md }}>
      <h3 id={id}>Shipping</h3>
      <p id={id + '-d'}>Choose a speed</p>
      <Button onClick={onGo}>Continue</Button>
    </section>
  );
});`;
  expectPass(scenario({ pr: (d) => write(d, `${FEATURE}/Panel.tsx`, component(body).replace("import { Button, tokens } from '@pi/design-system';\nvoid Button; void tokens;\n", "import { Button, tokens } from '@pi/design-system';\n")) }));
});

// ---- Config tampering ---------------------------------------------------------
test('BLOCK: PR turns the rule off in eslint.config.js and adds a violation (base config judges)', () => {
  expectBlock(
    scenario({
      pr: (d) => {
        const p = join(d, 'eslint.config.js');
        writeFileSync(p, readFileSync(p, 'utf8').replace("rules: featureBoundary", "rules: { 'no-restricted-syntax': 'off' }"));
        write(d, `${FEATURE}/Alt.tsx`, component('export const X = () => <button>x</button>;'));
      },
    }),
    /ESLint/,
  );
});

test('BLOCK: PR workflow that could impersonate the required check', () => {
  expectBlock(
    scenario({
      pr: (d) =>
        write(d, '.github/workflows/fake.yml', 'on: pull_request\njobs:\n  x:\n    name: governance/trusted\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 0\n'),
    }),
    /impersonate/,
  );
});

// ---- Suppression ratchet ------------------------------------------------------
test('BLOCK: new inline eslint-disable with no budget', () => {
  expectBlock(scenario({ pr: (d) => write(d, `${FEATURE}/Legacy.tsx`, DISABLED) }), /exceeds the merge-base budget/);
});

test('BLOCK: self-authorised debt (budget raise + violation in one PR)', () => {
  expectBlock(
    scenario({
      pr: (d) => {
        write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 }));
        write(d, `${FEATURE}/Legacy.tsx`, DISABLED);
      },
    }),
    /budget raised 0 -> 1 in a PR that also changes other files/,
  );
});

test('PASS: budget-only raise PR', () => {
  expectPass(scenario({ pr: (d) => write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 })) }));
});

test('PASS: follow-up PR consumes a previously approved raise', () => {
  expectPass(
    scenario({
      base: (d) => write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 })),
      pr: (d) => write(d, `${FEATURE}/Legacy.tsx`, DISABLED),
    }),
  );
});

test('PASS: moving a suppression to another file keeps aggregate debt flat', () => {
  expectPass(
    scenario({
      base: (d) => {
        write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 }));
        write(d, `${FEATURE}/Legacy.tsx`, DISABLED);
      },
      pr: (d) => {
        rmSync(join(d, `${FEATURE}/Legacy.tsx`));
        write(d, `${FEATURE}/Legacy2.tsx`, DISABLED);
      },
    }),
  );
});

test('BLOCK: paying debt down without lowering the budget', () => {
  expectBlock(
    scenario({
      base: (d) => {
        write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 }));
        write(d, `${FEATURE}/Legacy.tsx`, DISABLED);
      },
      pr: (d) => rmSync(join(d, `${FEATURE}/Legacy.tsx`)),
    }),
    /reduction locks in/,
  );
});

test('PASS: paying debt down and lowering the budget', () => {
  expectPass(
    scenario({
      base: (d) => {
        write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 }));
        write(d, `${FEATURE}/Legacy.tsx`, DISABLED);
      },
      pr: (d) => {
        rmSync(join(d, `${FEATURE}/Legacy.tsx`));
        write(d, 'governance/budget.json', budget({}));
      },
    }),
  );
});

test('BLOCK: replacing a suppression with a blanket inline config comment', () => {
  expectBlock(
    scenario({
      base: (d) => {
        write(d, 'governance/budget.json', budget({ 'inline:no-restricted-syntax': 1 }));
        write(d, `${FEATURE}/Legacy.tsx`, DISABLED);
      },
      pr: (d) =>
        write(
          d,
          `${FEATURE}/Legacy.tsx`,
          component("/* eslint no-restricted-syntax: off */\nexport const Legacy = () => <button>x</button>;"),
        ),
    }),
    /inline-config:no-restricted-syntax/,
  );
});

// ---- Accessibility ratchet ----------------------------------------------------
test('BLOCK: new story opts out of the a11y gate (todo)', () => {
  expectBlock(
    scenario({
      pr: (d) => {
        const p = join(d, 'packages/design-system/src/button/Button.stories.tsx');
        appendFileSync(p, "export const Quiet: Story = { parameters: { a11y: { test: 'todo' } } };\n");
      },
    }),
    /a11y:todo/,
  );
});

test('BLOCK: PR workflow that could impersonate the visual check', () => {
  expectBlock(
    scenario({
      pr: (d) =>
        write(d, '.github/workflows/fake.yml', 'on: pull_request\njobs:\n  x:\n    name: governance/visual\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 0\n'),
    }),
    /impersonate/,
  );
});
