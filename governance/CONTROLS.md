# Control register

Every control has one of three classifications. A control's classification is
what's been demonstrated, not what was designed.

- **Preventive**: an unauthorised change can't merge, and the agent's
  credential can't switch the control off.
- **Tamper-evident**: changes are blocked or flagged for review, but an admin
  can bypass them.
- **Instrumented**: measured and reported, doesn't block.

Current status: **ruleset not applied and canary not run, so everything is
instrumented** until [CANARY.md](CANARY.md) has results.

| Control | Where | Designed as | Demonstrated | Owner | Review date |
| --- | --- | --- | --- | --- | --- |
| Base-branch judge (`governance/trusted`): lints PR code with the base config, never runs PR code | `.github/workflows/governance-trusted.yml`, `governance/trusted-check.mjs` | Preventive | Instrumented | _ | _ |
| Public API gate: API Extractor report diffed against the merge base; changes need design-system owner | `packages/design-system/etc/*.api.md` | Preventive | Instrumented | _ | _ |
| Feature boundary: no styling/headless-UI libraries, no deep imports, no native primitive elements, widget roles, `as=` onto primitives, `createElement`/`styled` of primitives, positive tabIndex, raw colours | `eslint.config.js` | Preventive | Instrumented | _ | _ |
| Debt ratchet: suppressions file + inline disables + inline config + severity downgrades + ignored files + a11y opt-outs, tree-wide per rule, base vs head, budget from merge base, raises only in budget-only PRs, paydowns must lock in | `governance/lib/{scan,ratchet}.mjs`, `governance/budget.json` | Preventive | Instrumented | _ | _ |
| Impostor guard: PR workflows may not declare the required check's name | `governance/trusted-check.mjs` | Preventive | Instrumented | _ | _ |
| Accessibility: axe on every story, `a11y.test: 'error'` by default | `packages/design-system/.storybook/preview.ts`, `ci.yml` | Preventive (via `build-and-test`) | Instrumented | _ | _ |
| CODEOWNERS on enforcement and shared-vocabulary files | `.github/CODEOWNERS` | Tamper-evident | Instrumented | _ | _ |

## Known limits (say these out loud)

- **Semantic duplication isn't detected.** A feature component that rebuilds a
  primitive's *behaviour* without any of the banned constructs passes. The AST
  rules catch named evasions; passing them isn't evidence of compliance.
- **Severity changes in `eslint.config.js` aren't measured on the PR that makes
  them**, because the judge never loads PR config. They're governed by
  CODEOWNERS, and they take effect only after an owner approves the merge.
- **`build-and-test` runs PR code**, so a PR can edit `ci.yml`. The a11y gate is
  therefore only as strong as CODEOWNERS on `.github/`. Moving axe into the
  trusted job would mean executing PR code there, which it's designed never to do.
- **The impostor guard is name-based.** Test 3 in the canary drill is what
  proves GitHub doesn't accept an impostor run.
