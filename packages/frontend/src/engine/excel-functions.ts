// Excel behaviours HyperFormula lacks or differs on, registered as a function plugin:
// N, VALUE, SINGLE (@), MODE, plus Excel-faithful TEXT, ROUND*, IPMT/PPMT, CUMIPMT/CUMPRINC, XNPV.

import {
  CellError,
  ErrorType,
  FunctionArgumentType,
  FunctionPlugin,
  HyperFormula,
  type ConfigParams,
  type ImplementedFunctions,
} from 'hyperformula';

import { excelText, roundWith } from './excel-format.ts';

export { excelText, roundWith };

type Raw = number | string | boolean | null | CellError;
type Ast = { args: unknown[] };

interface RangeLike {
  valuesFromTopLeftCorner(): unknown[];
}
const isRange = (v: unknown): v is RangeLike =>
  !!v && typeof (v as RangeLike).valuesFromTopLeftCorner === 'function';

// Unwrap HyperFormula's rich numbers (dates, currency) and map its EmptyValue symbol to null.
const raw = (v: unknown): Raw => {
  if (typeof v === 'symbol' || v === undefined) return null;
  if (v instanceof CellError) return v;
  if (v && typeof v === 'object' && typeof (v as { val?: unknown }).val === 'number') return (v as { val: number }).val;
  return v as Raw;
};

const NUM = () => new CellError(ErrorType.NUM);
const finite = (x: number) => (Number.isFinite(x) ? x : NUM());

// ---- Annuity math with Excel semantics ----
function pmt(rate: number, nper: number, pv: number, fv = 0, type = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const p = (1 + rate) ** nper;
  return -(rate * (pv * p + fv)) / ((1 + rate * type) * (p - 1));
}
function futureValue(rate: number, nper: number, payment: number, pv: number, type = 0): number {
  if (rate === 0) return -(pv + payment * nper);
  const p = (1 + rate) ** nper;
  return -(pv * p + (payment * (1 + rate * type) * (p - 1)) / rate);
}
function ipmt(rate: number, per: number, nper: number, pv: number, fv = 0, type = 0): number {
  const payment = pmt(rate, nper, pv, fv, type);
  let interest: number;
  if (per === 1) interest = type === 1 ? 0 : -pv;
  else interest = type === 1
    ? futureValue(rate, per - 2, payment, pv, 1) - payment
    : futureValue(rate, per - 1, payment, pv, 0);
  return interest * rate;
}

function parseValue(s: string): number | CellError {
  const t = s.trim().replace(/[$,\s]/g, '');
  if (t === '') return 0;
  const pct = t.endsWith('%');
  const n = Number(pct ? t.slice(0, -1) : t);
  if (Number.isFinite(n)) return pct ? n / 100 : n;
  const d = Date.parse(s);
  if (!Number.isNaN(d)) return Math.round((d - Date.UTC(1899, 11, 30)) / 86400000);
  return new CellError(ErrorType.VALUE);
}

const numericArgs = (n: number, optional = 0) =>
  [...Array(n)].map(() => ({ argumentType: FunctionArgumentType.NUMBER }))
    .concat([...Array(optional)].map(() => ({ argumentType: FunctionArgumentType.NUMBER, defaultValue: 0 })));

