// @vitest-environment node
// The Model sheet's Average (row 8) and Total (row 9) cells, as the engine calculates them for the
// original input, match the values Excel saved in the workbook.
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';

import { EXCEL_CONFIG, registerExcelFunctions } from './excel-functions.ts';
import { colNum } from './formula-text.ts';
import { loadInput, type InputRow } from './load-input.ts';
import { LOAN_COLS } from './model-schema.ts';
import { dependsOnHiddenRows, rewriteWorkbook, type Cell } from './rewrite.ts';
import { expandSheet, type ModelTemplate } from './template.ts';

const template: ModelTemplate = JSON.parse(readFileSync(resolve(import.meta.dirname, 'generated/model-template.json'), 'utf8'));
const tapeRows: InputRow[] = JSON.parse(readFileSync(resolve(import.meta.dirname, '../store/generated/input-rows.json'), 'utf8'));

describe('Model sheet Average and Total rows', () => {
  it('match Excel for every report column', async () => {
    const sheets = Object.fromEntries(template.sheetOrder.map((n) => [n, expandSheet(template.sheets[n])])) as Record<string, Cell[][]>;
    const loaded = loadInput(sheets.Model, template, tapeRows);
    rewriteWorkbook(sheets, template.names, { Model: loaded.hiddenRows }, dependsOnHiddenRows);
    registerExcelFunctions();
    const hf = HyperFormula.buildFromSheets(sheets as never, EXCEL_CONFIG);
    const sheet = hf.getSheetId('Model')!;

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(resolve(import.meta.dirname, '../../../../data/Pacific Private Money - model.xlsx'));
    const ws = wb.getWorksheet('Model')!;
    const excel = (row: number, col: string) => {
      const v = ws.getCell(`${col}${row}`).value as unknown;
      const r = v && typeof v === 'object' ? ('result' in v ? (v as { result: unknown }).result : 'formula' in v || 'sharedFormula' in v ? undefined : v) : v;
      return r && typeof r === 'object' && 'error' in r ? (r as { error: string }).error : r;
    };
    const mismatches: string[] = [];
    for (const row of [8, 9]) {
      for (const col of LOAN_COLS) {
        const cached = excel(row, col);
        // Dates come back as Date objects (an empty date cell as an invalid one): compare as serials.
        const want = cached instanceof Date ? (Number.isNaN(cached.getTime()) ? null : cached.getTime() / 86400000 + 25569)
          : typeof cached === 'number' && !Number.isFinite(cached) ? null : cached;
        // No cached result, or an error in Excel itself (#VALUE! from the SUMPRODUCT helpers); the
        // app leaves errors blank. QG8 counts the hidden spare loan rows too, whose saved values in
        // the workbook are stale.
        if (want === undefined || (typeof want === 'string' && want.startsWith('#')) || `${col}${row}` === 'QG8') continue;
        const raw = hf.getCellValue({ sheet, row: row - 1, col: colNum(col) - 1 });
        // An error shows blank in the app, as does an empty cell in Excel.
        const got = (raw && typeof raw === 'object') || (typeof raw === 'number' && !Number.isFinite(raw)) ? null : raw;
        const same = typeof want === 'number' && typeof got === 'number'
          ? Math.abs(want - got) <= 1e-6 * Math.max(1, Math.abs(want))
          : String(want ?? '') === String(got ?? '');
        if (!same) mismatches.push(`${col}${row}: excel ${typeof want} ${String(want)} app ${typeof got} ${String(got)}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});
