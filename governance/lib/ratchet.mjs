// The ratchet invariant. Pure function so the acceptance tests can drive it.
//
//   1. Delta, not ceiling: debt is recomputed from source at the merge base
//      and at head. The allowance for each key is the *merge-base* budget —
//      never the budget in the PR under review, so a PR cannot authorise
//      its own debt.
//   2. Tight: governance/budget.json starts equal to measured debt. When a PR
//      pays debt down, it must lower the budget to match in the same PR
//      (reductions lock in).
//   3. Raises only by a single-purpose PR that changes governance/budget.json
//      and nothing else (CODEOWNERS makes that PR need an owner's approval).
export const BUDGET_PATH = 'governance/budget.json';

/**
 * @param {object} p
 * @param {Record<string, number>} p.debtBase   debt measured at merge base
 * @param {Record<string, number>} p.debtHead   debt measured at head
 * @param {Record<string, number>} p.budgetBase budget.json at merge base
 * @param {Record<string, number>} p.budgetHead budget.json at head
 * @param {string[]} p.changedFiles             files changed merge-base..head
 */
export function evaluateRatchet({ debtBase, debtHead, budgetBase, budgetHead, changedFiles }) {
  const failures = [];
  const notes = [];
  const budgetChanged = changedFiles.includes(BUDGET_PATH);
  const raisePr = budgetChanged && changedFiles.length === 1;
  const keys = new Set([
    ...Object.keys(debtBase),
    ...Object.keys(debtHead),
    ...Object.keys(budgetBase),
    ...Object.keys(budgetHead),
  ]);

  for (const k of [...keys].sort()) {
    const dB = debtBase[k] ?? 0;
    const dH = debtHead[k] ?? 0;
    const bB = budgetBase[k] ?? 0;
    const bH = budgetHead[k] ?? 0;

    if (bH > bB && !raisePr) {
      failures.push(
        `${k}: budget raised ${bB} -> ${bH} in a PR that also changes other files. ` +
          `Raise budgets only in a separate PR that touches ${BUDGET_PATH} alone.`,
      );
    }
    if (dH > bB) {
      failures.push(
        `${k}: debt ${dB} -> ${dH} exceeds the merge-base budget of ${bB}. ` +
          `Fix the violation, or get a budget raise approved in its own PR first.`,
      );
    }
    if (dH < dB && bH > dH) {
      failures.push(
        `${k}: debt paid down ${dB} -> ${dH}. Lower ${BUDGET_PATH} "${k}" to ${dH} in this PR so the reduction locks in.`,
      );
    }
    if (bH < dH && !failures.some((f) => f.startsWith(`${k}:`))) {
      failures.push(`${k}: budget ${bH} is below measured debt ${dH}.`);
    }
    if (bB > dB && dH <= bB && !raisePr) {
      notes.push(`${k}: ${bB - dH} unit(s) of approved slack remain.`);
    }
  }
  return { ok: failures.length === 0, failures, notes, raisePr };
}