class ExcelCompatPlugin extends FunctionPlugin {
  private run(ast: Ast, state: unknown, name: string, fn: (...args: never[]) => unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata(name), fn as never);
  }
  n(ast: Ast, state: unknown) {
    return this.run(ast, state, 'N', (v: unknown) => {
      const r = raw(v);
      return typeof r === 'number' ? r : typeof r === 'boolean' ? (r ? 1 : 0) : 0;
    });
  }
  value(ast: Ast, state: unknown) {
    return this.run(ast, state, 'VALUE', (v: unknown) => {
      const r = raw(v);
      if (typeof r === 'number') return r;
      if (r == null) return 0;
      if (typeof r === 'boolean' || r instanceof CellError) return new CellError(ErrorType.VALUE);
      return parseValue(r);
    });
  }
  single(ast: Ast, state: unknown) {
    return this.run(ast, state, 'SINGLE', (v: unknown) => raw(v) ?? 0);
  }
  // MODE / MODE.SNGL: most frequent number; first-seen wins ties, #N/A if nothing repeats.
  mode(ast: Ast, state: unknown) {
    return this.run(ast, state, 'MODE', (...args: unknown[]) => {
      const nums: number[] = [];
      for (const a of args) {
        for (const item of isRange(a) ? a.valuesFromTopLeftCorner() : [a]) {
          const v = raw(item);
          if (v instanceof CellError) return v;
          if (typeof v === 'number') nums.push(v);
        }
      }
      const counts = new Map<number, number>();
      let best: number | null = null, bestN = 1;
      for (const n of nums) {
        const c = (counts.get(n) || 0) + 1;
        counts.set(n, c);
        if (c > bestN) { best = n; bestN = c; }
      }
      return best === null ? new CellError(ErrorType.NA) : best;
    });
  }
  text(ast: Ast, state: unknown) {
    return this.run(ast, state, 'TEXT', (v: unknown, fmt: unknown) => excelText(raw(v), String(raw(fmt) ?? '')));
  }
  round(ast: Ast, state: unknown) {
    return this.run(ast, state, 'ROUND', (x: number, d: number) => roundWith(x, d));
  }
  roundup(ast: Ast, state: unknown) {
    return this.run(ast, state, 'ROUNDUP', (x: number, d: number) => roundWith(x, d, 'up'));
  }
  rounddown(ast: Ast, state: unknown) {
    return this.run(ast, state, 'ROUNDDOWN', (x: number, d: number) => roundWith(x, d, 'down'));
  }
  ipmt(ast: Ast, state: unknown) {
    return this.run(ast, state, 'IPMT', (rate: number, per: number, nper: number, pv: number, fv: number, type: number) =>
      per < 1 || per > nper ? NUM() : finite(ipmt(rate, per, nper, pv, fv, type ? 1 : 0)));
  }
  ppmt(ast: Ast, state: unknown) {
    return this.run(ast, state, 'PPMT', (rate: number, per: number, nper: number, pv: number, fv: number, type: number) => {
      if (per < 1 || per > nper) return NUM();
      const t = type ? 1 : 0;
      return finite(pmt(rate, nper, pv, fv, t) - ipmt(rate, per, nper, pv, fv, t));
    });
  }
  cumipmt(ast: Ast, state: unknown) {
    return this.run(ast, state, 'CUMIPMT', (rate: number, nper: number, pv: number, start: number, end: number, type: number) => {
      start = Math.ceil(start); end = Math.floor(end);
      if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < 1 || start > end || end > nper || (type !== 0 && type !== 1)) return NUM();
      const payment = pmt(rate, nper, pv, 0, type);
      let interest = 0;
      if (start === 1 && type === 0) { interest = -pv; start++; }
      for (let i = start; i <= end; i++)
        interest += type === 1 ? futureValue(rate, i - 2, payment, pv, 1) - payment : futureValue(rate, i - 1, payment, pv, 0);
      return finite(interest * rate);
    });
  }
  cumprinc(ast: Ast, state: unknown) {
    return this.run(ast, state, 'CUMPRINC', (rate: number, nper: number, pv: number, start: number, end: number, type: number) => {
      start = Math.ceil(start); end = Math.floor(end);
      if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < 1 || start > end || end > nper || (type !== 0 && type !== 1)) return NUM();
      const payment = pmt(rate, nper, pv, 0, type);
      let principal = 0;
      if (start === 1) { principal = type === 0 ? payment + pv * rate : payment; start++; }
      for (let i = start; i <= end; i++)
        principal += type > 0
          ? payment - (futureValue(rate, i - 2, payment, pv, 1) - payment) * rate
          : payment - futureValue(rate, i - 1, payment, pv, 0) * rate;
      return finite(principal);
    });
  }
  // XNPV(rate, values, dates): pairs with an empty value or date are skipped.
  xnpv(ast: Ast, state: unknown) {
    return this.run(ast, state, 'XNPV', (rate: number, values: unknown, dates: unknown) => {
      const vs = isRange(values) ? values.valuesFromTopLeftCorner() : [values];
      const ds = isRange(dates) ? dates.valuesFromTopLeftCorner() : [dates];
      if (vs.length !== ds.length) return NUM();
      let d0: number | null = null, sum = 0;
      for (let i = 0; i < vs.length; i++) {
        const v = raw(vs[i]), d = raw(ds[i]);
        if (v instanceof CellError) return v;
        if (d instanceof CellError) return d;
        if (v == null || d == null || v === '' || d === '') continue;
        if (typeof v !== 'number' || typeof d !== 'number') return new CellError(ErrorType.VALUE);
        if (d0 === null) d0 = d;
        sum += v / (1 + rate) ** ((d - d0) / 365);
      }
      return finite(sum);
    });
  }
}

