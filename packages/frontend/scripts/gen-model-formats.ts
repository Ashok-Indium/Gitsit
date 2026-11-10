// Reads the number formats of the report's Model columns from the model workbook, so the app's
// tables show values as the Model sheet does: the loan rows' format (row 11) and the formats of
// the Average (row 8) and Total (row 9) cells above the header.
//
//   node scripts/gen-model-formats.ts [model.xlsx]
//
// Writes src/engine/generated/model-formats.json: { [column]: { loan, average, total } }.

import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPORT_FIELDS } from '../src/engine/report-fields.ts';

const here = dirname(fileURLToPath(import.meta.url));
const modelPath = resolve(process.argv[2] ?? resolve(here, '../../../data/Pacific Private Money - model.xlsx'));

const AVERAGE_ROW = 8;
const TOTAL_ROW = 9;
const FIRST_LOAN_ROW = 11;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(modelPath);
const ws = wb.getWorksheet('Model');
if (!ws) throw new Error('The model workbook has no Model sheet');

const fmt = (row: number, col: string) => {
  const f = ws.getCell(`${col}${row}`).numFmt;
  return f && f !== 'General' ? f : '';
};
const out = Object.fromEntries([...new Set(REPORT_FIELDS.map((f) => f.col))].sort().map((col) => [col, {
  loan: fmt(FIRST_LOAN_ROW, col),
  average: fmt(AVERAGE_ROW, col),
  total: fmt(TOTAL_ROW, col),
}]));
writeFileSync(resolve(here, '../src/engine/generated/model-formats.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`model-formats.json: ${Object.keys(out).length} columns`);
