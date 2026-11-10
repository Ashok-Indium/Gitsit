// The GITSITFINAL report's DAX measures, evaluated over the (filtered) loan rows.
// Each function mirrors the measure of the same name in the semantic model's Loans table.

import { FIELD_BY_LABEL, type Scenario } from '@/engine/model-schema';
import type { CellOut, LoanSnapshot } from '@/engine/protocol';

export type Loan = LoanSnapshot;

/** A loan's value for a report column (by Power BI name). */
export const val = (l: Loan, label: string): CellOut => {
  const f = FIELD_BY_LABEL[label];
  if (!f) throw new Error(`Unknown report column ${label}`);
  return l.values[f.col];
};
export const num = (l: Loan, label: string): number => {
  const v = val(l, label);
  return typeof v === 'number' ? v : 0;
};
const flag = (l: Loan, label: string) => {
  const v = val(l, label);
  return v === 1 || v === true || v === 'Y' || v === 'Yes' ? 1 : 0;
};
export const text = (l: Loan, label: string) => {
  const v = val(l, label);
  return v == null || typeof v === 'object' ? '' : String(v);
};

const sum = (ls: Loan[], label: string) => ls.reduce((s, l) => s + num(l, label), 0);
const sumx = (ls: Loan[], f: (l: Loan) => number) => ls.reduce((s, l) => s + f(l), 0);
const divide = (a: number, b: number): number | null => (b ? a / b : null);
const share = (ls: Loan[], pred: (l: Loan) => boolean) => divide(ls.filter(pred).length, ls.length);

export const cfTotal = (l: Loan, s: Scenario) => l.strips[s].reduce((a, b) => a + b, 0);

export interface MeasureDef {
  name: string;
  /** Power BI format string. */
  fmt: string;
  calc: (ls: Loan[]) => number | null;
}

const m = (name: string, fmt: string, calc: (ls: Loan[]) => number | null): MeasureDef => ({ name, fmt, calc });

const bid = (ls: Loan[]) => sum(ls, 'Bid');
const nonReo = (ls: Loan[]) => ls.filter((l) => !flag(l, 'Is REO'));
const waCurrentRate = (ls: Loan[]) => {
  const n = nonReo(ls);
  return divide(sumx(n, (l) => num(l, 'Curr Rate') * num(l, 'UPB Accruing')), sum(n, 'UPB Accruing'));
};
const waRemTerm = (ls: Loan[]) => divide(sumx(ls, (l) => num(l, 'Rem Term Calc') * num(l, 'UPB Accruing')), sum(ls, 'UPB Accruing'));
const wa = (label: string) => (ls: Loan[]) => divide(sumx(ls, (l) => num(l, label) * num(l, 'Max Value')), sum(ls, 'Max Value'));
const propType = (t: string) => (ls: Loan[]) => share(ls, (l) => text(l, 'Property Type Group') === t);

