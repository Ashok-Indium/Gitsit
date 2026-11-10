// Writes the lookup tables (EXIT, ZIP3, state_code …, read from Fabric) into the model's lookup
// sheets before it calculates, so a value changed or a row added in SQL changes the results.
// A list that grows or shrinks moves the end of every formula range that covered it.

import { LOOKUP_TABLES, TABLE_TYPE, type LookupSpec } from '@/store/generated/lookup-fields';

import { colNum } from './formula-text.ts';
import type { Cell } from './rewrite.ts';

export type LookupRow = Record<string, unknown>;
/** Rows by table name; a table that is missing or empty keeps the workbook's values. */
export type Lookups = Record<string, LookupRow[]>;

const isFormula = (v: Cell | undefined) => typeof v === 'string' && v.startsWith('=');

/**
 * A table value as a model cell. 'auto' columns hold text and the odd number (property type 24):
 * a value that reads exactly as a number goes back as one, so lookups match as in the workbook.
 */
function toCell(v: unknown, type: 'text' | 'number' | 'auto'): Cell {
  if (v == null || v === '') return null;
  if (type === 'number') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(v);
  if (type === 'auto' && s.trim() !== '' && String(Number(s)) === s.trim()) return Number(s);
  return `'${s}`;
}

function put(sheet: Cell[][], row: number, col: string, value: Cell) {
  while (sheet.length < row) sheet.push([]);
  const r = sheet[row - 1];
  const c = colNum(col) - 1;
  if (isFormula(r[c])) return; // the workbook's own calculations stay
  r[c] = value;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Moves the end row of every range on `sheet` that spans only `fromCol`..`toCol` and ends at
 * `oldEnd` to `newEnd`: references from other sheets (`ZIP3!$B$11:$B$943`) and the sheet's own
 * (`AVERAGE(C11:C943)` on ZIP3).
 */
function moveRangeEnds(sheets: Record<string, Cell[][]>, sheet: string, fromCol: number, toCol: number, oldEnd: number, newEnd: number) {
  const name = `(?:'${escape(sheet)}'|${/^[A-Za-z_][\w.]*$/.test(sheet) ? escape(sheet) : `'${escape(sheet)}'`})`;
  const range = '(\\$?)([A-Z]{1,3})(\\$?)(\\d+):(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?![\\d(])';
  const other = new RegExp(`(${name}!)${range}`, 'g');
  const own = new RegExp(`(^|[^!\\w$'])${range}`, 'g');
  const fix = (lead: string, d1: string, c1: string, r1d: string, r1: string, d2: string, c2: string, r2d: string, r2: string) =>
    colNum(c1) >= fromCol && colNum(c2) <= toCol && Number(r2) === oldEnd
      ? `${lead}${d1}${c1}${r1d}${r1}:${d2}${c2}${r2d}${newEnd}` : null;
  for (const [n, cells] of Object.entries(sheets)) {
    for (const row of cells) {
      for (let i = 0; i < row.length; i++) {
        const f = row[i];
        if (!isFormula(f)) continue;
        let g = (f as string).replace(other, (m, ...a) => fix(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]) ?? m);
        if (n === sheet) g = g.replace(own, (m, ...a) => fix(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]) ?? m);
        row[i] = g;
      }
    }
  }
}

function applyList(sheets: Record<string, Cell[][]>, spec: LookupSpec, rows: LookupRow[]) {
  const sheet = sheets[spec.sheet];
  const start = spec.startRow!, oldEnd = spec.endRow!;
  const keyName = spec.key[0];
  let data = rows.filter((r) => r[keyName] != null && r[keyName] !== '');
  if (spec.sortBy) {
    const by = spec.sortBy;
    data = [...data].sort((a, b) => Number(a[by]) - Number(b[by]));
  }
  const cols = spec.columns.filter((c) => c.col);
  const newEnd = start + data.length - 1;
  data.forEach((r, i) => cols.forEach((c) => put(sheet, start + i, c.col!, toCell(r[c.name], c.type))));
  for (let row = newEnd + 1; row <= oldEnd; row++) cols.forEach((c) => put(sheet, row, c.col!, null));
  if (newEnd !== oldEnd) {
    const nums = cols.map((c) => colNum(c.col!));
    moveRangeEnds(sheets, spec.sheet, Math.min(...nums), Math.max(...nums), oldEnd, newEnd);
  }
}

function applyLists(sheets: Record<string, Cell[][]>, spec: LookupSpec, rows: LookupRow[]) {
  const sheet = sheets[spec.sheet];
  const valueName = spec.columns[1].name;
  for (const list of spec.lists!) {
    const values = rows.filter((r) => r.List === list.name && r[valueName] != null).map((r) => String(r[valueName])).sort();
    values.forEach((v, i) => put(sheet, spec.startRow! + i, list.col, `'${v}`));
    for (let row = spec.startRow! + values.length; row <= spec.endRow!; row++) put(sheet, row, list.col, null);
  }
}

function applyGrid(sheets: Record<string, Cell[][]>, spec: LookupSpec, rows: LookupRow[]) {
  const sheet = sheets[spec.sheet];
  const segments = new Map(spec.segments!.map((s) => [s.name.trim().toLowerCase(), s.col]));
  const blocks = new Map(spec.blocks!.map((b) => [b.name.trim().toLowerCase(), b.row]));
  const bands = new Map(spec.bands!.map((b, i) => [b.trim().toLowerCase(), i]));
  const at = (c0: number, offset: number) => {
    let n = c0 + offset, s = '';
    while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  for (const r of rows) {
    const col = segments.get(String(r.Segment ?? '').trim().toLowerCase());
    const block = blocks.get(String(r.Outcome ?? '').trim().toLowerCase());
    const band = bands.get(String(r.LTV_Band ?? '').trim().toLowerCase());
    if (!col || block === undefined || band === undefined) continue; // not a cell of this grid
    const row = block + 1 + band, c0 = colNum(col);
    put(sheet, row, at(c0, 1), toCell(r.LTV_From, 'number'));
    spec.buckets!.forEach((b, j) => put(sheet, row, at(c0, 2 + j), toCell(r[b], 'number')));
  }
}

/** Writes this model's (Table_Type BPL) lookup rows into the workbook's lookup sheets. */
export function applyLookups(sheets: Record<string, Cell[][]>, lookups: Lookups | undefined): void {
  if (!lookups) return;
  for (const spec of LOOKUP_TABLES) {
    const rows = (lookups[spec.table] ?? []).filter((r) => (r.Table_Type ?? TABLE_TYPE) === TABLE_TYPE);
    if (!rows.length || !sheets[spec.sheet]) continue;
    if (spec.kind === 'list') applyList(sheets, spec, rows);
    else if (spec.kind === 'lists') applyLists(sheets, spec, rows);
    else applyGrid(sheets, spec, rows);
  }
}
