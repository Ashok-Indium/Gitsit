// Reads and writes the app's tables in gitsit-test through the Rayfin data service: Input_table
// (every input file's loans, by File_Name), Loan_Model and Loan_Model_Monthly (every loan's Model
// sheet values), LoanChanges (one row per edited value) and the lookup tables (EXIT, ZIP3 …).
// Every row carries its Table_Type (BPL); the app works on one input file (File_Name) at a time.

import type { Lookups } from '@/engine/lookups';
import { FIELD_BY_COL } from '@/engine/model-schema';
import { isError, type CellChange, type CellOut, type Snapshot } from '@/engine/protocol';
import type { getRayfinClient } from '@/lib/rayfin-client';
import type { Loan } from '@/report/measures';

import type { InputRow } from '@/engine/load-input';

import inputRows from './generated/input-rows.json';
import { DATA_TABLES } from './generated/data-tables';
import { LOOKUP_TABLES, TABLE_TYPE } from './generated/lookup-fields';
import { FILE_NAME, INPUT_COLUMNS, MODEL_COLUMNS, MONTH_COLUMNS, MONTHLY_SERIES } from './generated/store-fields';

type Client = Awaited<ReturnType<typeof getRayfinClient>>;
type Value = string | number | null;

export interface StoreUser {
  name: string;
  email: string;
}

/** The File_Name of a loan's input row (where its data came from), by loan ID. */
export type FileNameOf = (loanId: string) => string;
export const defaultFileName: FileNameOf = () => FILE_NAME;

/** "ashok.g@indium.tech" -> "Ashok G" (the sign-in session carries only the email). */
export function displayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || email;
}

/**
 * A model value as it is written to the change log: numbers without floating-point noise
 * (1.3% is 0.013, not 0.013000000000000001), text, or the error code.
 */
export function rawText(v: CellOut | undefined): string | null {
  if (v == null || v === '') return null;
  if (isError(v)) return v.error;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(Number(v.toPrecision(15)));
  return String(v);
}

const loanId = (l: Loan) => String(l.values.A ?? '');
/** Loan_Model column of each editable Model column (the change log's Column_Name). */
const NAME_BY_EDITABLE_COL = new Map(MODEL_COLUMNS.filter((c) => FIELD_BY_COL[c.col]?.editable).map((c) => [c.col as string, c.name as string]));
const EDITABLE_COL_BY_NAME = new Map([...NAME_BY_EDITABLE_COL].map(([col, name]) => [name, col]));

/** How a reset back to the model's own value is marked in New_Value. */
const RESET_MARK = ' (reset)';

// ---------- change log ----------

/** One LoanChanges row. */
export interface ChangeEntry {
  Table_Type: string;
  File_Name: string;
  Loan_Id: string;
  Column_Name: string;
  Old_Value: string | null;
  New_Value: string | null;
  User_mail: string;
  Changed_On: Date | string;
}

/**
 * Log rows for overrides about to be applied, with each cell's value before the change. A
 * change that leaves the value as it was is not logged.
 */
export function editEntries(before: Snapshot, changes: CellChange[], user: StoreUser, fileNameOf: FileNameOf = defaultFileName, at = new Date()): ChangeEntry[] {
  const byRow = new Map(before.loans.map((l) => [l.row, l]));
  return changes.flatMap((c) => {
    const l = byRow.get(c.row);
    const column = NAME_BY_EDITABLE_COL.get(c.col);
    const oldValue = l ? rawText(l.values[c.col]) : null;
    const newValue = rawText(c.value);
    if (!l || !column || oldValue === newValue) return [];
    return [{
      Table_Type: TABLE_TYPE, File_Name: fileNameOf(loanId(l)), Loan_Id: loanId(l), Column_Name: column,
      Old_Value: oldValue, New_Value: newValue, User_mail: user.email, Changed_On: at,
    }];
  });
}

/** Log rows for overrides about to be reset: the new value is the model's own calculation, marked "(reset)". */
export function resetEntries(before: Snapshot, cells: { row: number; col: string }[], user: StoreUser, fileNameOf: FileNameOf = defaultFileName, at = new Date()): ChangeEntry[] {
  const byRow = new Map(before.loans.map((l) => [l.row, l]));
  const overrides = new Map(before.overrides.map((o) => [`${o.col}${o.row}`, o]));
  return cells.flatMap((c) => {
    const l = byRow.get(c.row);
    const o = overrides.get(`${c.col}${c.row}`);
    const column = NAME_BY_EDITABLE_COL.get(c.col);
    if (!l || !o || !column) return [];
    return [{
      Table_Type: TABLE_TYPE, File_Name: fileNameOf(loanId(l)), Loan_Id: loanId(l), Column_Name: column,
      Old_Value: rawText(o.value), New_Value: `${rawText(o.modelValue) ?? ''}${RESET_MARK}`, User_mail: user.email, Changed_On: at,
    }];
  });
}

