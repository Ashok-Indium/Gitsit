// Generates the Fabric SQL tables for the input tape and the calculated model, plus the column
// maps and tape rows the app uses to fill them.
//
//   node scripts/gen-store.ts [input.xlsx] [model.xlsx]
//
// Writes:
//   docs/setup-database.sql                               (Input_table, Loan_Model, Loan_Model_Monthly)
//   docs/Input_table-merge.sql                            (pipeline upsert into Input_table)
//   packages/frontend/src/store/generated/store-fields.ts (column maps)
//   packages/frontend/src/store/generated/input-rows.json (tape rows)
//
// Re-run after the input tape's or the model's columns change, then rerun the SQL setup for the
// changed tables and regenerate the connector entities (see docs/setup-database.sql).

import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDITABLE_COLS } from '../src/engine/model-schema.ts';
import type { ModelTemplate } from '../src/engine/template.ts';
import { camelCase } from '../src/store/column-names.ts';
import { TABLE_TYPE } from '../src/store/generated/lookup-fields.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const tapePath = resolve(process.argv[2] ?? resolve(root, 'data/Pacific Private Money - input.xlsx'));
const modelPath = resolve(process.argv[3] ?? resolve(root, 'data/Pacific Private Money - model.xlsx'));
/** The source the rows came from, stored in every table's File_Name: "Pacific Private Money - input.xlsx" -> "Pacific Private Money". */
const FILE_NAME = basename(tapePath).replace(/\.[^.]+$/, '').replace(/\s*-\s*input$/i, '').trim();
const FILE_NAME_SQL = `[File_Name] NVARCHAR(200) NOT NULL DEFAULT N'${FILE_NAME.replace(/'/g, "''")}'`;
/** The model's category, the first column of every table (see scripts/gen-lookups.ts). */
const TABLE_TYPE_SQL = `[Table_Type] NVARCHAR(50) NOT NULL DEFAULT N'${TABLE_TYPE}'`;

const TEXT_MAX = 400;
/** Fields a connector entity may map (SQL's own limit is 1,024); Loan_Model must stay within it. */
const MAX_COLUMNS = 1000;
const MODEL_HEADER_ROW = 10;
/** Month columns in Loan_Model_Monthly (m01..m36). */
const MONTHS = 36;

type ColType = 'text' | 'decimal' | 'date';

/**
 * A SQL/GraphQL-safe column name: "# Units" -> num_units, "CF$ t-24" -> cf_usd_t_24. Unique
 * also as a connector property (zip_3 and zip3 both become zip3 there), so `used` holds those.
 */
function columnName(header: string, used: Set<string>): string {
  let n = header.trim().toLowerCase()
    .replace(/#/g, ' num ').replace(/\$/g, ' usd ').replace(/%/g, ' pct ').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) n = 'column';
  if (/^\d/.test(n)) n = 'c_' + n;
  if (n === 'id') n = 'source_id';
  let unique = n;
  for (let i = 2; used.has(camelCase(unique)); i++) unique = `${n}_${i}`;
  used.add(camelCase(unique));
  return unique;
}

interface Col { name: string; source: string; type: ColType }
type ModelCol = Col & { header: string; col: string };
interface Series { series: string; periods: string; cols: string[] }

const STAMPS: Col[] = [
  { name: 'changed_by', source: 'Who last changed the loan', type: 'text' },
  { name: 'user_email', source: 'Sign-in email of who last changed the loan', type: 'text' },
  { name: 'modifiedon', source: 'When the loan was last written', type: 'date' },
];

/** Excel's value for a cell: formula results, rich text joined; errors and uncached formulas as undefined. */
function cellValue(v: ExcelJS.CellValue): ExcelJS.CellValue | undefined {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return undefined;
  }
  return v;
}

/** Excel's text for a header cell, dates as "Nov-25". */
function headerText(v: ExcelJS.CellValue): string {
  const x = cellValue(v);
  if (x instanceof Date) return x.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', '-');
  return x == null ? '' : String(x).replace(/\s+/g, ' ').trim();
}

