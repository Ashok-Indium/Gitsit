// Generates the app's Rayfin data entities (the data service owns the tables in gitsit-test), the
// table map the app reads and writes with, and the SQL that moves the existing tables over and puts
// views with the original names (Input_table, Loan_Model …) on top of the data-service tables, and
// the BPL_Lookups and NPL_Lookups tables people edit the lookups in (docs/bpl-lookup-tables.sql,
// docs/npl-lookup-tables.sql).
//
//   node scripts/gen-entities.ts
//
// Reads docs/table-schema.json (the original tables' columns, in order). Writes:
//   packages/data/src/entities.ts                          (decorated entity classes)
//   packages/shared/src/schema.ts                          (UniversalAppSchema)
//   packages/frontend/src/store/generated/data-tables.ts   (entity, natural key, columns per table)
//   docs/move-to-data-service.sql                          (one-time copy into the data-service tables)
//   docs/table-views.sql                                   (the views with the original names)
//
// The data service names each table after its class, pluralised (InputLoan -> InputLoans), gives
// every table a UUID `id` key (default NEWID()) and orders columns alphabetically; the views keep
// the original names, the original column order with Table_Type first, and leave `id` out, so the
// tables can still be queried and edited (insert, update, delete) under their usual names.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOOKUP_TABLES } from '../src/store/generated/lookup-fields.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

interface Column { columnName: string; dataType: string; isNullable: boolean; maxLength?: number; unbounded?: boolean }
interface Table { tableName: string; columns: Column[] }

const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');
const ALL = ['create', 'read', 'update', 'delete'];
const READ_CREATE = ['create', 'read'];

/**
 * The app's copy of the lookup tables: one row per lookup (Table_Name = state_names …) holding its
 * rows as JSON. Triggers on the BPL_Lookups tables keep it up to date; the app only reads it. (The
 * data service only reads dbo tables, so this is the one lookup table that stays in dbo.)
 */
const CACHE = {
  table: 'LookupCache', entity: 'LookupCache', key: ['Table_Name'], actions: ['read'],
  columns: [
    { columnName: 'Table_Name', dataType: 'nvarchar', isNullable: false, maxLength: 100 },
    { columnName: 'Rows_Json', dataType: 'nvarchar', isNullable: false, unbounded: true },
  ] as Column[],
};

/** Each table: its entity class, natural key (what identifies a row to the app) and actions. */
const TABLES: { table: string; entity: string; key: string[]; actions: string[]; numbers?: [number, number]; columns?: Column[] }[] = [
  // One input file's loans: the same loan ID may appear in another file.
  { table: 'Input_table', entity: 'InputLoan', key: ['File_Name', 'loan_id'], actions: ALL },
  // DECIMAL(18,8) keeps Loan_Model's ~470 numbers within SQL's 8,060-byte row (9 bytes each, not 13).
  { table: 'Loan_Model', entity: 'LoanModel', key: ['File_Name', 'loan_id'], actions: ALL, numbers: [18, 8] },
  { table: 'Loan_Model_Monthly', entity: 'LoanModelMonthly', key: ['File_Name', 'loan_id', 'series'], actions: ALL },
  // The change log is append-only.
  { table: 'LoanChanges', entity: 'LoanChange', key: ['File_Name', 'Loan_Id', 'Column_Name', 'Changed_On'], actions: READ_CREATE },
  // The lookups are edited in the BPL_Lookups tables; the app reads them from this one table.
  CACHE,
  // (The model constants are in the Constraints schema, outside the data service's reach: the app's
  // functions read and write them. See scripts/gen-constraints.ts.)
];
/** Tables the app creates empty (nothing to move over, no view with an original name). */
const NEW_TABLES = new Set(['LoanChanges', CACHE.table]);

const DEFAULTS: Record<string, string> = { Table_Type: 'BPL' };

