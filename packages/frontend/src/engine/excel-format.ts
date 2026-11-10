// Excel number formatting and rounding, free of HyperFormula so the UI can use it without
// pulling the engine into the page bundle.

// Rounding with Excel's 15-significant-digit correction (ROUND(197.895,2) = 197.9).
const sig15 = (x: number) => (x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(15)));
export function roundWith(x: number, d: number, mode: 'near' | 'up' | 'down' = 'near'): number {
  d = Math.trunc(d);
  const s = Math.sign(x), a = Math.abs(sig15(x));
  const scaled = sig15(d >= 0 ? a * 10 ** d : a / 10 ** -d);
  const r = mode === 'up' ? Math.ceil(scaled) : mode === 'down' ? Math.floor(scaled) : Math.floor(scaled + 0.5);
  return s * (d >= 0 ? r / 10 ** d : r * 10 ** -d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(n: number, fmt: string): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (t) => {
    switch (t.toLowerCase()) {
      case 'yyyy': return String(Y);
      case 'yy': return String(Y).slice(-2);
      case 'mmmm': return d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      case 'mmm': return MONTHS[M];
      case 'mm': return String(M + 1).padStart(2, '0');
      case 'm': return String(M + 1);
      case 'dd': return String(D).padStart(2, '0');
      default: return String(D);
    }
  });
}
function formatNumber(x: number, fmt: string): string {
  const m = /^([^0#]*)([0#,]*)(?:\.([0#]+))?(.*)$/.exec(fmt);
  if (!m) return String(x);
  const [, prefix, intPart, decPart = '', suffix] = m;
  if (suffix.includes('%')) x *= 100;
  const decimals = decPart.length;
  const v = roundWith(Math.abs(x), decimals);
  const [whole, frac = ''] = v.toFixed(decimals).split('.');
  const minInt = (intPart.match(/0/g) || []).length;
  let i = whole === '0' && minInt === 0 ? '' : whole;
  i = i.padStart(minInt, '0');
  if (intPart.includes(',')) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (x < 0 && v !== 0 ? '-' : '') + prefix + i + (decimals ? '.' + frac : '') + suffix;
}

/** Splits a number format into its sections (positive;negative;zero;text), ignoring ; in quotes. */
function sections(fmt: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of fmt) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur];
}

/** One section as plain text around its number placeholder: colours, padding and fills dropped, quotes resolved. */
function literalize(section: string): { prefix: string; pattern: string; suffix: string; percent: boolean } {
  // Each character, marked when it is literal text (quoted or escaped) rather than format code.
  const chars: { ch: string; lit: boolean }[] = [];
  let quoted = false;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (quoted) {
      if (ch === '"') quoted = false;
      else chars.push({ ch, lit: true });
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '[') { const end = section.indexOf(']', i); if (end < 0) break; i = end; continue; } // [Red], [>=100]
    if (ch === '_' || ch === '*') { i++; continue; } // padding to a character's width, fill
    if (ch === '\\') { chars.push({ ch: section[++i] ?? '', lit: true }); continue; }
    chars.push({ ch, lit: false });
  }
  const text = (from: number, to?: number) => chars.slice(from, to).map((c) => c.ch).join('');
  const percent = chars.some((c) => !c.lit && c.ch === '%');
  const inNumber = (c: { ch: string; lit: boolean }) => !c.lit && /[0#?,.]/.test(c.ch);
  const first = chars.findIndex((c) => !c.lit && /[0#?]/.test(c.ch));
  if (first < 0) return { prefix: text(0), pattern: '', suffix: '', percent };
  let start = first, end = first;
  while (start > 0 && inNumber(chars[start - 1])) start--;
  while (end < chars.length && inNumber(chars[end])) end++;
  return { prefix: text(0, start), pattern: text(start, end), suffix: text(end), percent };
}

/**
 * A cell value as Excel shows it with the given number format (as on the Model sheet): the
 * positive / negative / zero sections, [Red], padding (_), fills (*), quoted text ("-", "$"),
 * %, x and dates. An empty format is Excel's General.
 */
export function excelDisplay(v: unknown, fmt: string): string {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '#NUM!';
  if (!fmt) return String(Number(v.toPrecision(10)));
  // A date format (ignoring quoted text and [Red]-style brackets).
  if (/[yd]|m{3}/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) return formatDate(v, fmt);
  const parts = sections(fmt);
  const section = v > 0 || (v < 0 && parts.length < 2) ? parts[0] : v < 0 ? parts[1] : (parts[2] ?? parts[0]);
  const { prefix, pattern, suffix, percent } = literalize(section);
  if (!pattern.replace(/[,.]/g, '')) return (prefix + suffix).trim(); // a zero section like "-"
  const x = Math.abs(v) * (percent ? 100 : 1);
  const [intPat, decPat = ''] = pattern.split('.');
  const decimals = (decPat.match(/[0#?]/g) || []).length;
  const r = roundWith(x, decimals);
  let [whole, frac = ''] = r.toFixed(decimals).split('.');
  const minInt = (intPat.match(/0/g) || []).length;
  if (whole === '0' && minInt === 0) whole = '';
  whole = whole.padStart(minInt, '0');
  if (intPat.includes(',')) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Optional decimal places (#) drop their trailing zeros; required ones (0) keep them.
  const minDec = (decPat.match(/0/g) || []).length;
  while (frac.length > minDec && frac.endsWith('0')) frac = frac.slice(0, -1);
  const number = whole + (frac ? `.${frac}` : '');
  // The negative section carries its own sign or brackets; without one Excel adds a minus.
  const sign = v < 0 && parts.length < 2 && r !== 0 ? '-' : '';
  return `${sign}${prefix}${number}${suffix}`.trim();
}

/** Excel TEXT(value, format) for the number and date formats the model and report use. */
export function excelText(v: unknown, fmt: string): string {
  if (typeof v !== 'number') return v == null ? '' : String(v);
  if (/[yd]|m{3}/i.test(fmt.replace(/"[^"]*"/g, ''))) return formatDate(v, fmt);
  return formatNumber(v, fmt);
}
