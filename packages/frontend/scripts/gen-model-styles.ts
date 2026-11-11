// Reads the colours of the Home page's Model columns from the model workbook, so the Home tables
// look like the Model sheet: each column's header (row 10), Average (row 8), Total (row 9) and
// loan-cell styles, and the sheet's conditional formats on the loan rows.
//
//   node scripts/gen-model-styles.ts [model.xlsx]
//
// Writes src/engine/generated/model-styles.json (see src/report/sheet-style.ts for the shape).
// Theme colours are resolved to hex with their tint. A loan column's style is the one most of
// its loan rows have (a few rows in the template carry one-off highlights). Conditional-format
// formulas are kept as small expression trees with their references resolved per column; a rule
// the app cannot evaluate (a reference to another loan's row) is left out and reported.

import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPORT_FIELDS, REPORT_TABLES } from '../src/engine/report-fields.ts';

const here = dirname(fileURLToPath(import.meta.url));
const modelPath = resolve(process.argv[2] ?? resolve(here, '../../../data/Pacific Private Money - model.xlsx'));

const AVERAGE_ROW = 8;
const TOTAL_ROW = 9;
const HEADER_ROW = 10;
const FIRST_LOAN_ROW = 11;
const LAST_LOAN_ROW = 59;
const HOME_TABLES = ['modelOutput', 'dcfPerf', 'dcfPayoff', 'dcfReo', 'dcfNpl'] as const;

interface Style { fill?: string; color?: string; bold?: boolean; italic?: boolean }
type Ref = { col: string; row: 'loan' | 'average' | 'total' } | { cell: string };
type Expr = { n: number } | { s: string } | { ref: Ref } | { fn: string; args: Expr[] } | { op: string; a: Expr; b: Expr };
type Rule = { if: Expr; style: Style } | { duplicate: true; style: Style } | { scale: { at: number; color: string }[] };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(modelPath);
const ws = wb.getWorksheet('Model');
if (!ws) throw new Error('The model workbook has no Model sheet');

// ---------- colours ----------

const themeXml = String(Object.values((wb as unknown as { _themes?: Record<string, string> })._themes ?? {})[0] ?? '');
const scheme = (name: string) => {
  const m = new RegExp(`<a:${name}>.*?(?:srgbClr val|lastClr)="([0-9A-F]{6})"`, 's').exec(themeXml);
  if (!m) throw new Error(`The workbook theme has no ${name} colour`);
  return m[1];
};
// Excel's theme indexes: 0 and 1 are the light and dark text/background colours, swapped from the scheme's order.
const THEME = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(scheme);