/** The overrides to replay: the latest logged change per loan and column, unless it was a reset. */
export function latestEdits(log: Pick<ChangeEntry, 'Loan_Id' | 'Column_Name' | 'New_Value' | 'Changed_On'>[], loans: Loan[]): CellChange[] {
  const rowById = new Map(loans.map((l) => [loanId(l), l.row]));
  const latest = new Map<string, (typeof log)[number]>();
  const time = (d: Date | string) => new Date(d).getTime();
  for (const e of [...log].sort((a, b) => time(a.Changed_On) - time(b.Changed_On))) latest.set(`${e.Loan_Id}|${e.Column_Name}`, e);
  return [...latest.values()].flatMap((e) => {
    const col = EDITABLE_COL_BY_NAME.get(e.Column_Name);
    const f = col ? FIELD_BY_COL[col] : undefined;
    const row = rowById.get(e.Loan_Id);
    if (!col || !f?.editable || row === undefined || e.New_Value == null || e.New_Value.endsWith(RESET_MARK)) return [];
    const value = f.kind === 'text' ? e.New_Value : Number(e.New_Value);
    if (typeof value === 'number' && !Number.isFinite(value)) return [];
    return [{ row, col, value }];
  });
}

// ---------- model rows ----------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const round10 = (n: number) => Math.round(n * 1e10) / 1e10;
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
/** Loan_Model numbers are DECIMAL(18,8): 8 decimals, below 10 billion. */
const MODEL_MAX = 1e10;
/** Loan_Model_Monthly numbers are DECIMAL(28,10). */
const MONTHLY_MAX = 1e17;

type ModelColumn = (typeof MODEL_COLUMNS)[number];

/** A loan's Loan_Model columns, in the form they are stored. */
export function modelRow(l: Loan): Record<string, Value> {
  const row: Record<string, Value> = {};
  for (const c of MODEL_COLUMNS) {
    const v: CellOut = l.values[c.col];
    if (c.type === 'text') {
      row[c.name] = v == null || v === '' ? null : isError(v) ? v.error
        : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v).slice(0, 400);
    } else if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) >= MODEL_MAX) {
      row[c.name] = null;
    } else if (c.type === 'date') {
      row[c.name] = new Date(EXCEL_EPOCH + Math.round(v) * 86400000).toISOString();
    } else {
      row[c.name] = round8(v);
    }
  }
  return row;
}

/** Compare form: numbers at stored precision, dates by day, empty text as null. */
function norm(type: 'text' | 'decimal' | 'date', v: unknown, round: (n: number) => number = round8): Value {
  if (v == null || v === '') return null;
  if (type === 'decimal') { const n = Number(v); return Number.isFinite(n) ? round(n) : null; }
  if (type === 'date') return new Date(v as string).toISOString().slice(0, 10);
  return String(v);
}

/** The columns of `next` (among `cols`) that differ from what is stored. */
export function changedColumns(next: Record<string, Value>, stored: Record<string, unknown> | undefined,
  cols: readonly ModelColumn[] = MODEL_COLUMNS): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const c of cols) {
    if (!stored || norm(c.type, next[c.name]) !== norm(c.type, stored[c.name])) out[c.name] = next[c.name];
  }
  return out;
}

// ---------- Fabric reads and writes (the Rayfin data service in gitsit-test) ----------

const PAGE = 1000;

async function allPages<T>(page: (after?: string) => Promise<{ items: T[]; hasNextPage: boolean; endCursor?: string | null }>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (;;) {
    const p = await page(after);
    out.push(...p.items);
    if (!p.hasNextPage || !p.endCursor) return out;
    after = p.endCursor;
  }
}

/** Run writes a few at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

type Row = Record<string, unknown>;
type TableName = keyof typeof DATA_TABLES;
type Page = { items: Row[]; hasNextPage: boolean; endCursor?: string | null };
interface Query {
  where(filter: object): Query;
  orderBy(order: object): Query;
  first(n: number): Query;
  after(cursor: string): Query;
  executePaginated(): Promise<Page>;
}
interface Entity {
  select(fields: string[]): Query;
  create(row: Row): Promise<unknown>;
  update(key: { id: unknown }, row: Row): Promise<unknown>;
  delete(key: { id: unknown }): Promise<unknown>;
}

const tableOf = (table: TableName) => DATA_TABLES[table];
const entity = (client: Client, table: TableName) => (client.data as unknown as Record<string, Entity>)[tableOf(table).entity];
/** The given row's values for the table's columns (leaving out anything not a column of it). */
const pick = (table: TableName, row: Row, columns: readonly string[] = tableOf(table).columns) =>
  Object.fromEntries(columns.filter((c) => row[c] !== undefined && (tableOf(table).columns as readonly string[]).includes(c)).map((c) => [c, row[c]]));

