// Generates the lookup tables: the model workbook's lookup sheets (EXIT, ZIP3, state_code …) as
// Fabric SQL tables the app reads at open and writes back into the model before it calculates.
//
//   node scripts/gen-lookups.ts [model.xlsx]
//
// Writes:
//   docs/lookup-tables.sql                                 (CREATE TABLE for each lookup table)
//   packages/frontend/src/store/generated/lookup-fields.ts (where each table's values sit in the model)
//   packages/frontend/src/store/generated/lookup-rows.json (the workbook's values, to fill empty tables)
//
// Every table starts with Table_Type ('BPL', this model's category) and is keyed by it plus the
// table's own key, so another category's values could sit in the same tables later.

import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const modelPath = resolve(process.argv[2] ?? resolve(root, 'data/Pacific Private Money - model.xlsx'));

/** This model's category, stored in every table's Table_Type. */
export const TABLE_TYPE = 'BPL';

/** 'auto' = a text column that also holds numbers (code 24): written back as a number when it reads as one. */
type ColType = 'text' | 'number' | 'auto';

/** A list: one SQL row per sheet row from `startRow`, one SQL column per sheet column. */
interface ListDef {
  kind: 'list'; table: string; sheet: string; startRow: number; key: string[];
  /** Threshold lists the model matches approximately: written back in this column's order. */
  sortBy?: string;
  columns: { name: string; col: string; type?: ColType }[];
}
/** Several single-column lists side by side (doc_code): one SQL row per (List, value). */
interface ListsDef { kind: 'lists'; table: string; sheet: string; headerRow: number; startRow: number; valueName: string; cols: string[] }
/** Grids (EXIT): segments side by side, outcome blocks stacked, LTV bands × DQ buckets in each. */
interface GridDef { kind: 'grid'; table: string; sheet: string; segmentCols: string[]; blockRows: number[]; bands: number; buckets: number }
type Def = ListDef | ListsDef | GridDef;

const STATE_COLUMNS = ['State', 'Region', 'Sub_Region', 'Judicial', 'Foreclosure', 'Prop_Sale', 'Prop_Tax_Rate', 'Probate_Special_Admin', 'Original_Doc', 'HOA_Superlien', 'UAL'];

const DEFS: Def[] = [
  { kind: 'grid', table: 'EXIT', sheet: 'EXIT', segmentCols: ['A', 'S', 'AK', 'BC'], blockRows: [6, 20, 34, 48], bands: 10, buckets: 14 },
  { kind: 'grid', table: 'EXIT_BPL', sheet: 'EXIT BPL', segmentCols: ['A', 'S'], blockRows: [6, 20, 34, 48], bands: 10, buckets: 14 },
  { kind: 'list', table: 'ZIP3', sheet: 'ZIP3', startRow: 11, key: ['Zip3'], columns: [
    { name: 'Prop_State', col: 'A' }, { name: 'Zip3', col: 'B', type: 'text' }, { name: 'Prop_Sale_Pct_CV', col: 'C' }, { name: 'Note_Sale_Pct_CV', col: 'D' }] },
  { kind: 'lists', table: 'doc_code', sheet: 'doc_code', headerRow: 5, startRow: 6, valueName: 'ST', cols: ['A', 'B', 'C'] },
  { kind: 'list', table: 'fade_code', sheet: 'fade_code', startRow: 13, key: ['BPO_Value'], sortBy: 'BPO_Value', columns: [
    { name: 'BPO_Value', col: 'A' }, { name: 'Value_Group', col: 'B' }, { name: 'Occupied', col: 'C' }, { name: 'Vacant', col: 'D' }, { name: 'Rural', col: 'E' },
    { name: 'Condo_PUD', col: 'F' }, { name: 'Multi_Unit', col: 'G' }, { name: 'Mobile_Manu', col: 'H' }, { name: 'Fair', col: 'I' }, { name: 'Poor', col: 'J' }] },
  { kind: 'list', table: 'fade_code_groups', sheet: 'fade_code', startRow: 2, key: ['Fade'], sortBy: 'Fade', columns: [
    { name: 'Fade', col: 'A' }, { name: 'Fade_Group', col: 'B' }] },
  { kind: 'list', table: 'occupancy_code', sheet: 'occupancy_code', startRow: 2, key: ['Occupancy'], columns: [
    { name: 'Occupancy', col: 'A' }, { name: 'Occ_JB', col: 'B' }] },
  { kind: 'list', table: 'proptype_code', sheet: 'proptype_code', startRow: 2, key: ['Property_Type'], columns: [
    { name: 'Property_Type', col: 'A' }, { name: 'Prop_Type_JB', col: 'B' }] },
  { kind: 'list', table: 'purpose_code', sheet: 'purpose_code', startRow: 2, key: ['Loan_Purpose'], columns: [
    { name: 'Loan_Purpose', col: 'A' }, { name: 'Purpose_JB', col: 'B' }] },
  { kind: 'list', table: 'SOL_code', sheet: 'SOL_code', startRow: 6, key: ['ST'], columns: [
    { name: 'State', col: 'A' }, { name: 'ST', col: 'B', type: 'text' }, { name: 'Promissory', col: 'C' }, { name: 'Open_Account', col: 'D' },
    { name: 'Written', col: 'E' }, { name: 'Oral', col: 'F' }, { name: 'Source', col: 'G', type: 'text' }, { name: 'Source_2', col: 'H', type: 'text' }] },
  { kind: 'list', table: 'state_code', sheet: 'state_code', startRow: 2, key: ['State'],
    columns: STATE_COLUMNS.map((name, i) => ({ name, col: String.fromCharCode(65 + i), ...(i === 0 ? { type: 'text' as const } : {}) })) },
  { kind: 'list', table: 'state_code_alt', sheet: 'state_code', startRow: 2, key: ['State'],
    columns: STATE_COLUMNS.map((name, i) => ({ name, col: String.fromCharCode(77 + i), ...(i === 0 ? { type: 'text' as const } : {}) })) },
  { kind: 'list', table: 'state_names', sheet: 'state_code', startRow: 2, key: ['ST'], columns: [
    { name: 'ST', col: 'Y', type: 'text' }, { name: 'State_Name', col: 'Z', type: 'text' }] },
  { kind: 'list', table: 'value_code', sheet: 'value_code', startRow: 2, key: ['Acq_Value'], sortBy: 'Acq_Value', columns: [
    { name: 'Acq_Value', col: 'A' }, { name: 'Value_Group', col: 'B' }] },
];