function tinted(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function color(c: { argb?: string; theme?: number; tint?: number } | undefined): string | undefined {
  if (!c) return undefined;
  if (c.argb) return `#${c.argb.slice(-6).toUpperCase()}`;
  if (c.theme !== undefined && THEME[c.theme]) return `#${c.tint ? tinted(THEME[c.theme], c.tint) : THEME[c.theme]}`;
  return undefined;
}

type ExcelFont = { bold?: boolean; italic?: boolean; color?: { argb?: string; theme?: number; tint?: number } };
type ExcelFill = { type?: string; pattern?: string; fgColor?: { argb?: string; theme?: number; tint?: number }; bgColor?: { argb?: string; theme?: number; tint?: number } };

function styleOf(fill: ExcelFill | undefined, font: ExcelFont | null | undefined, conditional = false): Style {
  const out: Style = {};
  // A cell's solid fill is its pattern's foreground; a conditional format's is its background.
  const f = fill && fill.pattern !== 'none' && (conditional ? fill.bgColor : fill.type === 'pattern' ? fill.fgColor : undefined);
  const fc = color(f || undefined);
  if (fc) out.fill = fc;
  const tc = color(font?.color);
  if (tc) out.color = tc;
  if (font?.bold) out.bold = true;
  if (font?.italic) out.italic = true;
  return out;
}

const cellStyle = (address: string) => {
  const s = ws.getCell(address).style;
  return styleOf(s.fill as ExcelFill, s.font as ExcelFont);
};
const empty = (s: Style) => !Object.keys(s).length;

// ---------- formulas ----------

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Parses a conditional-format formula written for the cell at (originCol, originRow), as seen from `col` on a loan row. */
function parse(formula: string, originCol: string, originRow: number, col: string): Expr {
  const tokens = formula.replace(/_xlfn\./g, '').match(/"[^"]*"|\$?[A-Z]{1,3}\$?\d+|\d+(?:\.\d+)?|[A-Z]+(?=\()|<>|>=|<=|[-+*/=<>(),]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => { const v = tokens[i++]; if (t && v !== t) throw new Error(`Expected ${t} in ${formula}`); return v; };
  const ref = (t: string): Expr => {
    const [, absCol, c, absRow, r] = /^(\$?)([A-Z]{1,3})(\$?)(\d+)$/.exec(t)!;
    const target = absCol ? c : colName(colNum(c) + colNum(col) - colNum(originCol));
    const row = absRow ? +r : +r + FIRST_LOAN_ROW - originRow;
    if (row === FIRST_LOAN_ROW && !absRow) return { ref: { col: target, row: 'loan' } };
    if (row === AVERAGE_ROW && absRow) return { ref: { col: target, row: 'average' } };
    if (row === TOTAL_ROW && absRow) return { ref: { col: target, row: 'total' } };
    if (absRow && row < HEADER_ROW) return { ref: { cell: `${target}${row}` } };
    throw new Error(`another loan's row (${t})`);
  };
  const primary = (): Expr => {
    const t = take();
    if (t === '(') { const e = compare(); take(')'); return e; }
    if (t === '-') return { op: '-', a: { n: 0 }, b: primary() };
    if (t.startsWith('"')) return { s: t.slice(1, -1) };
    if (/^\d/.test(t)) return { n: +t };
    if (peek() === '(') {
      take('(');
      const args: Expr[] = [];
      while (peek() !== ')') { args.push(compare()); if (peek() === ',') take(','); }
      take(')');
      return { fn: t, args };
    }
    return ref(t);
  };
  const binary = (next: () => Expr, ops: string[]) => () => {
    let a = next();
    while (ops.includes(peek())) { const op = take(); a = { op, a, b: next() }; }
    return a;
  };
  const product = binary(primary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const compare = binary(sum, ['=', '<>', '<', '>', '<=', '>=']);
  const e = compare();
  if (i !== tokens.length) throw new Error(`Unparsed rest of ${formula}`);
  return e;
}

const CELL_IS: Record<string, string> = {
  equal: '=', notEqual: '<>', greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=',
};

// ---------- columns ----------

const byLabel = new Map(REPORT_FIELDS.map((f) => [f.label, f.col]));
const cols = [...new Set(HOME_TABLES.flatMap((t) => REPORT_TABLES[t] as readonly string[]).map((l) => byLabel.get(l)).filter((c): c is string => !!c))];

interface ColumnStyle { header?: Style; average?: Style; total?: Style; loan?: Style; rules?: Rule[] }
const columns: Record<string, ColumnStyle> = {};
for (const col of cols) {
  const counts = new Map<string, number>();
  for (let r = FIRST_LOAN_ROW; r <= LAST_LOAN_ROW; r++) {
    const k = JSON.stringify(cellStyle(`${col}${r}`));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const loan = JSON.parse([...counts].sort((a, b) => b[1] - a[1])[0][0]) as Style;
  const entry: ColumnStyle = {};
  for (const [k, s] of [['header', cellStyle(`${col}${HEADER_ROW}`)], ['average', cellStyle(`${col}${AVERAGE_ROW}`)], ['total', cellStyle(`${col}${TOTAL_ROW}`)], ['loan', loan]] as const) {
    if (!empty(s)) entry[k] = s;
  }
  columns[col] = entry;
}

// ---------- conditional formats ----------

interface ExcelRule {
  type: string; operator?: string; formulae?: (string | number)[]; priority?: number;
  style?: { fill?: ExcelFill; font?: ExcelFont };
  cfvo?: { type: string; value?: number }[]; color?: { argb?: string; theme?: number; tint?: number }[];
}
const formats = (ws as unknown as { conditionalFormattings: { ref: string; rules: ExcelRule[] }[] }).conditionalFormattings;
const ranged = formats.flatMap((cf) => cf.rules.map((rule) => ({ ref: cf.ref, rule })))
  .sort((a, b) => (a.rule.priority ?? 0) - (b.rule.priority ?? 0));
const skipped: string[] = [];
/** The style Excel gives a value typed over a formula (the ISFORMULA rule): shown on overridden cells. */
let override: Style | undefined;

for (const { ref, rule } of ranged) {
  const ranges = ref.split(' ').map((r) => {
    const [a, b = a] = r.split(':');
    return { c1: colNum(a.replace(/[^A-Z]/g, '')), c2: colNum(b.replace(/[^A-Z]/g, '')), r1: +a.replace(/\D/g, ''), r2: +b.replace(/\D/g, '') };
  });
  const origin = ranges[0];
  const style = rule.style ? styleOf(rule.style.fill, rule.style.font, true) : {};
  for (const col of cols) {
    const n = colNum(col);
    if (!ranges.some((r) => n >= r.c1 && n <= r.c2 && r.r1 <= FIRST_LOAN_ROW && r.r2 >= FIRST_LOAN_ROW)) continue;
    let made: Rule | undefined;
    try {
      const expr = (f: string | number) => parse(String(f), colName(origin.c1), origin.r1, col);
      if (rule.type === 'cellIs' && rule.operator && CELL_IS[rule.operator] && rule.formulae?.length) {
        made = { if: { op: CELL_IS[rule.operator], a: { ref: { col, row: 'loan' } }, b: expr(rule.formulae[0]) }, style };
      } else if ((rule.type === 'expression' || rule.type === 'containsText') && rule.formulae?.length) {
        if (/ISFORMULA/.test(String(rule.formulae[0]))) override ??= style;
        made = { if: expr(rule.formulae[0]), style };
      } else if (rule.type === 'duplicateValues') {
        made = { duplicate: true, style };
      } else if (rule.type === 'colorScale' && rule.cfvo?.every((v) => v.type === 'num') && rule.color) {
        made = { scale: rule.cfvo.map((v, k) => ({ at: Number(v.value), color: color(rule.color![k]) ?? '#FFFFFF' })) };
      } else {
        throw new Error(`a ${rule.type} rule`);
      }
    } catch (e) {
      skipped.push(`${col}: ${(e as Error).message}`);
    }
    if (made) (columns[col].rules ??= []).push(made);
  }
}

// The loan columns and fixed cells the rules read, which the engine adds to its snapshot.
const refs = new Set<string>(), cells = new Set<string>();
const walk = (e: Expr) => {
  if ('ref' in e) { if ('cell' in e.ref) cells.add(e.ref.cell); else refs.add(e.ref.col); }
  if ('fn' in e) e.args.forEach(walk);
  if ('op' in e) { walk(e.a); walk(e.b); }
};
for (const c of Object.values(columns)) for (const r of c.rules ?? []) if ('if' in r) walk(r.if);

writeFileSync(resolve(here, '../src/engine/generated/model-styles.json'), JSON.stringify({
  columns, override: override ?? { fill: '#FFFFCC', color: '#0000FF', bold: true, italic: true },
  cols: [...refs].sort(), cells: [...cells].sort(),
}, null, 1) + '\n');
console.log(`model-styles.json: ${cols.length} columns, ${Object.values(columns).reduce((n, c) => n + (c.rules?.length ?? 0), 0)} conditional rules`);
for (const s of skipped) console.log(`  left out ${s}`);