const IMPLEMENTED: ImplementedFunctions = {
  N: { method: 'n', parameters: [{ argumentType: FunctionArgumentType.SCALAR }] },
  VALUE: { method: 'value', parameters: [{ argumentType: FunctionArgumentType.SCALAR }] },
  SINGLE: { method: 'single', parameters: [{ argumentType: FunctionArgumentType.SCALAR }] },
  MODE: { method: 'mode', parameters: [{ argumentType: FunctionArgumentType.ANY }], repeatLastArgs: 1 },
  TEXT: { method: 'text', parameters: [{ argumentType: FunctionArgumentType.SCALAR }, { argumentType: FunctionArgumentType.STRING }] },
  ROUND: { method: 'round', parameters: numericArgs(1, 1) },
  ROUNDUP: { method: 'roundup', parameters: numericArgs(1, 1) },
  ROUNDDOWN: { method: 'rounddown', parameters: numericArgs(1, 1) },
  IPMT: { method: 'ipmt', parameters: numericArgs(4, 2) },
  PPMT: { method: 'ppmt', parameters: numericArgs(4, 2) },
  CUMIPMT: { method: 'cumipmt', parameters: numericArgs(6) },
  CUMPRINC: { method: 'cumprinc', parameters: numericArgs(6) },
  XNPV: {
    method: 'xnpv',
    parameters: [
      { argumentType: FunctionArgumentType.NUMBER },
      { argumentType: FunctionArgumentType.RANGE },
      { argumentType: FunctionArgumentType.RANGE },
    ],
  },
};
ExcelCompatPlugin.implementedFunctions = IMPLEMENTED;

const OVERRIDDEN = ['TEXT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'IPMT', 'PPMT', 'CUMIPMT', 'CUMPRINC', 'XNPV'];

let registered = false;
export function registerExcelFunctions(): void {
  if (registered) return;
  for (const name of OVERRIDDEN) HyperFormula.unregisterFunction(name);
  const names = Object.keys(IMPLEMENTED);
  HyperFormula.registerFunctionPlugin(ExcelCompatPlugin, {
    enGB: Object.fromEntries(names.map((n) => [n, n])),
  });
  registered = true;
}

/** Engine settings that make HyperFormula behave like desktop Excel for this workbook. */
export const EXCEL_CONFIG: Partial<ConfigParams> = {
  // HyperFormula is used under GPLv3 for this internal app; swap in a commercial key if licensed.
  licenseKey: 'gpl-v3',
  useArrayArithmetic: true,
  smartRounding: true, // also enables epsilon comparisons (0.115-0.11 > 0.5% is FALSE)
  dateFormats: ['MM/DD/YYYY', 'MM/DD/YY', 'YYYY-MM-DD', 'YYYY/MM/DD'],
  maxRows: 100000,
  maxColumns: 20000,
};