const colNum = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number): string => (n <= 0 ? '' : colName(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

type Value = string | number | null;
function cellValue(v: ExcelJS.CellValue): Value {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String((v as { hyperlink: string }).hyperlink);
    return null;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v == null || v === '') return null;
  return typeof v === 'number' ? v : String(v).trim();
}
/** A column name from a header: "61+" -> DQ_61_Plus, "4-6" -> DQ_4_6, "D30" -> DQ_D30. */
const bucketName = (h: string) => `DQ_${h.replace(/\+/g, '_Plus').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')}`;

/** Runtime description of a table, used by the app to read it and write it into the model. */
export interface LookupSpec {
  table: string; sheet: string; kind: 'list' | 'lists' | 'grid';
  key: string[]; columns: { name: string; type: ColType; col?: string }[];
  startRow?: number; endRow?: number; sortBy?: string;
  lists?: { name: string; col: string }[];
  segments?: { name: string; basis: string | null; col: string }[];
  blocks?: { name: string; row: number }[]; bands?: string[]; buckets?: string[];
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(modelPath);
  const specs: LookupSpec[] = [];
  const rows: Record<string, Record<string, Value>[]> = {};

  for (const def of DEFS) {
    const ws = wb.getWorksheet(def.sheet);
    if (!ws) throw new Error(`The model workbook has no sheet "${def.sheet}"`);
    const at = (row: number, col: string) => cellValue(ws.getRow(row).getCell(colNum(col)).value);

    if (def.kind === 'list') {
      const keyCol = def.columns.find((c) => c.name === def.key[0])!.col;
      let endRow = def.startRow;
      for (let r = def.startRow; at(r, keyCol) != null; r++) endRow = r;
      const data: Record<string, Value>[] = [];
      for (let r = def.startRow; r <= endRow; r++) data.push(Object.fromEntries(def.columns.map((c) => [c.name, at(r, c.col)])));
      const columns = def.columns.map((c) => ({
        name: c.name, col: c.col,
        type: c.type ?? (data.every((d) => d[c.name] == null || typeof d[c.name] === 'number') ? 'number'
          : data.some((d) => typeof d[c.name] === 'number') ? 'auto' : 'text') as ColType,
      }));
      for (const d of data) for (const c of columns) if (c.type !== 'number' && d[c.name] != null) d[c.name] = String(d[c.name]);
      specs.push({ table: def.table, sheet: def.sheet, kind: 'list', key: def.key, columns, startRow: def.startRow, endRow, ...(def.sortBy ? { sortBy: def.sortBy } : {}) });
      rows[def.table] = data;
    } else if (def.kind === 'lists') {
      const lists = def.cols.map((col) => ({ name: String(at(def.headerRow, col)), col }));
      const data: Record<string, Value>[] = [];
      let endRow = def.startRow;
      for (const l of lists) for (let r = def.startRow; at(r, l.col) != null; r++) { data.push({ List: l.name, [def.valueName]: String(at(r, l.col)) }); endRow = Math.max(endRow, r); }
      specs.push({ table: def.table, sheet: def.sheet, kind: 'lists', key: ['List', def.valueName],
        columns: [{ name: 'List', type: 'text' }, { name: def.valueName, type: 'text' }], startRow: def.startRow, endRow, lists });
      rows[def.table] = data;
    } else {
      const first = def.blockRows[0];
      const buckets = [...Array(def.buckets).keys()].map((i) => bucketName(String(at(first - 1, colName(colNum(def.segmentCols[0]) + 2 + i)))));
      const segments = def.segmentCols.map((col) => ({ name: String(at(4, col)), basis: at(2, col) == null ? null : String(at(2, col)), col }));
      const blocks = def.blockRows.map((row) => ({ name: String(at(row, colName(colNum(def.segmentCols[0]) + 1))), row }));
      const bands = [...Array(def.bands).keys()].map((i) => String(at(first + 1 + i, def.segmentCols[0])));
      const data: Record<string, Value>[] = [];
      for (const s of segments) for (const b of blocks) for (let i = 0; i < def.bands; i++) {
        const r = b.row + 1 + i, c0 = colNum(s.col);
        const row: Record<string, Value> = { Basis: s.basis, Segment: s.name, Outcome: b.name, LTV_Band: String(at(r, s.col)), LTV_From: at(r, colName(c0 + 1)) };
        buckets.forEach((name, j) => { row[name] = at(r, colName(c0 + 2 + j)); });
        data.push(row);
      }
      specs.push({ table: def.table, sheet: def.sheet, kind: 'grid', key: ['Segment', 'Outcome', 'LTV_Band'],
        columns: [{ name: 'Basis', type: 'text' }, { name: 'Segment', type: 'text' }, { name: 'Outcome', type: 'text' }, { name: 'LTV_Band', type: 'text' },
          { name: 'LTV_From', type: 'number' }, ...buckets.map((name) => ({ name, type: 'number' as const }))],
        segments, blocks, bands, buckets });
      rows[def.table] = data;
    }
    console.log(`${def.table}: ${rows[def.table].length} rows`);
  }

  // ---- SQL ----
  const sqlType = (c: { name: string; type: ColType }, key: boolean) =>
    c.type === 'number' ? `FLOAT ${key ? 'NOT NULL' : 'NULL'}` : key ? 'NVARCHAR(200) NOT NULL' : 'NVARCHAR(400) NULL';
  const ddl = specs.map((s) => `IF OBJECT_ID('dbo.${s.table}') IS NULL
CREATE TABLE dbo.[${s.table}] (
  [Table_Type] NVARCHAR(50) NOT NULL DEFAULT N'${TABLE_TYPE}',
${s.columns.map((c) => `  [${c.name}] ${sqlType(c, s.key.includes(c.name))}`).join(',\n')},
  CONSTRAINT PK_${s.table} PRIMARY KEY ([Table_Type], ${s.key.map((k) => `[${k}]`).join(', ')})
);
GO`).join('\n\n');
  mkdirSync(resolve(root, 'docs'), { recursive: true });
  writeFileSync(resolve(root, 'docs/lookup-tables.sql'), `-- The model workbook's lookup sheets as Fabric SQL tables (database "gitsit-test"). Generated by
-- packages/frontend/scripts/gen-lookups.ts. Safe to rerun: each table is only created when missing.
-- The app fills empty tables from the workbook, then reads the ${TABLE_TYPE} rows each time it opens and
-- writes them into the model before calculating, so a value changed here changes the results.

${ddl}
`);

  const outDir = resolve(here, '../src/store/generated');
  writeFileSync(resolve(outDir, 'lookup-fields.ts'), `// Generated by scripts/gen-lookups.ts - do not edit by hand.

/** This model's category: Table_Type of every row it reads and writes. */
export const TABLE_TYPE = ${JSON.stringify(TABLE_TYPE)};

export interface LookupSpec {
  table: string; sheet: string; kind: 'list' | 'lists' | 'grid';
  key: readonly string[]; columns: readonly { name: string; type: 'text' | 'number' | 'auto'; col?: string }[];
  startRow?: number; endRow?: number; sortBy?: string;
  lists?: readonly { name: string; col: string }[];
  segments?: readonly { name: string; basis: string | null; col: string }[];
  blocks?: readonly { name: string; row: number }[]; bands?: readonly string[]; buckets?: readonly string[];
}

/** The lookup tables and where each one's values sit in the model workbook. */
export const LOOKUP_TABLES: readonly LookupSpec[] = ${JSON.stringify(specs, null, 2)};
`);
  writeFileSync(resolve(outDir, 'lookup-rows.json'), JSON.stringify(rows));
}

await main();
