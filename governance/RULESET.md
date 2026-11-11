# Repository settings the gates depend on

The checks in this repo only block anything if GitHub enforces them. Until the
settings below are applied **and** the drill in [CANARY.md](CANARY.md) passes,
treat every control as *instrumented* (see [CONTROLS.md](CONTROLS.md)).

## Apply the ruleset (admin, ~5 minutes)

```sh
gh api -X POST repos/leonardoazeredo/probable-invention/rulesets --input governance/ruleset.json
```

What it sets on the default branch:

| Setting | Why |
| --- | --- |
| Pull request required, 1 approval | No direct pushes to `main` |
| Require review from code owners | Makes [CODEOWNERS](../.github/CODEOWNERS) a gate instead of a suggestion |
| Dismiss stale approvals on push | Approve-then-push can't carry an old approval forward |
| Require approval of the most recent push | Whoever pushed last can't be the only approver |
| Required checks `governance/trusted` and `build-and-test`, pinned to GitHub Actions (integration 15368) | A third-party app can't post a green status under those names |
| No bypass actors | Nobody is exempt, including admins acting through the UI |
| Block deletion and force-push | History can't be rewritten under the gates |

`governance/trusted` only runs once `.github/workflows/governance-trusted.yml`
is on `main` (it uses `pull_request_target`, which always runs the base-branch
copy). So the PR that introduces it can't be judged by it. Merge that PR first,
then apply the ruleset.

## The identity decision (blocking, not engineering)

Rulesets constrain *principals*. Before trusting any gate, write down which
credential the coding agent pushes and opens PRs with, and check it's none of:

- a repository admin, or anyone on a bypass list
- a code owner listed in CODEOWNERS
- the only human who can approve (on a single-maintainer repo, an agent that
  pushes with the maintainer's token makes "require approval of the most recent
  push" unsatisfiable *and* makes the maintainer's own approval meaningless)

The recommended setup is a separate bot account or GitHub App with **write**
(not admin, not maintain) access, used only by the agent. Record it here:

| Field | Value |
| --- | --- |
| Agent credential | _not yet decided_ |
| Permission level | _ |
| Signed off by / date | _ |

## Plan limits

This repository is public, so rulesets are available on any plan. If it goes
private on a Free plan, the rules can't be enforced, and every control stays
*instrumented*.
