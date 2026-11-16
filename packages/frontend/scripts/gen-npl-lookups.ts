// Fills the NPL lookup tables (NPL_Lookups.NPL_…) from an NPL tape workbook's lookup sheets (EXIT,
// EXIT BPL, ZIP3, doc_code, fade_code, occupancy_code, proptype_code, purpose_code, SOL_code,
// state_code, value_code), laid out as the model workbook's.
//
//   node scripts/gen-npl-lookups.ts [NPL tape.xlsx]
//
// Writes docs/npl-lookup-values.sql: in one transaction, each NPL_ table's rows replaced with the
// workbook's (Table_Type NPL). Checks first that every sheet has the model's layout (the same
// columns, EXIT segments, outcomes, LTV bands and DQ buckets), that number columns hold numbers,
// text fits its column and keys are unique, since the app writes these values into the model's
// cells by that layout.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOOKUP_TABLES } from '../src/store/generated/lookup-fields.ts';
import { readLookupSheets } from './gen-lookups.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const tapePath = resolve(process.argv[2] ?? resolve(root, '../NPL_Groundfloor Tape.xlsx'));
const SCHEMA = 'NPL_Lookups';
const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');

interface Column { columnName: string; dataType: string; maxLength?: number }
const tables = (JSON.parse(readFileSync(resolve(root, 'docs/table-schema.json'), 'utf8')) as { schemas: { schemaName: string; tables: { tableName: string; columns: Column[] }[] }[] })
  .schemas.find((s) => s.schemaName === 'dbo')!.tables;
const isNumber = (c: Column) => ['float', 'real', 'decimal', 'numeric'].includes(c.dataType.toLowerCase());

const { specs, rows } = await readLookupSheets(tapePath, true);
const problems: string[] = [];
const same = (what: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${what}: the model has ${JSON.stringify(b)}, the tape ${JSON.stringify(a)}`);
};

const sql: string[] = [];
for (const model of LOOKUP_TABLES) {
  const spec = specs.find((s) => s.table === model.table)!;
  const data = rows[model.table];
  // The layout the app writes the values into the model by.
  same(`${model.table} columns`, spec.columns.map((c) => c.name), model.columns.map((c) => c.name));
  if (model.kind === 'lists') same(`${model.table} lists`, spec.lists?.map((l) => l.name), model.lists?.map((l) => l.name));
  if (model.kind === 'grid') {
    same(`${model.table} segments`, spec.segments?.map((s) => s.name), model.segments?.map((s) => s.name));
    same(`${model.table} outcomes`, spec.blocks?.map((b) => b.name), model.blocks?.map((b) => b.name));
    same(`${model.table} LTV bands`, spec.bands, model.bands);
    same(`${model.table} DQ buckets`, spec.buckets, model.buckets);
  }

  const columns = (tables.find((t) => t.tableName === model.table)?.columns ?? []).filter((c) => c.columnName !== 'Table_Type');
  const keys = new Set<string>();
  for (const [i, r] of data.entries()) {
    const key = model.key.map((k) => String(r[k] ?? '')).join(' | ');
    if (model.key.some((k) => r[k] == null || r[k] === '')) problems.push(`${model.table} row ${i + 1}: no ${model.key.join(' + ')}`);
    else if (keys.has(key.toLowerCase())) problems.push(`${model.table}: ${model.key.join(' + ')} "${key}" appears twice`);
    keys.add(key.toLowerCase());
    for (const c of columns) {
      const v = r[c.columnName];
      if (v == null) continue;
      if (isNumber(c) && typeof v !== 'number') problems.push(`${model.table} row ${i + 1}: ${c.columnName} "${v}" is not a number`);
      if (!isNumber(c) && String(v).length > (c.maxLength && c.maxLength > 0 ? c.maxLength : 400)) problems.push(`${model.table} row ${i + 1}: ${c.columnName} is too long`);
    }
  }

  const table = `[${SCHEMA}].[NPL_${pascal(model.table)}]`;
  const list = ['Table_Type', ...columns.map((c) => c.columnName)];
  const literal = (c: Column, v: unknown) => (v == null ? 'NULL' : isNumber(c) ? String(v) : `N'${String(v).replace(/'/g, "''")}'`);
  const values = data.map((r) => `(N'NPL', ${columns.map((c) => literal(c, r[c.columnName])).join(', ')})`);
  sql.push(`-- ${table}: ${data.length} rows from the "${model.sheet}" sheet.
DELETE FROM ${table};
${Array.from({ length: Math.ceil(values.length / 500) }, (_, i) => `INSERT INTO ${table} (${list.map((c) => `[${c}]`).join(', ')}) VALUES
${values.slice(i * 500, i * 500 + 500).join(',\n')};`).join('\n')}`);
  console.log(`${model.table}: ${data.length} rows`);
}

if (problems.length) {
  console.error(`Not written: ${tapePath} doesn't match the model's lookup layout.\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(resolve(root, 'docs/npl-lookup-values.sql'), `-- The NPL lookup tables (${SCHEMA}.NPL_…) filled from "${tapePath.split(/[\\/]/).pop()}": each table's rows
-- replaced with the workbook's, all or nothing. Generated by packages/frontend/scripts/gen-npl-lookups.ts.

SET XACT_ABORT ON;
BEGIN TRANSACTION;
${sql.join('\n')}
COMMIT;
GO
`);
console.log('docs/npl-lookup-values.sql written');