function decorator(c: Column, numbers: [number, number]): { line: string; ts: string } {
  const t = c.dataType.toLowerCase();
  const opts: string[] = [];
  let name: string, ts: string;
  if (['float', 'real', 'decimal', 'numeric'].includes(t)) {
    name = 'decimal'; ts = 'number';
    opts.push(`precision: ${numbers[0]}`, `scale: ${numbers[1]}`);
  } else if (['datetime2', 'datetime', 'date'].includes(t)) {
    name = 'date'; ts = 'Date';
  } else {
    name = 'text'; ts = 'string';
    if (!c.unbounded) opts.push(`max: ${c.maxLength && c.maxLength > 0 ? c.maxLength : 400}`);
  }
  if (DEFAULTS[c.columnName]) opts.push(`default: '${DEFAULTS[c.columnName]}'`);
  else if (c.isNullable) opts.push('optional: true');
  const optional = c.isNullable && !DEFAULTS[c.columnName];
  return { line: `  @${name}(${opts.length ? `{ ${opts.join(', ')} }` : ''}) ${c.columnName}${optional ? '?' : '!'}: ${ts};`, ts };
}

/** The data service's table for an entity: its class name pluralised (LookupZip3 -> LookupZip3s). */
const sourceTable = (entity: string) => (entity.endsWith('s') ? entity : `${entity}s`);
const isNumber = (c: Column) => ['float', 'real', 'decimal', 'numeric'].includes(c.dataType.toLowerCase());
/** The schema (its own folder in the SQL editor) the BPL_ lookup tables live in. */
const LOOKUP_SCHEMA = 'BPL_Lookups';
/** Where earlier versions kept them; the script moves them from there and drops the emptied schema. */
const OLD_LOOKUP_SCHEMAS = ['dbo', 'Lookups'];

/**
 * The lookup tables as people edit them: BPL_Lookups.BPL_<Name> (state_names -> BPL_StateNames)
 * with Table_Type first, then the text columns and then the number columns, each in the workbook's
 * column order; keyed by Table_Type and the lookup's own key, no id, BPL rows only. A trigger on
 * each writes its rows, as JSON, into the app's dbo.LookupCaches row for that lookup.
 */
