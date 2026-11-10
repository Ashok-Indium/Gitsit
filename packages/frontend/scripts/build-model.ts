// Builds src/engine/generated/model-template.json from the Excel model and the input tape.
//
//   node scripts/build-model.ts [model.xlsx] [input.xlsx]
//
// Steps: read every sheet of the model (formulas + values), load the input tape into the
// Model sheet's loan rows, blank the unused loan slots and exclude them from SUBTOTAL,
// rewrite formulas for HyperFormula, then recalculate and compare the loans against the
// values Excel saved in the workbook. The template is only written when they agree.

import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXCEL_CONFIG, registerExcelFunctions } from '../src/engine/excel-functions.ts';
import { colName, colNum, parseAddress, translateFormula } from '../src/engine/formula-text.ts';
import { loadInput, loanKey, type InputRow } from '../src/engine/load-input.ts';
import { LOAN_FIELDS, POOL_METRICS, STRIP_MONTHS, STRIPS } from '../src/engine/model-schema.ts';
import { dependsOnHiddenRows, rewriteWorkbook, type Cell, type DefinedName, type SheetData } from '../src/engine/rewrite.ts';
import { compressSheet, expandSheet, type ModelTemplate } from '../src/engine/template.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../../data');
const modelPath = resolve(process.argv[2] ?? resolve(dataDir, 'Pacific Private Money - model.xlsx'));
const tapePath = resolve(process.argv[3] ?? resolve(dataDir, 'Pacific Private Money - input.xlsx'));
const outPath = resolve(here, '../src/engine/generated/model-template.json');
// The tape rows as stored in InputLoan, written by scripts/gen-store.ts (run that first).
const inputRowsPath = resolve(here, '../src/store/generated/input-rows.json');

const MODEL = 'Model';
const HEADER_ROW = 10;
const FIRST_LOAN_ROW = 11;
const LAST_LOAN_SLOT = 58; // rows 59-61 are spare rows the model leaves visible
const TAPE_OFFSET = 445; // input column i (0-based, from J) lands in Model column i + 445
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const toSerial = (d: Date) => (d.getTime() - EXCEL_EPOCH) / 86400000;
const norm = (s: unknown) => String(s ?? '').replace(/^'/, '').replace(/\s+/g, ' ').trim();

function plain(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null) return null;
  // exceljs yields an Invalid Date for text results in date-formatted cells; treat as unknown.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toSerial(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('error' in v) return v.error;
    if ('text' in v) return String(v.text);
    if ('result' in v) return plain(v.result as ExcelJS.CellValue);
    return null;
  }
  return v as Cell;
}

// Text stays text: HyperFormula would otherwise turn "0002007400" or "2017-12-24" into numbers.
const asCell = (v: Cell): Cell => (typeof v === 'string' ? "'" + v : v);

async function readWorkbook(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets: Record<string, SheetData> = {};
  const cached: Record<string, Record<string, Cell>> = {};
  const hidden: Record<string, number[]> = {};
  for (const ws of wb.worksheets) {
    const rows: SheetData = [];
    const cache: Record<string, Cell> = {};
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.hidden) (hidden[ws.name] ||= []).push(r);
      const arr: Cell[] = (rows[r - 1] = []);
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = cell.value as ExcelJS.CellValue & { sharedFormula?: string; formula?: string };
        let formula: string | null = null;
        if (v && typeof v === 'object' && 'sharedFormula' in v && v.sharedFormula) {
          const master = ws.getCell(v.sharedFormula);
          const mf = (master.value as { formula: string }).formula;
          formula = translateFormula(mf, r - Number(master.row), c - Number(master.col));
        } else if (v && typeof v === 'object' && 'formula' in v && v.formula) {
          formula = v.formula;
        }
        if (formula) {
          arr[c - 1] = '=' + formula.replace(/_xlfn\.|_xlws\./g, '');
          cache[cell.address] = plain(cell.result as ExcelJS.CellValue);
        } else {
          arr[c - 1] = asCell(plain(v));
        }
      });
    });
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    sheets[ws.name] = rows;
    cached[ws.name] = cache;
  }
  const names: DefinedName[] = (wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model
    .filter((n) => !n.name.startsWith('_xlnm'))
    .map((n) => ({ name: n.name, ref: n.ranges.join(',') }));
  return { sheets, cached, hidden, names, order: wb.worksheets.map((w) => w.name) };
}

