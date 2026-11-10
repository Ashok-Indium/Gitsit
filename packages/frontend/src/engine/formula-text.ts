// Text-level helpers for Excel formulas: column letters, call-argument splitting and
// relative-reference translation. Shared by the model build script and the engine worker.

export const colNum = (s: string): number => {
  let c = 0;
  for (const ch of s) c = c * 26 + ch.charCodeAt(0) - 64;
  return c;
};

export const colName = (c: number): string => {
  let s = '';
  while (c) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = (c - m - 1) / 26;
  }
  return s;
};

/** A1-style address -> zero-based row/col. */
export const parseAddress = (a: string): { row: number; col: number } => {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(`Bad address ${a}`);
  return { row: +m[2] - 1, col: colNum(m[1]) - 1 };
};

/** Split the argument list of a call; `i` is the index just after the opening paren. */
export function callArgs(f: string, i: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  let depth = 0, cur = '', inStr = false, inQuote = false;
  for (; i < f.length; i++) {
    const ch = f[i];
    if (inStr) { cur += ch; if (ch === '"') inStr = false; continue; }
    if (inQuote) { cur += ch; if (ch === "'") inQuote = false; continue; }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === "'") { inQuote = true; cur += ch; continue; }
    if (ch === '(' || ch === '{') { depth++; cur += ch; continue; }
    if (ch === ')' || ch === '}') {
      if (depth === 0) { args.push(cur); return { args, end: i }; }
      depth--; cur += ch; continue;
    }
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return null;
}

/** Rewrite every call fn(...) via cb(args); cb returns replacement text or null to keep it. */
export function mapCalls(f: string, fn: string, cb: (args: string[]) => string | null): string {
  const re = new RegExp(`(?<![A-Z0-9_.])${fn.replace('.', '\\.')}\\(`, 'g');
  let out = '', i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(f))) {
    const r = callArgs(f, m.index + fn.length + 1);
    if (!r) continue;
    const rep = cb(r.args);
    if (rep == null) continue;
    out += f.slice(i, m.index) + rep;
    i = r.end + 1;
    re.lastIndex = i;
  }
  return out + f.slice(i);
}

const REF = /^(\$?)([A-Z]{1,3})(\$?)(\d+)/;

/**
 * Shift the relative parts of cell references by (dr, dc), leaving string literals,
 * quoted sheet names and function names alone. (exceljs's own shared-formula
 * translation also rewrites text inside string literals, e.g. "D30" -> "D34".)
 */
export function translateFormula(f: string, dr: number, dc: number): string {
  let out = '', i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < f.length && !(f[j] === ch && f[j + 1] !== ch)) j += f[j] === ch ? 2 : 1;
      out += f.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prev = f[i - 1] || '';
    if (!/[A-Za-z0-9_.]/.test(prev)) {
      const m = REF.exec(f.slice(i, i + 12));
      const after = m ? f[i + m[0].length] || '' : '';
      if (m && !/[A-Za-z0-9_.(!]/.test(after)) {
        const [, ca, col, ra, row] = m;
        const c = ca ? col : colName(colNum(col) + dc);
        const r = ra ? row : String(+row + dr);
        out += `${ca}${c}${ra}${r}`;
        i += m[0].length;
        continue;
      }
      const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(f.slice(i, i + 80));
      if (w) { out += w[0]; i += w[0].length; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}