function bplLookupSql(defs: { table: string; key: string[]; columns: Column[] }[]): string {
  const cache = `dbo.[${sourceTable(CACHE.entity)}]`;
  const blocks = defs.map((d) => {
    const name = `BPL_${pascal(d.table)}`;
    // The data-service table an earlier version kept this lookup in (the first fill comes from it).
    const old = sourceTable(`Lookup${pascal(d.table)}`);
    const rest = d.columns.filter((c) => c.columnName !== 'Table_Type');
    const ordered = [...rest.filter((c) => !isNumber(c)), ...rest.filter(isNumber)];
    const all = ['Table_Type', ...ordered.map((c) => c.columnName)];
    const list = all.map((c) => `[${c}]`).join(', ');
    const column = (c: Column) => {
      const type = isNumber(c) ? 'DECIMAL(28,10)' : `NVARCHAR(${c.maxLength && c.maxLength > 0 ? c.maxLength : 400})`;
      return `  [${c.columnName}] ${type} ${d.key.includes(c.columnName) || !c.isNullable ? 'NOT NULL' : 'NULL'}`;
    };
    const table = `[${LOOKUP_SCHEMA}].[${name}]`;
    const sync = `  DELETE FROM ${cache} WHERE [Table_Name] = N'${d.table}';
  INSERT INTO ${cache} ([Table_Name], [Rows_Json])
  SELECT N'${d.table}', ISNULL((SELECT ${list} FROM ${table} FOR JSON PATH, INCLUDE_NULL_VALUES), N'[]');`;
    return `
-- ${LOOKUP_SCHEMA}.${name}: the ${d.table} lookup (key ${d.key.join(' + ')}); the app reads it from ${cache}.
SET XACT_ABORT ON;
-- An earlier version kept it in ${OLD_LOOKUP_SCHEMAS.join(' or ')}: move it into the ${LOOKUP_SCHEMA} folder.
${OLD_LOOKUP_SCHEMAS.map((s) => `IF OBJECT_ID('[${s}].[${name}]', 'U') IS NOT NULL AND OBJECT_ID('${table}', 'U') IS NULL
  ALTER SCHEMA [${LOOKUP_SCHEMA}] TRANSFER [${s}].[${name}];`).join('\n')}
IF OBJECT_ID('${table}', 'U') IS NULL
BEGIN
  BEGIN TRANSACTION;
  CREATE TABLE ${table} (
    [Table_Type] NVARCHAR(50) NOT NULL CONSTRAINT [DF_${name}_Table_Type] DEFAULT N'BPL' CONSTRAINT [CK_${name}_Table_Type] CHECK ([Table_Type] = N'BPL'),
${ordered.map((c) => `  ${column(c)}`).join(',\n')},
    CONSTRAINT [PK_${name}] PRIMARY KEY (${d.key.map((k) => `[${k}]`).join(', ')})
  );
  -- The values an earlier version of the app held, if any.
  IF OBJECT_ID('dbo.[${old}]', 'U') IS NOT NULL
    EXEC('INSERT INTO ${table} (${list}) SELECT ${list} FROM dbo.[${old}] WHERE [Table_Type] = N''BPL''');
  COMMIT;
END
GO
CREATE OR ALTER TRIGGER [${LOOKUP_SCHEMA}].[trg_${name}_sync] ON ${table} AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  -- Every change replaces the app's copy of this lookup.
${sync}
END
GO
-- The app's copy as of now.
${sync.replace(/^ {2}/gm, '')}
GO
DROP VIEW IF EXISTS dbo.[${d.table}];
GO`;
  });
  return `-- The BPL lookup tables, in their own schema (folder) ${LOOKUP_SCHEMA}: edit these (SELECT / INSERT /
-- UPDATE / DELETE), e.g. ${LOOKUP_SCHEMA}.BPL_StateNames. Each has Table_Type first, then its text columns
-- and its number columns in the model workbook's order, no id column, and its own key as the primary
-- key. A trigger on each copies every change into the app's ${cache} (one row of JSON per lookup),
-- which the app reads. Run after the app's deployment created ${cache}. Safe to rerun.
-- Generated by packages/frontend/scripts/gen-entities.ts.

IF SCHEMA_ID('${LOOKUP_SCHEMA}') IS NULL EXEC('CREATE SCHEMA [${LOOKUP_SCHEMA}]');
GO
${blocks.join('\n')}
${OLD_LOOKUP_SCHEMAS.filter((s) => s !== 'dbo').map((s) => `IF SCHEMA_ID('${s}') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.objects WHERE schema_id = SCHEMA_ID('${s}'))
  EXEC('DROP SCHEMA [${s}]');
GO`).join('\n')}
`;
}

/** The schema of the NPL lookup tables: the BPL_ tables' twins, for input files named NPL_… */
const NPL_SCHEMA = 'NPL_Lookups';

/**
 * The NPL lookup tables: NPL_Lookups.NPL_<Name>, the same columns and keys as the BPL_ tables with
 * Table_Type NPL, filled once with a copy of the BPL rows. The app reads them (through its
 * loadLookups function) for input files whose name starts with NPL; they have no triggers.
 */
