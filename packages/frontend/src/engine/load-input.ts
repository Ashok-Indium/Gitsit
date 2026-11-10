// Loads input loans (Input_table rows) into the Model sheet's loan rows, the way the input tape
// is pasted into the workbook: one loan per row from the first slot, tape columns only, and
// the model's own formulas left alone. Unused slots are emptied and hidden from SUBTOTAL.

import { INPUT_COLUMNS } from '../store/generated/store-fields.ts';
import { colNum, translateFormula } from './formula-text.ts';
import type { Cell, SheetData } from './rewrite.ts';
import type { ModelTemplate } from './template.ts';

/** An Input_table row: values by table column name (loan_id, pool, as_of_date, …). */
export type InputRow = Record<string, unknown>;

export interface LoadedInput {
  /** 1-based Model rows that hold a loan, in input order. */
  loanRows: number[];
  /** 1-based Model rows left empty (excluded from SUBTOTAL). */
  hiddenRows: number[];
  /** Loan IDs that did not fit in the model. */
  dropped: string[];
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Loan IDs compare without leading zeros: the model has "0002008091" where the tape has 2008091. */
export const loanKey = (id: unknown) => String(id ?? '').trim().replace(/^0+(?=\d)/, '');
const isFormula = (v: Cell | undefined) => typeof v === 'string' && v.startsWith('=');

function toSerial(v: unknown): number | null {
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isNaN(ms) ? null : Math.round((ms - EXCEL_EPOCH) / 86400000);
}

/** A table value as the workbook would hold it. */
export function toCell(v: unknown, type: 'text' | 'decimal' | 'date', column: string): Cell {
  if (v == null || v === '') return null;
  if (type === 'decimal') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (type === 'date') return toSerial(v);
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // Excel reads the delinquency bucket "1-30" as January 1930; put the text back.
  if (column === 'seller_status') {
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (d) s = Number(d[3]) === 1 ? `${Number(d[2])}-${d[1].slice(2)}` : `${Number(d[2])}-${Number(d[3])}`;
  }
  // Numbers typed into text columns stay numbers, as they are in the tape; "0002007400" stays text.
  if (/^-?\d+(\.\d+)?$/.test(s) && String(Number(s)) === s) return Number(s);
  return "'" + s;
}

export function loadInput(model: SheetData, template: ModelTemplate, rows: InputRow[]): LoadedInput {
  const { first, last } = template.slots;
  if (INPUT_COLUMNS.length !== template.tapeHeaders.length || INPUT_COLUMNS.some((c, i) => c.header !== template.tapeHeaders[i])) {
    throw new Error('The Input_table columns no longer match the model. Rebuild the model and regenerate the tables.');
  }
  const capacity = last - first + 1;
  const loaded = rows.slice(0, capacity);
  const dropped = rows.slice(capacity).map((r) => String(r.loan_id ?? ''));

  for (let i = 0; i < capacity; i++) {
    const r = first + i;
    const row = (model[r - 1] ||= []);
    const input = loaded[i];
    // A row in use gets the model's per-loan formulas and defaults; an empty slot is set up
    // the way the workbook leaves its spare rows.
    const noFill = input ? template.loanNoFill[loanKey(input.loan_id)] ?? [] : [];
    for (const [col, f] of Object.entries(template.fillFormulas)) {
      const c = colNum(col) - 1;
      if (!input || noFill.includes(col)) delete row[c];
      else row[c] = translateFormula(f, r - first, 0);
    }
    for (const [col, v] of Object.entries(input ? template.loanDefaults : template.emptyDefaults)) {
      if (v === null) delete row[colNum(col) - 1];
      else row[colNum(col) - 1] = v;
    }
    INPUT_COLUMNS.forEach((col, j) => {
      const c = template.tapeColumns[j];
      if (c < 0 || isFormula(row[c])) return;
      const v = input ? toCell(input[col.name], col.type, col.name) : null;
      if (v === null) delete row[c];
      else row[c] = v;
    });
    // Values the model keeps per loan (e.g. a loan's own NPL hurdle) follow the loan, not the row.
    const constants = input ? template.loanConstants[loanKey(input.loan_id)] : undefined;
    for (const [col, v] of Object.entries(constants ?? {})) row[colNum(col) - 1] = v;
  }
  return {
    loanRows: loaded.map((_, i) => first + i),
    hiddenRows: Array.from({ length: capacity - loaded.length }, (_, i) => first + loaded.length + i),
    dropped,
  };
}
