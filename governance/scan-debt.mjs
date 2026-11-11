#!/usr/bin/env node
// Print the debt measurement for the current tree (report only).
// `node governance/scan-debt.mjs --write-budget` initialises governance/budget.json
// to exactly the measured debt (zero slack). Use only in a budget-only PR.
import { writeFileSync } from 'node:fs';
import { scanDebt } from './lib/scan.mjs';
import { BUDGET_PATH } from './lib/ratchet.mjs';

const debt = await scanDebt(process.cwd());
console.log(JSON.stringify(debt, null, 2));
if (process.argv.includes('--write-budget')) {
  writeFileSync(BUDGET_PATH, JSON.stringify(debt, null, 2) + '\n');
  console.error(`wrote ${BUDGET_PATH}`);
}
