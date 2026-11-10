// Rewrites Excel formulas that HyperFormula cannot evaluate into equivalent forms:
// - defined names are inlined as their ranges,
// - OFFSET(cell, r, c)               -> INDEX(cell:<end>, (r)+1, (c)+1)
// - SUM(OFFSET(cell,0,1,1,n))        -> masked SUMPRODUCT over a row window
// - SUBTOTAL(109,OFFSET(rng,ROW..))  -> rng
// - SUBTOTAL ranges skip rows that an Excel filter hides,
// - DATEDIF units upper-cased, empty criteria cells treated as 0, "" escapes expanded.

import { callArgs, colName, colNum, mapCalls } from './formula-text.ts';

export type Cell = string | number | boolean | null;
export type SheetData = Cell[][];

export interface DefinedName {
  name: string;
  /** Excel reference text without the leading '=' (e.g. Model!$S$11:$S$61). */
  ref: string;
}

const unquote = (s: string) => s.replace(/^'|'$/g, '');

function inlineNames(f: string, names: Record<string, string>): string {
  let out = '', i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"' || ch === "'") {
      const j = f.indexOf(ch, i + 1);
      const end = j < 0 ? f.length : j + 1;
      out += f.slice(i, end);
      i = end;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(f.slice(i, i + 80));
    if (m && !/[A-Za-z0-9_.$!:]/.test(f[i - 1] || '')) {
      const tok = m[0], next = f[i + tok.length] || '';
      const expr = names[tok.toLowerCase()];
      if (next === '!' && tok.includes('.')) out += `'${tok}'`; // sheet names like p.Region
      else out += expr && next !== '(' && next !== '!' && next !== ':' ? expr : tok;
      i += tok.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// HyperFormula's tokenizer does not understand doubled quotes inside string literals.
function fixQuotes(f: string): string {
  if (!f.includes('""')) return f;
  let out = '', i = 0;
  while (i < f.length) {
    if (f[i] !== '"') { out += f[i++]; continue; }
    let j = i + 1, text = '';
    while (j < f.length) {
      if (f[j] === '"' && f[j + 1] === '"') { text += '"'; j += 2; continue; }
      if (f[j] === '"') break;
      text += f[j++];
    }
    out += text.includes('"')
      ? '(' + text.split('"').map((s) => `"${s}"`).join('&CHAR(34)&') + ')'
      : `"${text}"`;
    i = j + 1;
  }
  return out;
}

// Excel treats a criteria argument that points at an empty cell as 0; HyperFormula rejects it.
const CRITERIA_POS: Record<string, number[] | 'odd' | 'even'> = {
  COUNTIF: [1], SUMIF: [1], AVERAGEIF: [1], COUNTIFS: 'odd', SUMIFS: 'even', AVERAGEIFS: 'even',
};
const SINGLE_CELL = /^((?:'[^']+'|[A-Za-z0-9_.]+)!)?\$?[A-Z]{1,3}\$?\d+$/;
function fixCriteria(f: string): string {
  for (const [fn, pos] of Object.entries(CRITERIA_POS)) {
    if (!f.includes(fn + '(')) continue;
    f = mapCalls(f, fn, (args) => {
      let changed = false;
      const out = args.map((a, i) => {
        const isCrit = pos === 'odd' ? i % 2 === 1 : pos === 'even' ? i > 0 && i % 2 === 0 : pos.includes(i);
        if (!isCrit || !SINGLE_CELL.test(a.trim())) return a;
        changed = true;
        return `IF(ISBLANK(${a.trim()}),0,${a.trim()})`;
      });
      return changed ? `${fn}(${out.join(',')})` : null;
    });
  }
  return f;
}

const fixDatedif = (f: string) =>
  mapCalls(f, 'DATEDIF', (a) =>
    a.length === 3 && /^\s*"[a-z]+"\s*$/i.test(a[2]) ? `DATEDIF(${a[0]},${a[1]},${a[2].toUpperCase()})` : null);

function makeHiddenSplitter(hidden: Record<string, number[]>) {
  const RANGE = /^((?:'[^']+'|[A-Za-z0-9_.]+)!)?(\$?[A-Z]+)(\$?)(\d+)(?::(\$?[A-Z]+)(\$?)(\d+))?$/;
  return (sheet: string, f: string) =>
    mapCalls(f, 'SUBTOTAL', (args) => {
      const parts = [args[0]];
      for (const a of args.slice(1)) {
        const m = RANGE.exec(a.trim());
        const target = m && (m[1] ? unquote(m[1].slice(0, -1)) : sheet);
        const rows = target ? hidden[target] : undefined;
        if (!m || !rows || !rows.length) { parts.push(a); continue; }
        const [, pre = '', c1, d1, r1, c2 = c1, d2 = d1, r2 = r1] = m;
        let start = +r1;
        for (let r = +r1; r <= +r2 + 1; r++) {
          if (r > +r2 || rows.includes(r)) {
            if (r > start) parts.push(`${pre}${c1}${d1}${start}:${c2}${d2}${r - 1}`);
            start = r + 1;
          }
        }
      }
      return parts.length === 1 ? '0' : `SUBTOTAL(${parts.join(',')})`;
    });
}

const CELL = /^(?:((?:'[^']+')|[A-Za-z0-9_.]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)$/;
const MATCH_RANGE = /MATCH\([^,]+,\s*(?:(?:'[^']+'|[A-Za-z0-9_.]+)!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/;
const WINDOW = 240;
const POSITIONS = `{${[...Array(WINDOW).keys()].join(',')}}`;

function makeOffsetRewriter(dims: Record<string, { rows: number; cols: number }>) {
  return (sheet: string, f: string): string => {
    if (!f.includes('OFFSET(')) return f;
    f = f.replace(/SUBTOTAL\(109,OFFSET\(([A-Z]+\d+:[A-Z]+\d+),ROW\(\1\)-MIN\(ROW\(\1\)\),,1,1\)\)/g, '$1');
    // HyperFormula's COLUMN(range) is scalar, so the position mask is an inline array {0,1,...}.
    f = f.replace(/SUM\(OFFSET\(([A-Z]+)(\d+),0,1,1,([^()]+?)\)\)/g, (_m, col: string, row: string, n: string) => {
      const a = colName(colNum(col) + 1), b = colName(colNum(col) + WINDOW);
      const w = `${a}${row}:${b}${row}`;
      return `SUMPRODUCT(IF(ISNUMBER(${w}),${w},0)*(${POSITIONS}<(${n})))`;
    });

    let out = '', i = 0, m: RegExpExecArray | null;
    const re = /(?<![A-Z0-9_.])OFFSET\(/g;
    while ((m = re.exec(f))) {
      const r = callArgs(f, m.index + 7);
      if (!r || r.args.length !== 3) continue;
      const cm = CELL.exec(r.args[0].trim());
      if (!cm) throw new Error(`Unhandled OFFSET base in ${sheet}: ${f.slice(m.index, m.index + 120)}`);
      const [, sh, , col, , row] = cm;
      const d = dims[sh ? unquote(sh) : sheet] ?? { rows: +row + 50, cols: colNum(col) + 50 };
      // Size the INDEX range from the MATCH lookup range when there is one, so the range does
      // not swallow the formula's own cells (which would be a false cycle).
      const span = (arg: string, vertical: boolean) => {
        const mm = MATCH_RANGE.exec(arg);
        if (!mm) return null;
        return vertical ? +mm[4] - +mm[2] + 1 : colNum(mm[3]) - colNum(mm[1]) + 1;
      };
      const rowSpan = /^\s*0\s*$/.test(r.args[1]) ? 0 : span(r.args[1], true);
      const colSpan = /^\s*0\s*$/.test(r.args[2]) ? 0 : span(r.args[2], false);
      const endRow = rowSpan != null ? +row + rowSpan : Math.max(+row, d.rows);
      const endCol = colSpan != null ? colNum(col) + colSpan : Math.max(colNum(col), d.cols);
      out += f.slice(i, m.index) + `INDEX(${r.args[0].trim()}:$${colName(endCol)}$${endRow},(${r.args[1]})+1,(${r.args[2]})+1)`;
      i = r.end + 1;
      re.lastIndex = i;
    }
    out += f.slice(i);
    if (/(?<![A-Z0-9_.])OFFSET\(/.test(out)) throw new Error(`OFFSET left in ${sheet}: ${out.slice(0, 200)}`);
    return out;
  };
}

/** Formulas whose rewrite depends on which rows are hidden (rewritten when the loans are known). */
export const dependsOnHiddenRows = (formula: string) => formula.includes('SUBTOTAL(');

/**
 * Rewrite formulas in place. `hiddenRows` are 1-based row numbers per sheet; `only` limits
 * the rewrite to matching formulas.
 */
export function rewriteWorkbook(
  sheets: Record<string, SheetData>,
  names: DefinedName[],
  hiddenRows: Record<string, number[]> = {},
  only: (formula: string) => boolean = () => true,
): void {
  const nameMap: Record<string, string> = {};
  for (const n of names) nameMap[n.name.toLowerCase()] = n.ref;
  const dims: Record<string, { rows: number; cols: number }> = {};
  for (const [s, rows] of Object.entries(sheets))
    dims[s] = { rows: rows.length, cols: rows.reduce((mx, r) => Math.max(mx, r.length), 0) };
  const splitHidden = makeHiddenSplitter(hiddenRows);
  const rewriteOffset = makeOffsetRewriter(dims);

  for (const [sheet, rows] of Object.entries(sheets)) {
    for (const row of rows) {
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (typeof v !== 'string' || !v.startsWith('=') || !only(v)) continue;
        let f = '=' + inlineNames(fixQuotes(v.slice(1)), nameMap);
        if (f.includes('DATEDIF(')) f = fixDatedif(f);
        if (f.includes('IF(') || f.includes('IFS(')) f = fixCriteria(f);
        if (f.includes('SUBTOTAL(')) f = splitHidden(sheet, f);
        if (f.includes('OFFSET(')) f = rewriteOffset(sheet, f);
        row[c] = f;
      }
    }
  }
}