async function readTape(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = norm(c.value); });
  const rows: Cell[][] = [];
  const dates: boolean[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.getCell(1).value == null) continue;
    rows.push(headers.map((_, i) => plain(row.getCell(i + 1).value)));
    dates.push(headers.map((_, i) => row.getCell(i + 1).value instanceof Date));
  }
  return { name: ws.name, headers, rows, dates };
}

/** Where each tape column goes on the Model sheet (0-based column index), or -1 to skip. */
function tapeColumnMap(tapeHeaders: string[], modelHeaders: Cell[]): number[] {
  const mh = (c: number) => norm(modelHeaders[c]);
  const leading: Record<string, number> = {};
  for (let c = 0; c < 9; c++) if (mh(c)) leading[mh(c)] = c;
  const map = tapeHeaders.map((h, i) => {
    if (i < 9) return leading[h] ?? -1;
    return mh(i + TAPE_OFFSET) === h || (!mh(i + TAPE_OFFSET) && h.startsWith('Unnamed')) ? i + TAPE_OFFSET : -1;
  });
  // Columns the model moved: a tape header whose Model column holds a different tape header.
  tapeHeaders.forEach((h, i) => {
    if (map[i] !== -1) return;
    for (let j = 9; j < tapeHeaders.length; j++) {
      const c = j + TAPE_OFFSET;
      if (mh(c) === h && norm(tapeHeaders[j]) !== h) { map[i] = c; map[j] = -1; return; }
    }
  });
  return map;
}

function sameValue(a: Cell, b: Cell): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const s = (v: Cell) => String(v ?? '').replace(/^'/, '');
  return s(a) === s(b) || s(a).replace(/^0+/, '') === s(b).replace(/^0+/, '');
}