/** Reads a table's rows (one input file's, when `fileName` is given) with their `id` and the given columns. */
async function readAll(client: Client, table: TableName, columns: readonly string[], fileName?: string): Promise<Row[]> {
  const select = ['id', ...columns.filter((c) => (tableOf(table).columns as readonly string[]).includes(c))];
  const rows = await allPages((after) => {
    let q = entity(client, table).select(select);
    if (fileName !== undefined) q = q.where({ File_Name: { eq: fileName } });
    q = q.orderBy({ id: 'asc' }).first(PAGE);
    return (after ? q.after(after) : q).executePaginated();
  });
  return rows.map((r) => Object.fromEntries(['id', ...columns].map((c) => [c, r[c] ?? null])));
}

/** Creates a row with an id of the app's choosing, so it can be updated later without a re-read. */
async function insertRow(client: Client, table: TableName, row: Row): Promise<string> {
  const id = crypto.randomUUID();
  await entity(client, table).create({ ...pick(table, row), id });
  return id;
}

const updateRow = (client: Client, table: TableName, id: unknown, values: Row) =>
  entity(client, table).update({ id }, pick(table, values));

const deleteRow = (client: Client, table: TableName, id: unknown) => entity(client, table).delete({ id });

const CHANGE_NAMES = ['Table_Type', 'File_Name', 'Loan_Id', 'Column_Name', 'Old_Value', 'New_Value', 'User_mail', 'Changed_On'];

/** The change log of one input file. */
export async function loadChangeLog(client: Client, fileName: string): Promise<ChangeEntry[]> {
  return await readAll(client, 'LoanChanges', CHANGE_NAMES, fileName) as unknown as ChangeEntry[];
}

export async function writeChangeLog(client: Client, entries: ChangeEntry[]): Promise<void> {
  await inBatches(entries, 10, (e) => insertRow(client, 'LoanChanges', { ...e }));
}

const INPUT_NAMES = [...INPUT_COLUMNS.map((c) => c.name), 'File_Name'];

/** Every Input_table row (all input files), with its File_Name. */
export async function loadInputRows(client: Client): Promise<InputRow[]> {
  const rows = await readAll(client, 'Input_table', INPUT_NAMES);
  for (const r of rows) delete r.id;
  return rows as InputRow[];
}

/** Fills an empty Input_table with the bundled input file, so the app has loans to show. */
export async function seedInput(client: Client): Promise<void> {
  await inBatches(inputRows as Row[], 5, (r) => insertRow(client, 'Input_table', { Table_Type: TABLE_TYPE, ...r, File_Name: FILE_NAME }));
}

/** The input files in Input_table, by name, with how many loans each holds. */
export function inputFiles(rows: InputRow[]): { name: string; loans: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const name = String(r.File_Name ?? FILE_NAME);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, loans]) => ({ name, loans })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- lookup tables ----------

const lookupNames = (s: (typeof LOOKUP_TABLES)[number]) => ['Table_Type', ...s.columns.map((c) => c.name)];

/** Every lookup table's rows (all categories; the engine keeps this model's), by table name. */
export async function loadLookups(client: Client): Promise<Lookups> {
  const tables = await Promise.all(LOOKUP_TABLES.map((s) => readAll(client, s.table as TableName, lookupNames(s))));
  return Object.fromEntries(LOOKUP_TABLES.map((s, i) => [s.table, tables[i]]));
}

/** A value that changes whenever any lookup row of this model's category changes, ignoring row order. */
export function lookupsFingerprint(lookups: Lookups): string {
  return JSON.stringify(LOOKUP_TABLES.map((s) => (lookups[s.table] ?? [])
    .filter((r) => r.Table_Type === TABLE_TYPE)
    .map((r) => JSON.stringify(lookupNames(s).map((n) => r[n] ?? null)))
    .sort()));
}