/** A monthly block: the 36 cash-flow months of a scenario ("1".."36") or a "<name> t+N" schedule. */
const monthlyFamily = (h: string) => (/^\d+$/.test(h) ? 'strip' : / t[+-]?\d*$/.test(h) ? h.replace(/ t[+-]?\d*$/, '') : null);

/**
 * Reads the Model sheet and splits it in two: the columns with one value per loan (Loan_Model,
 * in sheet order) and the numeric month-by-month blocks (Loan_Model_Monthly, one row per loan
 * and series). Text and date history blocks stay in Loan_Model. Types come from the loan
 * values Excel saved: all numbers -> decimal, all dates -> date, else text.
 */
async function readModel(): Promise<{ cols: ModelCol[]; series: Series[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(modelPath);
  const ws = wb.getWorksheet('Model');
  if (!ws) throw new Error('The model workbook has no Model sheet');
  // The loans Excel shows: the block under the header up to the first empty Loan ID, less the
  // spare slots its filter hides (the notes further down are not loans).
  const loanRows: ExcelJS.Row[] = [];
  for (let r = MODEL_HEADER_ROW + 1; ws.getRow(r).getCell(1).value != null; r++) if (!ws.getRow(r).hidden) loanRows.push(ws.getRow(r));
  const header = ws.getRow(MODEL_HEADER_ROW);
  const letter = (c: number) => header.getCell(c).address.replace(/\d+$/, '');
  const kindsOf = (c: number) => {
    const kinds = new Set<string>();
    for (const row of loanRows) {
      const v = cellValue(row.getCell(c).value);
      if (v == null || v === '' || v === 'NA' || v === 'na') continue;
      kinds.add(v instanceof Date ? 'date' : typeof v);
    }
    return kinds;
  };

  // Month-by-month blocks, named from the scenario title above them ("DCF - Perf" -> "Perf CF").
  const blocks: { family: string; start: number; end: number; title?: string }[] = [];
  let title: string | undefined;
  for (let c = 1; c <= ws.columnCount; c++) {
    const t = headerText(ws.getRow(6).getCell(c).value).match(/^DCF - (.+)$/);
    if (t) title = t[1];
    const f = monthlyFamily(headerText(header.getCell(c).value));
    const last = blocks.at(-1);
    if (f && last && last.family === f && last.end === c - 1) { last.end = c; continue; }
    if (f) { blocks.push({ family: f, start: c, end: c, title: f === 'strip' ? title : undefined }); if (f === 'strip') title = undefined; }
  }
  const numeric = (b: (typeof blocks)[number]) => {
    const kinds = new Set<string>();
    for (let c = b.start; c <= b.end; c++) for (const k of kindsOf(c)) kinds.add(k);
    return [...kinds].every((k) => k === 'number');
  };
  // Text/date history (String, CF Y/N, Due Date...) has no numbers to chart and stays in Loan_Model.
  const historyText = new Set(['String', 'CF Y/N', 'NDD+ Y/N', 'Due Date']);
  const monthly = blocks.filter((b) => !historyText.has(b.family) && numeric(b));
  const inMonthly = new Set(monthly.flatMap((b) => [...Array(b.end - b.start + 1).keys()].map((i) => b.start + i)));
  const series: Series[] = monthly.map((b) => {
    const first = headerText(header.getCell(b.start).value);
    const last = headerText(header.getCell(b.end).value);
    if (b.end - b.start + 1 > MONTHS) throw new Error(`${b.family} has more than ${MONTHS} months`);
    return {
      series: b.family === 'strip' ? `${b.title ?? 'Interim'} CF` : b.family,
      periods: b.family === 'strip' ? `month ${first}-${last}` : `${first.replace(b.family, '').trim()} to ${last.replace(b.family, '').trim()}`,
      cols: [...Array(b.end - b.start + 1).keys()].map((i) => letter(b.start + i)),
    };
  });

  // Columns the app can never fill are left out: no formula, no value for any loan, and not
  // filled from Input_table, a per-loan default or an edit (the "x" separators, and blocks such
  // as String t-24.. that the model leaves for hand entry). This keeps Loan_Model within the
  // 1,000 fields a connector entity may map.
  const template = JSON.parse(readFileSync(resolve(here, '../src/engine/generated/model-template.json'), 'utf8')) as ModelTemplate;
  const filled = new Set([
    ...template.tapeColumns.filter((i) => i >= 0).map((i) => letter(i + 1)),
    ...Object.keys(template.loanDefaults), ...Object.keys(template.emptyDefaults), ...Object.keys(template.fillFormulas),
    ...Object.values(template.loanConstants).flatMap((c) => Object.keys(c)),
    ...EDITABLE_COLS,
  ]);
  const neverFilled = (c: number) => !filled.has(letter(c)) && loanRows.every((row) => {
    const v = row.getCell(c).value;
    return v == null || v === '' || (typeof v === 'object' && !(v instanceof Date) && !('formula' in v || 'sharedFormula' in v) && cellValue(v) == null);
  }) && !loanRows.some((row) => { const v = row.getCell(c).value; return v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v); });

  const used = new Set(['loan_id', ...STAMPS.map((s) => s.name)].map(camelCase));
  const cols: ModelCol[] = [];
  const omitted: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    if (inMonthly.has(c)) continue;
    const h = headerText(header.getCell(c).value);
    const kinds = kindsOf(c);
    if (!h && !kinds.size) continue;
    const col = letter(c);
    // Named before the omission check, so dropping a column never renames another (x_9 stays x_9).
    const name = c === 1 ? 'loan_id' : columnName(h || `col ${col}`, used);
    if (c > 1 && neverFilled(c)) { omitted.push(`${col} ${h || '(no header)'}`); continue; }
    const type: ColType = c === 1 ? 'text'
      : kinds.size && [...kinds].every((k) => k === 'date') ? 'date'
      : kinds.size && [...kinds].every((k) => k === 'number' || k === 'date') ? 'decimal' : 'text';
    cols.push({ name, source: `${h || '(no header)'} (Model!${col})`, header: h, col, type });
  }
  if (cols.length + STAMPS.length > MAX_COLUMNS) throw new Error(`Loan_Model would have ${cols.length + STAMPS.length} columns (a connector entity allows ${MAX_COLUMNS})`);
  console.log(`Left out of Loan_Model (never filled in the app): ${omitted.length}\n  ${omitted.join(', ')}`);
  return { cols, series };
}

