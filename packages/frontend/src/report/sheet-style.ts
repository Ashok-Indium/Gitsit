// The Model sheet's colours for the Home tables (generated/model-styles.json, from
// scripts/gen-model-styles.ts): each column's header, Average, Total and loan-cell style, and the
// sheet's conditional formats, evaluated on the model's live values.

import type { CSSProperties } from 'react';

import MODEL_STYLES from '@/engine/generated/model-styles.json';
import { isError, type CellOut, type Override, type Snapshot } from '@/engine/protocol';

import type { Loan } from './measures';

export interface SheetStyle { fill?: string; color?: string; bold?: boolean; italic?: boolean }
type Ref = { col: string; row: 'loan' | 'average' | 'total' } | { cell: string };
type Expr = { n: number } | { s: string } | { ref: Ref } | { fn: string; args: Expr[] } | { op: string; a: Expr; b: Expr };
type Rule = { if: Expr; style: SheetStyle } | { duplicate: true; style: SheetStyle } | { scale: { at: number; color: string }[] };
interface ColumnStyle { header?: SheetStyle; average?: SheetStyle; total?: SheetStyle; loan?: SheetStyle; rules?: Rule[] }

// Its `cols` and `cells` (what the conditional formats read) are read by the engine.
const STYLES = MODEL_STYLES as unknown as {
  columns: Record<string, ColumnStyle>;
  /** How the sheet shows a value typed over a formula; the app shows overridden cells so. */
  override: SheetStyle;
};

/** What a loan cell's conditional formats are evaluated against. */
export interface SheetContext {
  snapshot: Snapshot;
  overrides: Map<string, Override>;
  /** Per column, the values more than one loan has (the sheet's duplicate-value rules). */
  duplicates: (col: string) => Set<string>;
}

type Value = number | string | boolean | null | { error: string };
const ERROR = { error: '#VALUE!' };
const err = (v: Value): v is { error: string } => v !== null && typeof v === 'object';

function read(ref: Ref, loan: Loan, snapshot: Snapshot): Value {
  const v: CellOut | undefined = 'cell' in ref ? snapshot.assumptions[ref.cell]
    : ref.row === 'loan' ? loan.values[ref.col] : snapshot.summary?.[ref.row][ref.col];
  return v === undefined ? null : v;
}

const num = (v: Value): number | null => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : v === null || v === '' ? 0 : null);
const truthy = (v: Value) => (typeof v === 'number' ? v !== 0 : v === true);

/** Excel's comparison: blank is 0 or "", text compares without case, numbers sort before text before booleans. */
function compare(op: string, a: Value, b: Value): Value {
  if (err(a)) return a;
  if (err(b)) return b;
  if (a === null) a = typeof b === 'string' ? '' : 0;
  if (b === null) b = typeof a === 'string' ? '' : 0;
  const rank = (v: Value) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  let d = rank(a) - rank(b);
  if (!d) d = typeof a === 'string' ? a.toLowerCase().localeCompare(String(b).toLowerCase()) : Number(a) - Number(b);
  switch (op) {
    case '=': return d === 0;
    case '<>': return d !== 0;
    case '<': return d < 0;
    case '>': return d > 0;
    case '<=': return d <= 0;
    default: return d >= 0;
  }
}