function nplLookupSql(defs: { table: string; key: string[]; columns: Column[] }[]): string {
  const blocks = defs.map((d) => {
    const name = `NPL_${pascal(d.table)}`;
    const from = `[${LOOKUP_SCHEMA}].[BPL_${pascal(d.table)}]`;
    const rest = d.columns.filter((c) => c.columnName !== 'Table_Type');
    const ordered = [...rest.filter((c) => !isNumber(c)), ...rest.filter(isNumber)];
    const list = ordered.map((c) => `[${c.columnName}]`).join(', ');
    const column = (c: Column) => {
      const type = isNumber(c) ? 'DECIMAL(28,10)' : `NVARCHAR(${c.maxLength && c.maxLength > 0 ? c.maxLength : 400})`;
      return `  [${c.columnName}] ${type} ${d.key.includes(c.columnName) || !c.isNullable ? 'NOT NULL' : 'NULL'}`;
    };
    const table = `[${NPL_SCHEMA}].[${name}]`;
    return `
-- ${NPL_SCHEMA}.${name}: the ${d.table} lookup for NPL files (key ${d.key.join(' + ')}), first a copy of ${from}.
SET XACT_ABORT ON;
IF OBJECT_ID('${table}', 'U') IS NULL
BEGIN
  BEGIN TRANSACTION;
  CREATE TABLE ${table} (
    [Table_Type] NVARCHAR(50) NOT NULL CONSTRAINT [DF_${name}_Table_Type] DEFAULT N'NPL' CONSTRAINT [CK_${name}_Table_Type] CHECK ([Table_Type] = N'NPL'),
${ordered.map((c) => `  ${column(c)}`).join(',\n')},
    CONSTRAINT [PK_${name}] PRIMARY KEY (${d.key.map((k) => `[${k}]`).join(', ')})
  );
  INSERT INTO ${table} ([Table_Type], ${list}) SELECT N'NPL', ${list} FROM ${from};
  COMMIT;
END
GO`;
  });
  return `-- The NPL lookup tables, in their own schema (folder) ${NPL_SCHEMA}: the BPL_Lookups tables' twins
-- (same columns and keys, Table_Type NPL), e.g. ${NPL_SCHEMA}.NPL_StateNames. The app calculates input
-- files whose name starts with NPL with these and every other file with the BPL_ tables. Each table
-- is created once with a copy of its BPL_ table's rows; edit them freely after. Safe to rerun (an
-- existing table is left as it is). Run after docs/bpl-lookup-tables.sql.
-- Generated by packages/frontend/scripts/gen-entities.ts.

IF SCHEMA_ID('${NPL_SCHEMA}') IS NULL EXEC('CREATE SCHEMA [${NPL_SCHEMA}]');
GO
${blocks.join('\n')}
`;
}

