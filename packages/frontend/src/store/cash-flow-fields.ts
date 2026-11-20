// What LoanModelMonthlies stores: one row per loan of an input file, with the four scenario
// sections of the DCF sheets (Perf, Payoff, REO, NPL) as columns, month by month: perf_cf_m01 …
// perf_cf_m36, payoff_cf_m01 … npl_cf_m36, and the file's type (NPL or BPL). Read by
// scripts/gen-entities.ts for the table and by the app when it saves a file's results.

import { MONTHLY_SERIES } from './generated/store-fields.ts';

/** The sections stored, with the prefix of their month columns. */
export const CASH_FLOW_SECTIONS = [
  { series: 'Perf CF', prefix: 'perf_cf' },
  { series: 'Payoff CF', prefix: 'payoff_cf' },
  { series: 'REO CF', prefix: 'reo_cf' },
  { series: 'NPL CF', prefix: 'npl_cf' },
] as const;

/** Each month column: its name in LoanModelMonthlies and the Model column it comes from. */
export const CASH_FLOW_COLUMNS: { name: string; col: string }[] = CASH_FLOW_SECTIONS.flatMap(({ series, prefix }) => {
  const s = MONTHLY_SERIES.find((x) => x.series === series);
  if (!s) throw new Error(`The Model sheet has no ${series} block`);
  return s.cols.map((col, i) => ({ name: `${prefix}_m${String(i + 1).padStart(2, '0')}`, col }));
});