/**
 * `number` is the numeric type: DECIMAL(28,10) by default, FLOAT for Loan_Model, whose ~470
 * numbers at 13 bytes each would push a row past SQL's 8,060-byte limit (FLOAT is 8 bytes and
 * is the precision the app calculates in).
 */
const sqlType = (c: Col, number = 'DECIMAL(28,10)') =>
  c.name === 'loan_id' ? 'NVARCHAR(50) NOT NULL PRIMARY KEY'
    : c.type === 'text' ? `NVARCHAR(${TEXT_MAX}) NULL` : c.type === 'date' ? 'DATETIME2 NULL' : `${number} NULL`;
const columnsSql = (cols: Col[], number?: string) => cols.map((c) => `  [${c.name}] ${sqlType(c, number)}`).join(',\n');
const months = [...Array(MONTHS).keys()].map((i) => `m${String(i + 1).padStart(2, '0')}`);

function writeSql(sheet: string, inputCols: Col[], model: { cols: ModelCol[]; series: Series[] }) {
  const docs = resolve(root, 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(resolve(docs, 'setup-database.sql'), `-- The Gitsit app's tables in the Fabric SQL database "gitsit-test". Generated by
-- packages/frontend/scripts/gen-store.ts. Run all of it in the database's query editor; it is safe to\n-- rerun, since each table is only created when it does not exist yet.
-- The app reads and writes all four through the Fabric GraphQL item gitsit_test_gql. Table_Type, the first column of
-- every table, is the model's category (${TABLE_TYPE}). File_Name defaults to the input
-- file's name, so a pipeline load that leaves it out still records where the rows came from.

-- Earlier layouts, no longer used.
DROP VIEW IF EXISTS report.InputLoans;
DROP VIEW IF EXISTS report.LoanModels;
DROP VIEW IF EXISTS report.LoanChanges;
IF SCHEMA_ID('report') IS NOT NULL EXEC('DROP SCHEMA report');
DROP VIEW IF EXISTS dbo.LoanModels;
GO

-- Input_table: the input tape ("${sheet}"), one row per loan, the ${inputCols.length} columns of the input
-- file in the same order. Loaded by a Fabric pipeline (see Input_table-merge.sql).
IF OBJECT_ID('dbo.Input_table') IS NULL
CREATE TABLE dbo.Input_table (
  ${TABLE_TYPE_SQL},
${columnsSql(inputCols)},
  ${FILE_NAME_SQL}
);
GO

-- Loan_Model: one row per loan, the Model sheet's ${model.cols.length} one-value columns in sheet order, plus who
-- last changed the loan. The app recalculates it from Input_table and rewrites changed loans.
IF OBJECT_ID('dbo.Loan_Model') IS NULL
CREATE TABLE dbo.Loan_Model (
  ${TABLE_TYPE_SQL},
${columnsSql([...model.cols, ...STAMPS], 'FLOAT')},
  ${FILE_NAME_SQL}
) WITH (DATA_COMPRESSION = ROW);
GO

-- Loan_Model_Monthly: the Model sheet's month-by-month blocks (for the cash-flow charts), one row per
-- loan and series, months in m01..m${MONTHS}:
${model.series.map((s) => `--   ${s.series.padEnd(14)} ${s.periods.padEnd(16)} Model!${s.cols[0]}:${s.cols.at(-1)}`).join('\n')}
IF OBJECT_ID('dbo.Loan_Model_Monthly') IS NULL
CREATE TABLE dbo.Loan_Model_Monthly (
  ${TABLE_TYPE_SQL},
  [loan_id] NVARCHAR(50) NOT NULL,
  [series] NVARCHAR(50) NOT NULL,
  [periods] NVARCHAR(50) NULL,
${months.map((m) => `  [${m}] DECIMAL(28,10) NULL`).join(',\n')},
  ${FILE_NAME_SQL},
  CONSTRAINT PK_Loan_Model_Monthly PRIMARY KEY ([loan_id], [series])
);
GO

-- LoanChanges: one row per edited value in the app (written by the app, read back to replay edits).
-- Column_Name is the Loan_Model column. A reset back to the model's own value is logged with
-- New_Value "<value> (reset)".
IF OBJECT_ID('dbo.LoanChanges') IS NULL
CREATE TABLE dbo.LoanChanges (
  ${TABLE_TYPE_SQL},
  [File_Name] NVARCHAR(200) NOT NULL,
  [Loan_Id] NVARCHAR(50) NOT NULL,
  [Column_Name] NVARCHAR(128) NOT NULL,
  [Old_Value] NVARCHAR(400) NULL,
  [New_Value] NVARCHAR(400) NULL,
  [User_mail] NVARCHAR(320) NOT NULL,
  [Changed_On] DATETIME2 NOT NULL,
  CONSTRAINT PK_LoanChanges PRIMARY KEY ([File_Name], [Loan_Id], [Column_Name], [Changed_On])
);
GO
`);
  const list = (prefix = '') => inputCols.map((c) => `${prefix}[${c.name}]`).join(', ');
  writeFileSync(resolve(docs, 'Input_table-merge.sql'), `-- Upsert the day's input loans from a staging table into dbo.Input_table (read by the Gitsit app).
-- Generated by packages/frontend/scripts/gen-store.ts; regenerate if the columns change.
--
-- Simplest pipeline: a Copy activity from the input file straight into dbo.Input_table
-- (table option "Upsert" on key loan_id, or truncate before load when each file is the full pool).
-- Use this script instead when you stage first:
-- 1. Create the staging table once (same columns as Input_table).
-- 2. Each day: the Copy activity truncates and loads dbo.Input_table_staging.
-- 3. Then a Script activity runs the MERGE below.

IF OBJECT_ID('dbo.Input_table_staging') IS NULL
CREATE TABLE dbo.Input_table_staging (
${inputCols.map((c) => `  [${c.name}] ${sqlType(c).replace(' PRIMARY KEY', '')}`).join(',\n')}
);
-- (run the CREATE once, separately from the daily MERGE)

MERGE dbo.Input_table AS t
USING (SELECT * FROM dbo.Input_table_staging) AS s
  ON t.[loan_id] = s.[loan_id]
WHEN MATCHED THEN UPDATE SET
${inputCols.filter((c) => c.name !== 'loan_id').map((c) => `  t.[${c.name}] = s.[${c.name}]`).join(',\n')}
WHEN NOT MATCHED BY TARGET THEN INSERT (${list()})
  VALUES (${list('s.')})
-- Only if each day's file is the complete pool: remove loans that are no longer in it.
-- WHEN NOT MATCHED BY SOURCE THEN DELETE
;
`);
}

async function main() {
  // ---- input tape ----
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(tapePath);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  // Same normalisation as the model build, so the two can be matched header by header.
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(c.value ?? `Column ${i}`).replace(/\s+/g, ' ').trim(); });
  const raw: unknown[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.getCell(1).value == null) continue;
    raw.push(headers.map((_, i) => {
      const v = row.getCell(i + 1).value;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('result' in v) return v.result;
        if ('richText' in v) return v.richText.map((t) => t.text).join('');
        if ('text' in v) return v.text;
        return null;
      }
      return v;
    }));
  }
  const used = new Set<string>();
  const inputCols: Col[] = headers.map((h, i) => {
    const kinds = new Set(raw.map((r) => r[i]).filter((v) => v != null && v !== '').map((v) => (v instanceof Date ? 'date' : typeof v)));
    const type: ColType = i === 0 ? 'text' : kinds.size === 1 && kinds.has('number') ? 'decimal' : kinds.size === 1 && kinds.has('date') ? 'date' : 'text';
    return { name: i === 0 ? 'loan_id' : columnName(h, used), source: h, type };
  });
  used.add(camelCase('loan_id'));
  const inputRows = raw.map((r) => Object.fromEntries(inputCols.flatMap((c, i) => {
    const v = r[i];
    if (v == null || v === '') return [];
    if (c.type === 'date') return [[c.name, (v as Date).toISOString()]];
    if (c.type === 'decimal') return [[c.name, v]];
    // Excel reads the delinquency bucket "1-30" as January 1930; store the text people typed.
    if (c.name === 'seller_status' && v instanceof Date) return [[c.name, `${v.getUTCMonth() + 1}-${String(v.getUTCFullYear()).slice(2)}`]];
    return [[c.name, (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).slice(0, TEXT_MAX)]];
  })));

  // ---- calculated model ----
  const model = await readModel();

  // ---- write ----
  writeSql(ws.name, inputCols, model);
  const outDir = resolve(here, '../src/store/generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'store-fields.ts'), `// Generated by scripts/gen-store.ts - do not edit by hand.

/** Input_table columns: table column name and the tape header it came from. */
export const INPUT_COLUMNS = ${JSON.stringify(inputCols.map((c) => ({ name: c.name, header: c.source, type: c.type })), null, 2)} as const;

/** Loan_Model columns: table column name, Model header, Model column letter and SQL type. */
export const MODEL_COLUMNS = ${JSON.stringify(model.cols.map((c) => ({ name: c.name, header: c.header, col: c.col, type: c.type })), null, 2)} as const;

/** Loan_Model_Monthly series: name, what m01.. stand for, and the Model columns in month order. */
export const MONTHLY_SERIES = ${JSON.stringify(model.series, null, 2)} as const;

/** The File_Name stored in every table for rows from this input file. */
export const FILE_NAME = ${JSON.stringify(FILE_NAME)};

/** Loan_Model_Monthly month columns. */
export const MONTH_COLUMNS = ${JSON.stringify(months)} as const;
`);
  writeFileSync(resolve(outDir, 'input-rows.json'), JSON.stringify(inputRows));
  console.log(`Input_table: ${inputCols.length} columns, ${inputRows.length} loans`);
  console.log(`Loan_Model: ${model.cols.length} + ${STAMPS.length} columns`);
  console.log(`Loan_Model_Monthly: ${model.series.length} series (${model.series.map((s) => `${s.series} ${s.cols.length}`).join(', ')})`);
}

await main();
