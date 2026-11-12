// The values and Excel number formats of the Home tables' columns, as the Model sheet has them:
// shared by the on-screen tables and the Excel export.

import MODEL_FORMATS from '@/engine/generated/model-formats.json';
import { FIELD_BY_LABEL, type Scenario } from '@/engine/model-schema';
import type { CellOut } from '@/engine/protocol';

import { cfTotal, type Loan } from './measures';

const CF_TOTAL = /^(Perf|Payoff|REO|NPL) CF Total$/;

/** A loan's value in a report column (the CF Total columns are sums of the monthly cash flows). */
export const cellOf = (l: Loan, label: string): CellOut => {
  const m = CF_TOTAL.exec(label);
  if (m) return cfTotal(l, m[1] as Scenario);
  return l.values[FIELD_BY_LABEL[label].col];
};

/** The report's format of a column; empty for text columns. */
export const fmtOf = (label: string) => (CF_TOTAL.test(label) ? '#,##0.00' : FIELD_BY_LABEL[label].fmt);

export type SheetRow = 'loan' | 'average' | 'total';
const SHEET_FORMATS = MODEL_FORMATS as Record<string, Record<SheetRow, string>>;

/**
 * The Model sheet's Excel number format of a column's loan, Average or Total cells (the latter two
 * fall back to the loan format); empty where the sheet leaves the column at General.
 */
export function sheetFormat(label: string, row: SheetRow = 'loan'): string {
  const formats = FIELD_BY_LABEL[label] && SHEET_FORMATS[FIELD_BY_LABEL[label].col];
  return formats ? (row === 'loan' ? formats.loan : formats[row] || formats.loan) : '';
}
