// Report tables: loan tables (tableEx) with inline overrides, measure matrices and the
// monthly cash-flow pivots.

import { ArrowDown, ArrowUp, PencilLine } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EditableValue } from '@/components/editable-value';
import { excelDisplay } from '@/engine/excel-format';
import MODEL_FORMATS from '@/engine/generated/model-formats.json';
import { FIELD_BY_LABEL, STRIP_MONTHS, type Scenario } from '@/engine/model-schema';
import { isError, type CellChange, type CellOut, type CellRef, type Override, type Snapshot } from '@/engine/protocol';
import { cn } from '@/lib/utils';

import { pbiFormat } from './format';
import { cfTotal, type Loan, type MeasureDef } from './measures';
import { duplicatesOf, headerStyle, loanCellStyle, type SheetContext } from './sheet-style';

export interface Editing {
  overrides: Map<string, Override>;
  busy: boolean;
  onCommit: (row: number, col: string, value: number | string) => void;
  onReset: (row: number, col: string) => void;
  /** Apply or reset many cells with one recalculation (Edit Fields page). */
  onCommitMany: (changes: CellChange[]) => Promise<void>;
  onResetMany: (cells: CellRef[]) => Promise<void>;
  onOpenLoan: (row: number) => void;
}

const CF_TOTAL = /^(Perf|Payoff|REO|NPL) CF Total$/;
const cellOf = (l: Loan, label: string): CellOut => {
  const m = CF_TOTAL.exec(label);
  if (m) return cfTotal(l, m[1] as Scenario);
  return l.values[FIELD_BY_LABEL[label].col];
};
const fmtOf = (label: string) => (CF_TOTAL.test(label) ? '#,##0.00' : FIELD_BY_LABEL[label].fmt);
const sortKey = (v: CellOut) => (typeof v === 'number' ? v : typeof v === 'string' ? v.toLowerCase() : -Infinity);

type SheetRow = 'loan' | 'average' | 'total';
const SHEET_FORMATS = MODEL_FORMATS as Record<string, Record<SheetRow, string>>;

/**
 * A value as the Model sheet shows it, in that column's Excel number format (the Average and Total
 * cells have their own). A blank number in a loan row is 0. Columns the sheet leaves at General
 * keep the report's format.
 */
function modelText(label: string, v: CellOut, row: SheetRow = 'loan'): string {
  const numeric = !!fmtOf(label);
  if (row === 'loan' && numeric && (v == null || v === '')) v = 0;
  if (v != null && isError(v)) return v.error;
  const formats = FIELD_BY_LABEL[label] && SHEET_FORMATS[FIELD_BY_LABEL[label].col];
  const fmt = formats ? (row === 'loan' ? formats.loan : formats[row] || formats.loan) : '';
  return fmt ? excelDisplay(v, fmt) : pbiFormat(v, fmtOf(label));
}

const th = 'border-b-2 border-visual-border px-200 py-100 align-bottom font-bold text-foreground';
const td = 'border-b border-visual-border/60 px-200 py-100 whitespace-nowrap';
const sumCell = 'border-b border-visual-border px-200 py-100 whitespace-nowrap bg-canvas';
// Styled as the Model sheet: Excel's white grid, Calibri, and each cell's own colours.
const sheetTh = 'border-b border-r border-b-sheet-foreground border-r-sheet-grid bg-sheet px-200 py-100 align-bottom font-normal';
const sheetTd = 'border-b border-r border-sheet-grid px-200 py-100 whitespace-nowrap';
const sheetSum = 'border-b border-r border-sheet-grid bg-sheet px-200 py-100 whitespace-nowrap';

/** The Model sheet's Average and Total rows, shown above the header as on the sheet. */
export interface SheetSummary {
  values: NonNullable<Snapshot['summary']>;
  /** Shown beside the row labels, e.g. when filters hide some loans. */
  note?: string;
}

/**
 * A Power BI table visual over loans, with click-to-override cells for editable columns. Given the
 * model's `sheet` snapshot, it is coloured as the Model sheet is, conditional formats included.
 */
