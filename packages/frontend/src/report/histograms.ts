// The report's 13 distribution pages ('Histogram Bins' table). A first-lien loan falls in a bin
// when its value is above the previous edge and at or below this one; the overflow bin has no
// upper edge. The Payers YTM histogram counts performing loans only.

import { num, val, type Loan } from './measures';

export interface HistogramDef {
  id: string;
  title: string;
  /** Report column binned. */
  value: string;
  /** Report column summed for the cumulative %. */
  weight: string;
  edges: number[];
  labels: string[];
  performingOnly?: boolean;
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const withOverflow = (edges: number[], fmt: (n: number) => string, overflow: string) => [...edges.map(fmt), overflow];

const VALUE_EDGES = [40000, 60000, 80000, 100000, 125000, 150000, 200000, 250000, 350000, 500000, 750000, 1000000];
const LTV_EDGES = [20, 40, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200];
const DQ_EDGES = [0, 1, 2, 3, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120];
const SEASONED_EDGES = [0, 1, 2, 3, 6, 12, 24, 36, 48, 60, 120, 180, 240, 300, 360];
const RATE_EDGES = [0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07, 0.08, 0.09, 0.1, 0.11];
const PI_EDGES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000, 3500, 4000, 4500, 5000];
const YTM_EDGES = [0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095, 0.1, 0.105, 0.11];
// Last day of each origination year as an Excel serial: 1994 & prior, then 1995 ... 2024.
const YEAR_EDGES = [34699, 35064, 35430, 35795, 36160, 36525, 36891, 37256, 37621, 37986, 38352, 38717, 39082, 39447, 39813,
  40178, 40543, 40908, 41274, 41639, 42004, 42369, 42735, 43100, 43465, 43830, 44196, 44561, 44926, 45291, 45657];

const value = (id: string, title: string, col: string, weight: string): HistogramDef =>
  ({ id, title, value: col, weight, edges: VALUE_EDGES, labels: withOverflow(VALUE_EDGES, money, '>$1mm') });
const band = (id: string, title: string, col: string, edges: number[], fmt: (n: number) => string, overflow: string): HistogramDef =>
  ({ id, title, value: col, weight: 'Max Value', edges, labels: withOverflow(edges, fmt, overflow) });

export const HISTOGRAMS: Record<string, HistogramDef> = {
  sellerValue: value('sellerValue', 'Seller Value Distribution', 'BPO As-Is', 'BPO As-Is'),
  totalUpb: value('totalUpb', 'Total UPB Distribution', 'Total UPB', 'Total UPB'),
  assetValue: value('assetValue', 'Asset Value Distribution', 'Max Value', 'Max Value'),
  ltv: band('ltv', 'LTV Distribution', 'Faded LTV', LTV_EDGES, String, '>200'),
  dtv: band('dtv', 'DTV Distribution', 'Faded DTV', LTV_EDGES, String, '>200'),
  monthsDq: band('monthsDq', 'Months DQ Distribution', 'Months DQ', DQ_EDGES, String, '>120'),
  seasoned: band('seasoned', 'Months Seasoned from Orig/Mod', 'Loan Age Months', SEASONED_EDGES, String, '>360'),
  rate: band('rate', 'Rate Distribution', 'Curr Rate', RATE_EDGES, pct, '>11.00%'),
  pi: { ...band('pi', 'P&I Distribution', 'Curr P&I', PI_EDGES, money, '>$5,000'), weight: 'Curr P&I' },
  origYear: {
    id: 'origYear', title: 'Origination Year Distribution', value: 'Orig First Pay Date Calc', weight: 'Max Value',
    edges: YEAR_EDGES, labels: ['1994 & prior', ...YEAR_EDGES.slice(1).map((_, i) => String(1995 + i))],
  },
  payersYtm: { ...band('payersYtm', 'Payers Current YTM Distribution', 'Yield at Bid', YTM_EDGES, pct, '>11.00%'), performingOnly: true },
};

export interface BinRow {
  label: string;
  loans: Loan[];
  weight: number;
}

/** Bin loans by `value` using a histogram's edges (first lien only, as in the report). */
export function binLoans(def: HistogramDef, loans: Loan[], valueCol = def.value, weightCol = def.weight): BinRow[] {
  const rows: BinRow[] = def.labels.map((label) => ({ label, loans: [], weight: 0 }));
  const hasOverflow = def.labels.length > def.edges.length;
  for (const l of loans) {
    if (num(l, 'Lien') !== 1) continue;
    if (def.performingOnly && num(l, 'Is Performing') !== 1) continue;
    const v = val(l, valueCol);
    if (typeof v !== 'number') continue;
    let i = def.edges.findIndex((e) => v <= e);
    if (i === -1) { if (!hasOverflow) continue; i = def.edges.length; }
    rows[i].loans.push(l);
    rows[i].weight += num(l, weightCol);
  }
  return rows;
}

/** Running share of `weight` through each bin. */
export function cumulative(rows: BinRow[]): number[] {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let run = 0;
  return rows.map((r) => { run += r.weight; return total ? run / total : 0; });
}
