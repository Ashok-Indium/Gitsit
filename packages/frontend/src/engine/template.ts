// The bundled model: every sheet of the workbook with formulas rewritten for HyperFormula,
// except the SUBTOTAL formulas, which depend on which loan rows are in use and are rewritten
// once the input loans are loaded. Loan-row formulas are compressed: SAME_AS_ABOVE means
// "the formula in the cell above, with relative references shifted down one row".

import { translateFormula } from './formula-text.ts';
import type { Cell, DefinedName, SheetData } from './rewrite.ts';

export const SAME_AS_ABOVE = '\u0001';

export interface ModelTemplate {
  version: 2;
  generatedAt: string;
  sourceModel: string;
  sourceTape: string;
  /** Sheets in workbook order. */
  sheetOrder: string[];
  sheets: Record<string, SheetData>;
  /** Workbook names, for the SUBTOTAL rewrite. */
  names: DefinedName[];
  /** 1-based Model rows holding the bundled tape's loans, in tape order. */
  loanRows: number[];
  /** 1-based rows excluded from SUBTOTAL for the bundled tape (empty loan slots). */
  hiddenRows: number[];
  /** The Model rows that can hold a loan (1-based, inclusive). */
  slots: { first: number; last: number };
  /** Input tape headers in order, and the 0-based Model column each one loads into (-1: unused). */
  tapeHeaders: string[];
  tapeColumns: number[];
  /** Values the model has typed into a loan's row outside the tape, by Loan ID and column. */
  loanConstants: Record<string, Record<string, Cell>>;
  /** Typed-in columns (e.g. Bid_calc): the value a loan's row gets unless it has its own. */
  loanDefaults: Record<string, Cell>;
  /** What those columns hold in an empty slot (e.g. Bid_calc "Zero"). */
  emptyDefaults: Record<string, Cell>;
  /** Formulas only rows in use carry, as written in the first slot row; empty slots have none. */
  fillFormulas: Record<string, string>;
  /** Loans the workbook leaves without some of those formulas, by Loan ID. */
  loanNoFill: Record<string, string[]>;
  /** Model row-10 headers by column letter, for the columns the app reads. */
  headers: Record<string, string>;
}

export function compressSheet(rows: SheetData): SheetData {
  return rows.map((row, r) => row.map((v, c) => {
    if (r === 0 || typeof v !== 'string' || !v.startsWith('=')) return v;
    const above = rows[r - 1]?.[c];
    return typeof above === 'string' && above.startsWith('=') && translateFormula(above, 1, 0) === v ? SAME_AS_ABOVE : v;
  }));
}

export function expandSheet(rows: SheetData): SheetData {
  const out: SheetData = [];
  rows.forEach((row, r) => {
    out[r] = row.map((v, c): Cell => {
      if (v !== SAME_AS_ABOVE) return v;
      return translateFormula(out[r - 1][c] as string, 1, 0);
    });
  });
  return out;
}
