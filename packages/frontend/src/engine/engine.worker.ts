// Runs the Excel model in HyperFormula off the main thread. Overrides replace a cell's
// formula with a constant; resetting restores the original formula and recalculates.

import { DetailedCellError, HyperFormula } from 'hyperformula';

import templateText from './generated/model-template.json?raw';
import { EXCEL_CONFIG, registerExcelFunctions } from './excel-functions.ts';
import { colName, colNum, parseAddress } from './formula-text.ts';
import { ASSUMPTION_CELLS, EDITABLE_COLS, LOAN_COLS, STRIP_MONTHS, STRIPS, type Scenario } from './model-schema.ts';
import type { CellChange, CellOut, CellRef, EngineRequest, EngineResponse, Override, Snapshot } from './protocol.ts';
import { loadInput, type InputRow } from './load-input.ts';
import { applyLookups, type Lookups } from './lookups.ts';
import { dependsOnHiddenRows, rewriteWorkbook, type Cell } from './rewrite.ts';
import { expandSheet, type ModelTemplate } from './template.ts';
import { MODEL_COLUMNS, MONTHLY_SERIES } from '../store/generated/store-fields.ts';

const MODEL = 'Model';

let hf: HyperFormula | null = null;
let sheetId = 0;
let template: ModelTemplate;
/** Model rows holding the loaded loans. */
let loanRows: number[] = [];
let original: Cell[][] = [];
const overrides = new Map<string, Override>();
const key = (row: number, col: string) => `${col}${row}`;

function out(v: unknown): CellOut {
  if (v instanceof DetailedCellError) return { error: v.value };
  if (v === undefined) return null;
  return v as CellOut;
}

function read(row: number, col: string): CellOut {
  return out(hf!.getCellValue({ sheet: sheetId, row: row - 1, col: colNum(col) - 1 }));
}

const stripCols = (start: string) => [...Array(STRIP_MONTHS).keys()].map((i) => colName(colNum(start) + i));
/** The report's columns plus every Model column Loan_Model and Loan_Model_Monthly store. */
const SNAPSHOT_COLS = [...new Set([...LOAN_COLS, ...MODEL_COLUMNS.map((c) => c.col), ...MONTHLY_SERIES.flatMap((s) => s.cols)])];

function snapshot(recalcMs: number): Snapshot {
  const loans = loanRows.map((row) => ({
    row,
    values: Object.fromEntries(SNAPSHOT_COLS.map((c) => [c, read(row, c)])),
    strips: Object.fromEntries((Object.keys(STRIPS) as Scenario[]).map((s) => [
      s, stripCols(STRIPS[s]).map((c) => { const v = read(row, c); return typeof v === 'number' ? v : 0; }),
    ])) as Record<Scenario, number[]>,
  }));
  const assumptions = Object.fromEntries(ASSUMPTION_CELLS.map((a) => {
    const { row, col } = parseAddress(a);
    return [a, out(hf!.getCellValue({ sheet: sheetId, row, col }))];
  }));
  const monthEnds = stripCols(STRIPS.Perf).map((c) => read(8, c));
  // The Model sheet's Average (row 8) and Total (row 9) cells above the header.
  const summary = {
    average: Object.fromEntries(LOAN_COLS.map((c) => [c, read(8, c)])),
    total: Object.fromEntries(LOAN_COLS.map((c) => [c, read(9, c)])),
  };
  return { loans, assumptions, monthEnds, summary, overrides: [...overrides.values()], recalcMs };
}

function init(input: InputRow[], lookups?: Lookups): string[] {
  template = JSON.parse(templateText) as ModelTemplate;
  const sheets: Record<string, Cell[][]> = {};
  for (const name of template.sheetOrder) sheets[name] = expandSheet(template.sheets[name]);
  applyLookups(sheets, lookups);
  const loaded = loadInput(sheets[MODEL], template, input);
  rewriteWorkbook(sheets, template.names, { [MODEL]: loaded.hiddenRows }, dependsOnHiddenRows);
  loanRows = loaded.loanRows;
  original = sheets[MODEL].map((r) => r.slice());
  registerExcelFunctions();
  hf?.destroy();
  overrides.clear();
  hf = HyperFormula.buildFromSheets(sheets as never, EXCEL_CONFIG);
  sheetId = hf.getSheetId(MODEL)!;
  return loaded.dropped;
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return Math.round(performance.now() - t0);
}

function setCell(row: number, col: string, content: Cell) {
  hf!.setCellContents({ sheet: sheetId, row: row - 1, col: colNum(col) - 1 }, [[content as never]]);
}

// Applies the overrides in one batch so the model recalculates once, however many loans change.
function applyMany(changes: CellChange[]): number {
  for (const c of changes) if (!EDITABLE_COLS.has(c.col)) throw new Error(`${c.col} is not editable`);
  const before = changes.map((c) => overrides.get(key(c.row, c.col))?.modelValue ?? read(c.row, c.col));
  const ms = timed(() => hf!.batch(() => {
    for (const c of changes) setCell(c.row, c.col, typeof c.value === 'string' ? "'" + c.value : c.value);
  }));
  changes.forEach((c, i) => overrides.set(key(c.row, c.col), { row: c.row, col: c.col, value: c.value, modelValue: before[i] }));
  return ms;
}

function resetMany(cells: CellRef[]): number {
  const ms = timed(() => hf!.batch(() => {
    for (const c of cells) setCell(c.row, c.col, original[c.row - 1][colNum(c.col) - 1] ?? null);
  }));
  for (const c of cells) overrides.delete(key(c.row, c.col));
  return ms;
}

function handle(req: EngineRequest): EngineResponse {
  switch (req.type) {
    case 'init': {
      let dropped: string[] = [];
      const ms = timed(() => { dropped = init(req.input, req.lookups); });
      return {
        id: req.id, ok: true, snapshot: snapshot(ms),
        info: {
          sourceModel: template.sourceModel, sourceTape: req.source, generatedAt: template.generatedAt,
          capacity: template.slots.last - template.slots.first + 1, dropped,
        },
      };
    }
    case 'set':
      return { id: req.id, ok: true, snapshot: snapshot(applyMany([{ row: req.row, col: req.col, value: req.value }])) };
    case 'setMany':
      return { id: req.id, ok: true, snapshot: snapshot(applyMany(req.changes)) };
    case 'reset':
      return { id: req.id, ok: true, snapshot: snapshot(resetMany([{ row: req.row, col: req.col }])) };
    case 'resetMany':
      return { id: req.id, ok: true, snapshot: snapshot(resetMany(req.cells)) };
    case 'resetAll':
      return { id: req.id, ok: true, snapshot: snapshot(resetMany([...overrides.values()])) };
  }
}

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  let res: EngineResponse;
  try {
    res = handle(e.data);
  } catch (err) {
    res = { id: e.data.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(res);
};