function evaluate(e: Expr, loan: Loan, ctx: SheetContext): Value {
  if ('n' in e) return e.n;
  if ('s' in e) return e.s;
  if ('ref' in e) return read(e.ref, loan, ctx.snapshot);
  if ('op' in e) {
    const a = evaluate(e.a, loan, ctx), b = evaluate(e.b, loan, ctx);
    if (!['+', '-', '*', '/'].includes(e.op)) return compare(e.op, a, b);
    if (err(a)) return a;
    if (err(b)) return b;
    const x = num(a), y = num(b);
    if (x === null || y === null) return ERROR;
    if (e.op === '/') return y === 0 ? { error: '#DIV/0!' } : x / y;
    return e.op === '+' ? x + y : e.op === '-' ? x - y : x * y;
  }
  const arg = (i: number) => (e.args[i] ? evaluate(e.args[i], loan, ctx) : false);
  switch (e.fn) {
    case 'IF': {
      const c = arg(0);
      return err(c) ? c : truthy(c) ? arg(1) : arg(2);
    }
    case 'NOT': { const v = arg(0); return err(v) ? v : !truthy(v); }
    case 'ISERROR': return err(arg(0));
    case 'ISBLANK': { const v = arg(0); return v === null || v === ''; }
    case 'ISFORMULA': {
      // Every Model loan cell is a formula unless the user has typed a value over it.
      const r = e.args[0];
      return !(r && 'ref' in r && 'col' in r.ref && ctx.overrides.has(`${r.ref.col}${loan.row}`));
    }
    case 'SEARCH': {
      const find = arg(0), within = arg(1);
      if (err(find) || err(within)) return ERROR;
      const at = String(within ?? '').toLowerCase().indexOf(String(find ?? '').toLowerCase());
      return at < 0 ? ERROR : at + 1;
    }
    default: return ERROR;
  }
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** A colour scale's colour for `v`, interpolated between its stops as Excel does. */
function scaleColor(stops: { at: number; color: string }[], v: number): string {
  if (v <= stops[0].at) return stops[0].color;
  const last = stops[stops.length - 1];
  if (v >= last.at) return last.color;
  const i = stops.findIndex((s) => v < s.at);
  const lo = stops[i - 1], hi = stops[i];
  const t = (v - lo.at) / (hi.at - lo.at);
  const [a, b] = [hex(lo.color), hex(hi.color)];
  return `#${a.map((x, k) => Math.round(x + (b[k] - x) * t).toString(16).padStart(2, '0')).join('')}`;
}

const css = (s: SheetStyle | undefined): CSSProperties => ({
  ...(s?.fill && { backgroundColor: s.fill }),
  ...(s?.color && { color: s.color }),
  ...(s?.bold && { fontWeight: 700 }),
  ...(s?.italic && { fontStyle: 'italic' }),
});

/** The sheet's style for a column's header, Average or Total cell. */
export function columnStyle(col: string | undefined, row: 'header' | 'average' | 'total'): SheetStyle | undefined {
  return col ? STYLES.columns[col]?.[row] : undefined;
}

export const headerStyle = (col: string | undefined, row: 'header' | 'average' | 'total'): CSSProperties => css(columnStyle(col, row));

/** What a snapshot's loans are coloured against: its overrides and, per column, its duplicate values. */
export function sheetContext(snapshot: Snapshot): SheetContext {
  const dups = new Map<string, Set<string>>();
  return {
    snapshot, overrides: new Map(snapshot.overrides.map((o) => [`${o.col}${o.row}`, o])),
    duplicates: (col) => dups.get(col) ?? dups.set(col, duplicatesOf(snapshot.loans, col)).get(col)!,
  };
}

export const loanCellStyle = (col: string | undefined, loan: Loan, ctx: SheetContext): CSSProperties => css(loanSheetStyle(col, loan, ctx));

/**
 * A loan cell's style: its column's style on the sheet, under the conditional formats that hold
 * for this loan (the first rule that sets a property wins, as in Excel), under the override style
 * when the user has typed a value over the cell.
 */
export function loanSheetStyle(col: string | undefined, loan: Loan, ctx: SheetContext): SheetStyle {
  const column = col ? STYLES.columns[col] : undefined;
  if (!col || !column) return {};
  const out: SheetStyle = {};
  const apply = (s: SheetStyle) => {
    for (const k of ['fill', 'color', 'bold', 'italic'] as const) if (s[k] !== undefined && out[k] === undefined) (out as Record<string, unknown>)[k] = s[k];
  };
  if (ctx.overrides.has(`${col}${loan.row}`)) apply(STYLES.override);
  for (const rule of column.rules ?? []) {
    if ('scale' in rule) {
      const v = loan.values[col];
      if (typeof v === 'number') apply({ fill: scaleColor(rule.scale, v) });
    } else if ('duplicate' in rule) {
      const v = loan.values[col];
      if (v != null && v !== '' && !isError(v) && ctx.duplicates(col).has(String(v))) apply(rule.style);
    } else if (truthy(evaluate(rule.if, loan, ctx))) {
      apply(rule.style);
    }
  }
  if (column.loan) apply(column.loan);
  return out;
}

/** The values more than one loan has in `col`, for the duplicate-value rules. */
export function duplicatesOf(loans: Loan[], col: string): Set<string> {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const l of loans) {
    const v = l.values[col];
    if (v == null || v === '' || isError(v)) continue;
    const k = String(v);
    if (seen.has(k)) dup.add(k); else seen.add(k);
  }
  return dup;
}