export const MEASURES = {
  loans: m('# Loans', '#,##0', (ls) => ls.length),
  upb: m('Total UPB $', '$#,##0', (ls) => sum(ls, 'Total UPB')),
  payoff: m('Total Payoff $', '$#,##0', (ls) => sum(ls, 'Total Payoff')),
  bpo: m('BPO As-Is $', '$#,##0', (ls) => sum(ls, 'BPO As-Is')),
  faded: m('Faded Value $', '$#,##0', (ls) => sum(ls, 'Faded Value')),
  bid: m('Bid $', '$#,##0', bid),
  bidUpb: m('Bid % of Total UPB', '0.00%', (ls) => divide(bid(ls), sum(ls, 'Total UPB'))),
  bidPayoff: m('Bid % of Payoff', '0.00%', (ls) => divide(bid(ls), sum(ls, 'Total Payoff'))),
  bidFaded: m('Bid % of Faded Value', '0.00%', (ls) => divide(bid(ls), sum(ls, 'Faded Value'))),
  proceedsFaded: m('Proceeds % of Faded Value', '0.00%', (ls) => divide(sum(ls, 'Gross Proceeds'), sum(ls, 'Faded Value'))),
  moic: m('Gross MOIC', '0.0000', (ls) => {
    const r = divide(sum(ls, 'Gross Proceeds') + sum(ls, 'LL Exp/Inc') - bid(ls), bid(ls));
    return r === null ? null : r + 1;
  }),
  irr: m('Gross IRR (Bid-Wtd)', '0.00%', (ls) => divide(sumx(ls, (l) => num(l, 'Bid') * num(l, 'Gross IRR')), bid(ls))),
  waMonths: m('WA Months', '0.00', (ls) => divide(sumx(ls, (l) => num(l, 'Bid') * num(l, 'Months')), bid(ls))),
  poolFadedDtv: m('Pool Faded DTV', '#,##0.0', (ls) => {
    const r = divide(sum(ls, 'Total Payoff') + sum(ls, 'Junior Lien Bal'), sum(ls, 'Faded Value'));
    return r === null ? null : r * 100;
  }),
  poolBpoLtv: m('Pool BPO LTV', '#,##0.0', (ls) => { const r = divide(sum(ls, 'Total UPB'), sum(ls, 'BPO As-Is')); return r === null ? null : r * 100; }),
  poolFadedLtv: m('Pool Faded LTV', '#,##0.0', (ls) => { const r = divide(sum(ls, 'Total UPB'), sum(ls, 'Faded Value')); return r === null ? null : r * 100; }),
  fade: m('Fade %', '0.00%', (ls) => { const r = divide(sum(ls, 'Faded Value'), sum(ls, 'BPO As-Is')); return r === null ? null : r - 1; }),
  waRate: m('WA Current Rate', '0.000%', waCurrentRate),
  waMonthsDq: m('WA Months DQ', '0.0', (ls) => { const n = nonReo(ls); return divide(sum(n, 'Months DQ'), n.length); }),
  poolYield: m('Pool Yield at Bid', '0.00%', (ls) => {
    const br = divide(bid(ls), sum(ls, 'UPB Accruing'));
    const rate = waCurrentRate(ls), term = waRemTerm(ls);
    if (!br || rate === null || !term) return null;
    return rate / br + (1 - br) / br / (term / 12);
  }),
  waPcf: m('WA p(CF)', '0.0%', wa('p(CF)')),
  waPpayoff: m('WA p(Payoff)', '0.0%', wa('p(Payoff)')),
  waPreo: m('WA p(REO)', '0.0%', wa('p(REO)')),
  waPnpl: m('WA p(NPL)', '0.0%', wa('p(NPL)')),
  perfBid: m('Perf Bid $', '$#,##0', (ls) => sum(ls, 'Perf Bid')),
  payoffBid: m('Payoff Bid $', '$#,##0', (ls) => sum(ls, 'Payoff Bid')),
  reoBid: m('REO Bid $', '$#,##0', (ls) => sum(ls, 'REO Bid')),
  nplBid: m('NPL Bid $', '$#,##0', (ls) => sum(ls, 'NPL Bid')),
  pwtdBid: m('Pwtd Bid $', '$#,##0', (ls) => sum(ls, 'Pwtd Bid')),
  fcl: m('FCL %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is FCL')), ls.length)),
  bk: m('BK %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is BK')), ls.length)),
  equity: m('Equity Loans %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Equity')), ls.length)),
  recentCfs: m('Recent CFs %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Payment Recent')), ls.length)),
  modified: m('Modified %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Modified')), ls.length)),
  epd: m('EPD %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is EPD')), ls.length)),
  performing: m('Performing %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Performing')), ls.length)),
  lowValue: m('Low Value %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Low Value')), ls.length)),
  vacant: m('Vacant %', '0.0%', (ls) => divide(sumx(ls, (l) => flag(l, 'Is Vacant')), ls.length)),
  bpoUnder100k: m('BPO <= 100k %', '0.0%', (ls) => share(ls, (l) => num(l, 'BPO As-Is') <= 100000)),
  fadedLtv140: m('Faded LTV >= 140 %', '0.0%', (ls) => share(ls, (l) => num(l, 'Faded LTV') >= 140)),
  condo: m('Condo/PUD %', '0.0%', propType('Condo/PUD')),
  mobile: m('Mobile/Manu %', '0.0%', propType('Mobile/Manu')),
  warnings: m('# Loans With Warnings', '#,##0', (ls) => ls.filter((l) => text(l, 'Warning') !== '-').length),
} satisfies Record<string, MeasureDef>;

export type MeasureKey = keyof typeof MEASURES;

/** Group loans by a column's text value, in first-seen order. */
export function groupBy(ls: Loan[], label: string): [string, Loan[]][] {
  const g = new Map<string, Loan[]>();
  for (const l of ls) {
    const k = text(l, label) || '(Blank)';
    (g.get(k) ?? g.set(k, []).get(k)!).push(l);
  }
  return [...g];
}