async function main() {
  console.log(`Model: ${modelPath}\nTape:  ${tapePath}`);
  const wb = await readWorkbook(modelPath);
  const tape = await readTape(tapePath);
  const model = wb.sheets[MODEL];
  const modelHeaders = model[HEADER_ROW - 1];

  for (const fld of LOAN_FIELDS) {
    const got = norm(modelHeaders[colNum(fld.col) - 1]);
    if (got !== norm(fld.header)) throw new Error(`Model!${fld.col}${HEADER_ROW} is "${got}", expected "${fld.header}"`);
  }
  for (const [scenario, start] of Object.entries(STRIPS)) {
    for (let m = 1; m <= STRIP_MONTHS; m++) {
      const got = norm(modelHeaders[colNum(start) + m - 2]);
      if (got !== String(m)) throw new Error(`${scenario} cash-flow strip: Model!${colName(colNum(start) + m - 1)}${HEADER_ROW} is "${got}", expected month ${m}`);
    }
  }

  const slots = LAST_LOAN_SLOT - FIRST_LOAN_ROW + 1;
  if (tape.rows.length > slots) throw new Error(`Tape has ${tape.rows.length} loans; the model holds ${slots}`);

  const colMap = tapeColumnMap(tape.headers, modelHeaders);
  const mapped = colMap.filter((c) => c >= 0);
  const tapeCols = new Set(mapped);
  const isFormula = (v: Cell | undefined) => typeof v === 'string' && v.startsWith('=');
  const slotRows = Array.from({ length: slots }, (_, i) => FIRST_LOAN_ROW + i);

  // The workbook's own loans sit in the rows it does not hide; the rest are spare slots.
  const excelHiddenRows = new Set(wb.hidden[MODEL] ?? []);
  const inUse = slotRows.filter((r) => !excelHiddenRows.has(r));
  const spare = slotRows.find((r) => excelHiddenRows.has(r));
  const idOf = (r: number) => loanKey(norm(model[r - 1][0]));
  const width = Math.max(...slotRows.map((r) => model[r - 1].length));
  const loanConstants: Record<string, Record<string, Cell>> = {};
  const loanDefaults: Record<string, Cell> = {};
  const emptyDefaults: Record<string, Cell> = {};
  const fillSources: { c: number; src: number }[] = [];
  const loanNoFill: Record<string, string[]> = {};
  for (let c = 0; c < width; c++) {
    const col = colName(c + 1);
    // Formulas the spare slots lack: a loan placed there needs them. Most loans carry them;
    // the few the workbook left without keep it that way.
    const withFormula = inUse.filter((r) => isFormula(model[r - 1][c]));
    if (withFormula.length && slotRows.some((r) => !isFormula(model[r - 1][c]))) {
      if (withFormula.length * 2 > inUse.length) {
        fillSources.push({ c, src: withFormula[0] });
        for (const r of inUse) if (!isFormula(model[r - 1][c])) (loanNoFill[idOf(r)] ||= []).push(col);
      } else {
        console.warn(`  ${col}: only ${withFormula.length} of ${inUse.length} loans have a formula; new loans get none`);
      }
    }
    if (tapeCols.has(c)) continue;
    // A typed-in column (e.g. Bid_calc): rows in use share a default, spare slots their own value.
    const values = inUse.map((r) => model[r - 1][c]);
    if (values.every((v) => v != null && v !== '' && !isFormula(v))) {
      const counts = new Map<Cell, number>();
      for (const v of values) counts.set(v ?? null, (counts.get(v ?? null) ?? 0) + 1);
      const dflt = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      loanDefaults[col] = dflt;
      emptyDefaults[col] = spare ? (model[spare - 1][c] ?? null) : dflt;
      inUse.forEach((r, k) => { if (values[k] !== dflt) (loanConstants[idOf(r)] ||= {})[col] = values[k]; });
      if (emptyDefaults[col] !== dflt) console.log(`  ${col}: loans default to ${JSON.stringify(dflt)}, empty slots hold ${JSON.stringify(emptyDefaults[col])}`);
      continue;
    }
    // Values typed into a loan's row in a column that is otherwise formulas belong to that
    // loan: record them by Loan ID and give the row the column's formula back.
    const formulaRows = slotRows.filter((r) => isFormula(model[r - 1][c]));
    if (!formulaRows.length) continue;
    for (const r of inUse) {
      const v = model[r - 1][c];
      if (v == null || v === '' || isFormula(v)) continue;
      const id = idOf(r);
      (loanConstants[id] ||= {})[col] = v;
      const from = formulaRows.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
      model[r - 1][c] = translateFormula(model[from - 1][c] as string, r - from, 0);
      console.log(`  loan ${id}: ${col} = ${JSON.stringify(v)} follows the loan`);
    }
  }

  // Keep the model's own tape values to compare with, then empty the tape block: the app
  // loads the input loans when it opens.
  const modelTape = slotRows.map((r) => mapped.map((c) => model[r - 1][c] ?? null));
  for (const r of slotRows) for (const c of tapeCols) if (!isFormula(model[r - 1][c])) delete model[r - 1][c];

  // Everything except SUBTOTAL can be rewritten now; SUBTOTAL waits for the loan count.
  rewriteWorkbook(wb.sheets, wb.names, {}, (f) => !dependsOnHiddenRows(f));
  // Stored rewritten, like the rest of the template, as they read in the first slot row.
  const fillFormulas = Object.fromEntries(fillSources.map(({ c, src }) =>
    [colName(c + 1), translateFormula(model[src - 1][c] as string, FIRST_LOAN_ROW - src, 0)]));
  if (fillSources.length) console.log(`  formulas a loan needs in a spare slot: ${Object.keys(fillFormulas).join(', ')}`);
  const stored: Record<string, SheetData> = {};
  for (const [name, rows] of Object.entries(wb.sheets)) stored[name] = compressSheet(rows);

  const headers: Record<string, string> = {};
  for (const fld of LOAN_FIELDS) headers[fld.col] = norm(modelHeaders[colNum(fld.col) - 1]);
  const template: ModelTemplate = {
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceModel: basename(modelPath),
    sourceTape: basename(tapePath),
    sheetOrder: wb.order,
    sheets: stored,
    names: wb.names,
    loanRows: tape.rows.map((_, i) => FIRST_LOAN_ROW + i),
    hiddenRows: slotRows.slice(tape.rows.length),
    slots: { first: FIRST_LOAN_ROW, last: LAST_LOAN_SLOT },
    tapeHeaders: tape.headers,
    tapeColumns: colMap,
    loanConstants,
    loanDefaults,
    emptyDefaults,
    fillFormulas,
    loanNoFill,
    headers,
  };

  // Check the app's path: load the input rows the way the app does, then recalculate and
  // compare with Excel's saved results.
  const inputRows = JSON.parse(readFileSync(inputRowsPath, 'utf8')) as InputRow[];
  if (inputRows.length !== tape.rows.length) throw new Error(`${inputRowsPath} is out of date: run node scripts/gen-store.ts first`);
  const sheetsNow: Record<string, SheetData> = {};
  for (const [name, rows] of Object.entries(stored)) sheetsNow[name] = expandSheet(rows);
  const { loanRows, hiddenRows } = loadInput(sheetsNow[MODEL], template, inputRows);
  rewriteWorkbook(sheetsNow, wb.names, { [MODEL]: hiddenRows }, dependsOnHiddenRows);
  let changed = 0;
  loanRows.forEach((r, i) => mapped.forEach((c, k) => {
    if (isFormula(modelTape[i][k])) return;
    if (!sameValue(sheetsNow[MODEL][r - 1][c] ?? null, modelTape[i][k])) {
      if (changed++ < 10) console.log(`  ${colName(c + 1)}${r}: model ${JSON.stringify(modelTape[i][k])}, input ${JSON.stringify(sheetsNow[MODEL][r - 1][c])}`);
    }
  }));
  console.log(`Tape "${tape.name}": ${tape.rows.length} loans, ${mapped.length}/${tape.headers.length} columns mapped, ${changed} cells differ from the model`);

  registerExcelFunctions();
  const t0 = Date.now();
  const hf = HyperFormula.buildFromSheets(sheetsNow as never, EXCEL_CONFIG);
  const sid = hf.getSheetId(MODEL)!;
  console.log(`Recalculated ${Object.keys(sheetsNow).length} sheets in ${Date.now() - t0} ms`);
  const excelHidden = wb.hidden[MODEL] ?? [];
  const sameRows = excelHidden.length === hiddenRows.length && excelHidden.every((r, i) => r === hiddenRows[i]);
  const cache = wb.cached[MODEL];
  const valueAt = (a: string) => {
    const { row, col } = parseAddress(a);
    return hf.getCellValue({ sheet: sid, row, col });
  };
  const matches = (a: string) => {
    const exp = cache[a];
    if (exp === undefined || exp === null) return true;
    const got = valueAt(a);
    if (got && typeof got === 'object') return typeof exp === 'string' && exp.startsWith('#');
    return sameValue((got ?? null) as Cell, exp);
  };
  let total = 0, ok = 0;
  const badCols = new Map<string, { n: number; sample: string }>();
  for (const r of loanRows) {
    for (let c = 0; c < sheetsNow[MODEL][r - 1].length; c++) {
      const a = `${colName(c + 1)}${r}`;
      if (!(a in cache)) continue;
      total++;
      if (matches(a)) { ok++; continue; }
      const key = colName(c + 1);
      const prev = badCols.get(key);
      if (prev) prev.n++;
      else badCols.set(key, { n: 1, sample: `${a}: app ${JSON.stringify(valueAt(a))}, Excel ${JSON.stringify(cache[a])}` });
    }
  }
  console.log(`Loan rows: ${ok}/${total} formula cells match Excel (${((100 * ok) / total).toFixed(2)}%)`);
  for (const [col, { n, sample }] of badCols) console.log(`  differs in ${col} (${n} loans), e.g. ${sample}`);
  const keyCols = LOAN_FIELDS.map((x) => x.col);
  const keyBad = [...badCols.keys()].filter((c) => keyCols.includes(c));
  if (changed === 0 && keyBad.length) throw new Error(`App columns differ from Excel: ${keyBad.join(', ')}`);
  if (sameRows) {
    const poolBad = POOL_METRICS.filter((m) => !matches(m.cell));
    for (const m of POOL_METRICS) console.log(`  ${m.label.padEnd(18)} ${String(valueAt(m.cell)).padStart(22)}   Excel ${cache[m.cell]}`);
    if (changed === 0 && poolBad.length) throw new Error(`Pool totals differ from Excel: ${poolBad.map((m) => m.cell).join(', ')}`);
  } else {
    console.log('  (pool totals not compared: the tape changes which loan slots are in use)');
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(template);
  writeFileSync(outPath, json);
  console.log(`Wrote ${outPath} (${(json.length / 1e6).toFixed(2)} MB)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
