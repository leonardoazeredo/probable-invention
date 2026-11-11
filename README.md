# probable-invention

A reference frontend monorepo where coding agents can work without eroding the
design system. It's React + TypeScript with pnpm workspaces, and the governance
gates are built in from the first commit.

```
packages/design-system   canonical primitives + tokens, Storybook, API report
apps/web                 feature code; composes the design system only
governance/              the judge, the debt scanner and ratchet, budgets, docs
```

## What's enforced

| Gate | Stops |
| --- | --- |
| **Public API** (API Extractor) | Unreviewed additions to the shared vocabulary |
| **Feature boundary** (ESLint) | Alternative primitives in feature code: native interactive elements, widget roles, polymorphic `as=`, `styled`/`createElement` of primitives, headless/styling libraries, deep imports, raw colours |
| **Debt ratchet** | Quality gates eroding through suppressions, inline disables, inline config, severity downgrades, ignore patterns or a11y opt-outs, counted tree-wide per rule, merge base vs head |
| **Base-branch judge** | A PR weakening the rules that judge it. `governance/trusted` runs from `main` and never executes PR code |
| **Accessibility** | axe violations in any story (`a11y.test: 'error'`) |

What it deliberately does **not** claim: that semantic duplication is
eliminated. See [governance/CONTROLS.md](governance/CONTROLS.md) for the
classification of every control and its known limits.

## Commands

```sh
pnpm install
pnpm build && pnpm typecheck && pnpm lint
pnpm api:check          # fail if the design-system API report is stale
pnpm api:update         # regenerate it after an intended API change
pnpm debt               # print the debt measurement for this tree
pnpm test:governance    # acceptance suite: block and pass scenarios
pnpm test:a11y          # Storybook stories under axe (needs Playwright Chromium)
pnpm storybook
```

## Turning it on

1. Merge this to `main`. The trusted workflow only runs from the base branch.
2. Decide the agent's credential and apply the ruleset:
   [governance/RULESET.md](governance/RULESET.md).
3. Run the canary drill as the agent: [governance/CANARY.md](governance/CANARY.md).
   Only then reclassify controls from *instrumented* to *preventive*.

Agents: read [AGENTS.md](AGENTS.md).

Drill 1 canary.