function main() {
  const schema = JSON.parse(readFileSync(resolve(root, 'docs/table-schema.json'), 'utf8')) as { schemas: { schemaName: string; tables: Table[] }[] };
  const tables = schema.schemas.find((s) => s.schemaName === 'dbo')!.tables;
  const columnsOf = (table: string) => {
    const t = tables.find((x) => x.tableName === table);
    if (!t) throw new Error(`dbo.${table} is not in docs/table-schema.json`);
    for (const c of t.columns) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.columnName) || c.columnName === 'id') throw new Error(`${table}.${c.columnName} cannot be an entity property`);
    }
    return t.columns;
  };
  const defs = TABLES.map((d) => ({ ...d, columns: d.columns ?? columnsOf(d.table) }));
  const lookupDefs = LOOKUP_TABLES.map((s) => ({ table: s.table, key: ['Table_Type', ...s.key], columns: columnsOf(s.table) }));

  // ---- entities ----
  writeFileSync(resolve(root, 'packages/data/src/entities.ts'), `// Generated by packages/frontend/scripts/gen-entities.ts - do not edit by hand.
// The app's tables in its SQL database gitsit-test, owned by the Rayfin data service. Each class's
// table is its name pluralised (InputLoan -> InputLoans); docs/table-views.sql puts views with the
// original names (Input_table, EXIT, ZIP3 …) on top of them.

import { authenticated, date, decimal, entity, text, uuid } from '@microsoft/rayfin-core';
${defs.map((d) => `
/** ${d.table}: key ${d.key.join(' + ')}. */
@entity()
@authenticated([${d.actions.map((a) => `'${a}'`).join(', ')}])
export class ${d.entity} {
  @uuid() id!: string;
${d.columns.map((c) => decorator(c, d.numbers ?? [28, 10]).line).join('\n')}
}
`).join('')}
export const ENTITIES = [${defs.map((d) => d.entity).join(', ')}];
`);

  // ---- shared schema type ----
  writeFileSync(resolve(root, 'packages/shared/src/schema.ts'), `// Generated by packages/frontend/scripts/gen-entities.ts - do not edit by hand.

/** A row of one of the app's tables: its \`id\` and its columns by SQL name. */
export type TableRecord = { id: string } & Record<string, string | number | Date | null | undefined>;

export type UniversalAppSchema = {
${defs.map((d) => `  ${d.entity}: TableRecord;`).join('\n')}
};
`);

  // ---- frontend table map ----
  const map = Object.fromEntries(defs.map((d) => [d.table, { entity: d.entity, key: d.key, columns: d.columns.map((c) => c.columnName) }]));
  writeFileSync(resolve(here, '../src/store/generated/data-tables.ts'), `// Generated by scripts/gen-entities.ts - do not edit by hand.

/** Each app table: its data-service entity, the columns that identify a row, and its columns. */
export const DATA_TABLES = ${JSON.stringify(map, null, 2)} as const;
`);

  // ---- SQL: move the data, then the views ----
  const cols = (d: (typeof defs)[number]) => d.columns.map((c) => `[${c.columnName}]`).join(', ');
  writeFileSync(resolve(root, 'docs/move-to-data-service.sql'), `-- One-time move of the app's tables into the Rayfin data-service tables. Generated by
-- packages/frontend/scripts/gen-entities.ts. Run after \`rayfin up db apply\` created the tables.
-- {{table}} placeholders are filled with each entity's table name from the deployed DAB config.
-- Each table: copy, check the row count, drop the original; then docs/table-views.sql.
${defs.filter((d) => !NEW_TABLES.has(d.table)).map((d) => `
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('dbo.[${d.table}]', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.[{{${d.entity}}}])
BEGIN
  INSERT INTO dbo.[{{${d.entity}}}] (${cols(d)}) SELECT ${cols(d)} FROM dbo.[${d.table}];
  IF (SELECT COUNT(*) FROM dbo.[{{${d.entity}}}]) <> (SELECT COUNT(*) FROM dbo.[${d.table}]) THROW 50000, '${d.table}: row count differs', 1;
  DROP TABLE dbo.[${d.table}];
END
COMMIT;
GO`).join('\n')}
`);
  const lookups = new Set(LOOKUP_TABLES.map((s) => s.table));
  writeFileSync(resolve(root, 'docs/table-views.sql'), `-- Views with the app tables' original names over the Rayfin data-service tables, in the original
-- column order with Table_Type first and without the data service's \`id\` (it fills itself in).
-- Query and edit them as before: SELECT / INSERT / UPDATE / DELETE work on each view.
-- (The lookup tables are the ${LOOKUP_SCHEMA}.BPL_ tables instead: docs/bpl-lookup-tables.sql.)
-- Generated by packages/frontend/scripts/gen-entities.ts.
${defs.filter((d) => !NEW_TABLES.has(d.table) && !lookups.has(d.table)).map((d) => `
CREATE OR ALTER VIEW dbo.[${d.table}] AS
SELECT ${cols(d)} FROM dbo.[{{${d.entity}}}];
GO`).join('\n')}
`);

  // ---- SQL: the BPL_ lookup tables people edit ----
  writeFileSync(resolve(root, 'docs/bpl-lookup-tables.sql'), bplLookupSql(lookupDefs));
  writeFileSync(resolve(root, 'docs/npl-lookup-tables.sql'), nplLookupSql(lookupDefs));

  for (const d of defs) console.log(`${d.table}: ${d.entity}, ${d.columns.length} columns, key ${d.key.join(' + ')}`);
}

main();