/** A value that changes whenever any loan's input changes, ignoring row order. */
export function inputFingerprint(rows: InputRow[]): string {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  return JSON.stringify(rows
    .map((r) => [r.File_Name ?? null, ...INPUT_COLUMNS.map((c) => norm(r[c.name]))])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

const MODEL_NAMES = [...MODEL_COLUMNS.map((c) => c.name), 'File_Name'];
const MONTHLY_NAMES = ['loan_id', 'series', 'periods', ...MONTH_COLUMNS, 'File_Name'];
const monthlyKey = (loan: string, series: string) => `${loan}|${series}`;

/** What Loan_Model (by loan ID) and Loan_Model_Monthly (by loan ID and series) hold for one input file. */
export interface StoredModel {
  model: Map<string, Row>;
  monthly: Map<string, Row>;
}

export async function loadModelRows(client: Client, fileName: string): Promise<StoredModel> {
  const [model, monthly] = await Promise.all([
    readAll(client, 'Loan_Model', MODEL_NAMES, fileName),
    readAll(client, 'Loan_Model_Monthly', MONTHLY_NAMES, fileName),
  ]);
  return {
    model: new Map(model.map((r) => [String(r.loan_id), r])),
    monthly: new Map(monthly.map((r) => [monthlyKey(String(r.loan_id), String(r.series)), r])),
  };
}

/** A loan's Loan_Model_Monthly rows: one per series, the months in m01.. (numbers only). */
export function monthlyRows(l: Loan, fileNameOf: FileNameOf = defaultFileName): Record<string, Value>[] {
  const id = loanId(l);
  return MONTHLY_SERIES.map((s) => {
    const row: Record<string, Value> = { Table_Type: TABLE_TYPE, loan_id: id, series: s.series, periods: s.periods, File_Name: fileNameOf(id) };
    MONTH_COLUMNS.forEach((m, i) => {
      const v = s.cols[i] ? l.values[s.cols[i]] : null;
      row[m] = typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MONTHLY_MAX ? round10(v) : null;
    });
    return row;
  });
}

/** The Loan_Model_Monthly columns of `next` that differ from what is stored. */
function changedMonths(next: Record<string, Value>, stored: Row | undefined): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const k of ['periods', 'File_Name']) if (!stored || stored[k] !== next[k]) out[k] = next[k];
  for (const m of MONTH_COLUMNS) if (!stored || norm('decimal', next[m], round10) !== norm('decimal', stored[m], round10)) out[m] = next[m];
  return out;
}

/**
 * Writes every loan of one input file whose calculated values differ from Loan_Model /
 * Loan_Model_Monthly, creating rows for new loans and removing loans that are no longer in the
 * file. `stored` is that file's rows, updated in place. Returns the number of loans written or removed.
 */
export async function syncModelRows(client: Client, snapshot: Snapshot, stored: StoredModel, user: StoreUser,
  fileNameOf: FileNameOf = defaultFileName): Promise<number> {
  const current = new Set(snapshot.loans.map(loanId));
  const touched = new Set<string>();

  const goneMonthly = [...stored.monthly].filter(([, r]) => !current.has(String(r.loan_id)));
  await inBatches(goneMonthly, 5, async ([key, r]) => {
    await deleteRow(client, 'Loan_Model_Monthly', r.id);
    stored.monthly.delete(key);
  });
  const monthWrites = snapshot.loans.flatMap((l) => monthlyRows(l, fileNameOf)).flatMap((next) => {
    const key = monthlyKey(String(next.loan_id), String(next.series));
    const prev = stored.monthly.get(key);
    const diff = changedMonths(next, prev);
    return Object.keys(diff).length ? [{ key, prev, next, diff }] : [];
  });
  await inBatches(monthWrites, 5, async (w) => {
    touched.add(String(w.next.loan_id));
    if (w.prev) {
      await updateRow(client, 'Loan_Model_Monthly', w.prev.id, w.diff);
      Object.assign(w.prev, w.diff);
    } else {
      const id = await insertRow(client, 'Loan_Model_Monthly', w.next);
      stored.monthly.set(w.key, { ...w.next, id });
    }
  });

  const gone = [...stored.model].filter(([loan]) => !current.has(loan));
  await inBatches(gone, 5, async ([loan, r]) => {
    await deleteRow(client, 'Loan_Model', r.id);
    stored.model.delete(loan);
    touched.add(loan);
  });
  const stamp = { changed_by: user.name, user_email: user.email, modifiedon: new Date() };
  const writes = snapshot.loans.flatMap((l) => {
    const next: Record<string, Value> = { Table_Type: TABLE_TYPE, ...modelRow(l), File_Name: fileNameOf(loanId(l)) };
    const loan = String(next.loan_id);
    const prev = stored.model.get(loan);
    const diff = changedColumns(next, prev);
    if (!prev || prev.File_Name !== next.File_Name) diff.File_Name = next.File_Name;
    // A loan whose months alone moved still records who changed it and when.
    return Object.keys(diff).length || (prev && touched.has(loan)) ? [{ loan, prev, next, diff }] : [];
  });
  await inBatches(writes, 5, async (w) => {
    touched.add(w.loan);
    if (w.prev) {
      await updateRow(client, 'Loan_Model', w.prev.id, { ...w.diff, ...stamp });
      Object.assign(w.prev, w.diff);
    } else {
      const id = await insertRow(client, 'Loan_Model', { ...w.next, ...stamp });
      stored.model.set(w.loan, { ...w.next, id });
    }
  });
  return touched.size;
}
