// Which Model-sheet cells the app reads and which ones users may override. The field list
// comes from the GITSITFINAL Power BI report (see report-fields.ts).

import { ASSUMPTIONS } from './assumptions.ts';
import { REPORT_FIELDS, type ReportField } from './report-fields.ts';

export type ValueKind = 'text' | 'money' | 'pct' | 'number' | 'multiple' | 'flag' | 'date';

export interface LoanField extends ReportField {
  kind: ValueKind;
  /** Allowed values for editable text fields. */
  options?: string[];
}

function kindOf(f: ReportField): ValueKind {
  if (f.fmt.includes('%')) return 'pct';
  if (f.fmt.includes('/')) return 'date';
  if (f.fmt.startsWith('#,##0.00')) return 'money';
  if (/^0\.0+$/.test(f.fmt) && /Hurdle|ROI|Return/.test(f.label)) return 'multiple';
  if (f.fmt === '0' && /^Is /.test(f.label)) return 'flag';
  if (f.fmt) return 'number';
  return 'text';
}

export const LOAN_FIELDS: LoanField[] = REPORT_FIELDS.map((f) => ({
  ...f,
  kind: kindOf(f),
  ...(f.col === 'QG' ? { options: ['YTM', 'RI', 'Plan'] } : {}),
}));

export const FIELD_BY_LABEL: Record<string, LoanField> = Object.fromEntries(LOAN_FIELDS.map((f) => [f.label, f]));
export const FIELD_BY_COL: Record<string, LoanField> = Object.fromEntries(
  [...LOAN_FIELDS].reverse().map((f) => [f.col, f]),
);
export const EDITABLE_COLS = new Set(LOAN_FIELDS.filter((f) => f.editable).map((f) => f.col));
/** Distinct Model columns the worker reads for each loan. */
export const LOAN_COLS = [...new Set(LOAN_FIELDS.map((f) => f.col))];

/** 36-month cash-flow strips (row 8 holds the month-end dates). */
export const STRIPS = { Perf: 'ABM', Payoff: 'AED', REO: 'AGZ', NPL: 'AJO' } as const;
export type Scenario = keyof typeof STRIPS;
export const STRIP_MONTHS = 36;

/** Assumption cells with a row number can be read live from the model. */
export const ASSUMPTION_CELLS = ASSUMPTIONS.map((a) => a.cell).filter((c) => /\d$/.test(c));

export interface PoolMetric {
  key: string;
  label: string;
  /** Model cell, e.g. CF9 (row 9 holds the visible-loan totals). */
  cell: string;
}

/** Pool totals the build script checks against the values Excel saved in the workbook. */
export const POOL_METRICS: PoolMetric[] = [
  { key: 'loans', label: 'Loans', cell: 'F9' },
  { key: 'upb', label: 'Total UPB', cell: 'R9' },
  { key: 'payoff', label: 'Total payoff', cell: 'W9' },
  { key: 'bpo', label: 'BPO as-is', cell: 'Y9' },
  { key: 'faded', label: 'Faded value', cell: 'AK9' },
  { key: 'maxValue', label: 'Max value', cell: 'AL9' },
  { key: 'bid', label: 'Bid', cell: 'CF9' },
  { key: 'proceeds', label: 'Gross proceeds', cell: 'CG9' },
  { key: 'llExp', label: 'LL (exp)/inc', cell: 'CH9' },
  { key: 'gain', label: 'Gross gain', cell: 'CI9' },
  { key: 'margin', label: 'Gross margin', cell: 'CJ9' },
  { key: 'months', label: 'Months (bid-wtd)', cell: 'CK9' },
  { key: 'irr', label: 'Gross IRR', cell: 'CL9' },
];