export function LoanTable({ columns, loans, editing, maxHeight = 'max-h-[60vh]', summary, sheet }: {
  columns: readonly string[];
  loans: Loan[];
  editing: Editing;
  maxHeight?: string;
  summary?: SheetSummary;
  sheet?: Snapshot;
}) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return loans;
    return [...loans].sort((a, b) => {
      const x = sortKey(cellOf(a, sort.col)), y = sortKey(cellOf(b, sort.col));
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [loans, sort]);
  // The sheet's rules see every loan in the file, as on the sheet, whatever the filters show.
  const context = useMemo<SheetContext | null>(() => {
    if (!sheet) return null;
    const dups = new Map<string, Set<string>>();
    return {
      snapshot: sheet, overrides: editing.overrides,
      duplicates: (col) => dups.get(col) ?? dups.set(col, duplicatesOf(sheet.loans, col)).get(col)!,
    };
  }, [sheet, editing.overrides]);
  const toggle = (col: string) => setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));

  if (!loans.length) return <p className="py-800 text-center text-300 text-muted-foreground">No loans match the current filters.</p>;
  const styled = !!context;
  const firstCol = FIELD_BY_LABEL[columns[0]]?.col;
  return (
    <div className={cn('overflow-auto', maxHeight, styled && 'bg-sheet font-sheet text-sheet-foreground')}>
      <table className="min-w-full border-separate border-spacing-0 text-200">
        <thead className={cn('sticky top-0 z-10', styled ? 'bg-sheet' : 'bg-card')}>
          {summary && (['average', 'total'] as const).map((kind) => (
            <tr key={kind} className={cn(!styled && kind === 'total' && 'font-bold')}>
              {columns.map((c, i) => {
                if (i === 0) {
                  return (
                    <th key={c} scope="row" style={styled ? headerStyle(firstCol, kind) : undefined}
                      className={cn(styled ? cn(sheetSum, 'font-normal') : cn(sumCell, 'text-title'), 'sticky left-0 z-10 text-left')}>
                      {kind === 'total' ? 'Total' : 'Average'}
                      {summary.note && <span className={cn('ml-100 font-normal', styled ? 'opacity-75' : 'text-muted-foreground')}>({summary.note})</span>}
                    </th>
                  );
                }
                const f = FIELD_BY_LABEL[c];
                const v = f ? summary.values[kind][f.col] : null;
                // Blank where the sheet has nothing or an error (#DIV/0!, #VALUE!).
                return (
                  <td key={c} style={styled ? headerStyle(f?.col, kind) : undefined}
                    className={cn(styled ? sheetSum : sumCell, fmtOf(c) ? 'text-right tabular-nums' : 'text-left')}>
                    {v == null || v === '' || isError(v) || (typeof v === 'number' && !Number.isFinite(v)) ? '' : modelText(c, v, kind)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            {columns.map((c, i) => {
              const f = FIELD_BY_LABEL[c];
              const numeric = !!fmtOf(c);
              return (
                <th key={c} scope="col" aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  style={styled ? headerStyle(f?.col, 'header') : undefined}
                  className={cn(styled ? sheetTh : th, numeric ? 'text-right' : 'text-left', i === 0 && cn('sticky left-0 z-10', !styled && 'bg-card'))}>
                  <button type="button" onClick={() => toggle(c)}
                    className={cn('inline-flex max-w-40 items-end gap-100 whitespace-normal rounded-sm text-balance hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', numeric && 'flex-row-reverse text-right')}>
                    <span>{c}</span>
                    {f?.editable && <PencilLine aria-label="editable" className={cn('icon-size-100 shrink-0', !styled && 'text-primary')} />}
                    {sort?.col === c && (sort.dir === 1 ? <ArrowUp className="icon-size-100 shrink-0" /> : <ArrowDown className="icon-size-100 shrink-0" />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.row} className={styled ? 'hover:bg-sheet-hover' : 'hover:bg-hover'}>
              {columns.map((c, i) => {
                const f = FIELD_BY_LABEL[c];
                const v = cellOf(l, c);
                const numeric = !!fmtOf(c);
                const style = context ? loanCellStyle(f?.col, l, context) : undefined;
                if (i === 0 && c === 'Loan ID') {
                  return (
                    <td key={c} style={style} className={cn(styled ? sheetTd : td, 'sticky left-0', styled ? !style?.backgroundColor && 'bg-sheet' : 'bg-card')}>
                      <button type="button" onClick={() => editing.onOpenLoan(l.row)}
                        className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          styled ? 'underline decoration-dotted underline-offset-2 hover:decoration-solid' : 'font-semibold text-primary hover:underline')}>{String(v ?? '')}</button>
                    </td>
                  );
                }
                return (
                  <td key={c} style={style} className={cn(styled ? sheetTd : td, numeric && 'text-right tabular-nums')}>
                    {f?.editable ? (
                      <EditableValue field={f} value={v} override={editing.overrides.get(`${f.col}${l.row}`)} disabled={editing.busy}
                        align={numeric ? 'right' : 'left'} format={(x) => modelText(c, x)} tone={styled ? 'sheet' : 'app'}
                        onCommit={(value) => editing.onCommit(l.row, f.col, value)}
                        onReset={() => editing.onReset(l.row, f.col)} />
                    ) : modelText(c, v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Power BI matrix: one row per group of `rowLabel`, a column per measure, and a Total row. */
export function MeasureMatrix({ rowLabel, groups, all, measures }: {
  rowLabel: string;
  groups: [string, Loan[]][];
  all: Loan[];
  measures: MeasureDef[];
}) {
  if (!all.length) return <p className="py-600 text-center text-300 text-muted-foreground">No loans match the current filters.</p>;
  const sorted = [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-200">
        <thead className="sticky top-0 bg-card">
          <tr>
            <th scope="col" className={cn(th, 'text-left')}>{rowLabel}</th>
            {measures.map((m) => <th key={m.name} scope="col" className={cn(th, 'text-right')}>{m.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map(([g, ls]) => (
            <tr key={g} className="hover:bg-hover">
              <th scope="row" className={cn(td, 'text-left font-normal')}>{g}</th>
              {measures.map((m) => <td key={m.name} className={cn(td, 'text-right tabular-nums')}>{pbiFormat(m.calc(ls), m.fmt)}</td>)}
            </tr>
          ))}
          <tr className="font-bold">
            <th scope="row" className={cn(td, 'border-t-2 text-left')}>Total</th>
            {measures.map((m) => <td key={m.name} className={cn(td, 'border-t-2 text-right tabular-nums')}>{pbiFormat(m.calc(all), m.fmt)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const CF_FMT = '#,##0;(#,##0)';

/**
 * Scenario cash flows: loans down, months 1-36 across, with totals. `sheet` styles it as the
 * Model sheet's cash-flow columns (plain month numbers, centred, over a white grid).
 */
export function CashFlowPivot({ loans, scenario, sheet }: { loans: Loan[]; scenario: Scenario; sheet?: boolean }) {
  const months = [...Array(STRIP_MONTHS).keys()];
  const colTotals = months.map((m) => loans.reduce((s, l) => s + l.strips[scenario][m], 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  if (!loans.length) return null;
  const head = sheet ? sheetTh : th, cell = sheet ? sheetTd : td, pinned = sheet ? 'bg-sheet' : 'bg-card';
  return (
    <div className={cn('max-h-[40vh] overflow-auto', sheet && 'bg-sheet font-sheet text-sheet-foreground')}>
      <table className="min-w-full border-separate border-spacing-0 text-200 tabular-nums">
        <thead className={cn('sticky top-0 z-10', pinned)}>
          <tr>
            <th scope="col" style={sheet ? headerStyle('A', 'header') : undefined} className={cn(head, 'sticky left-0 z-10 text-left', pinned)}>Loan ID</th>
            {months.map((m) => <th key={m} scope="col" className={cn(head, sheet ? 'text-center' : 'text-right')}>{m + 1}</th>)}
            <th scope="col" className={cn(head, 'text-right', sheet && 'font-bold')}>Total</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => {
            const s = l.strips[scenario];
            return (
              <tr key={l.row} className={sheet ? 'hover:bg-sheet-hover' : 'hover:bg-hover'}>
                <th scope="row" className={cn(cell, 'sticky left-0 text-left font-normal', pinned)}>{String(l.values.A ?? '')}</th>
                {s.map((v, m) => <td key={m} className={cn(cell, 'text-right')}>{v ? pbiFormat(v, CF_FMT) : ''}</td>)}
                <td className={cn(cell, 'text-right font-semibold')}>{pbiFormat(s.reduce((a, b) => a + b, 0), CF_FMT)}</td>
              </tr>
            );
          })}
          <tr className="font-bold">
            <th scope="row" className={cn(cell, 'sticky left-0 border-t-2 text-left', pinned)}>Total</th>
            {colTotals.map((v, m) => <td key={m} className={cn(cell, 'border-t-2 text-right')}>{v ? pbiFormat(v, CF_FMT) : ''}</td>)}
            <td className={cn(cell, 'border-t-2 text-right')}>{pbiFormat(grand, CF_FMT)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
