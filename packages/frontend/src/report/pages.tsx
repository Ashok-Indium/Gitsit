// The GITSITFINAL report pages, laid out after the report's own visual positions (1280x720 canvas).

import { ExternalLink } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import clearFilterIcon from '@/assets/clear-filter.png';
import { ASSUMPTIONS } from '@/engine/assumptions';
import type { Snapshot } from '@/engine/protocol';
import { REPORT_TABLES } from '@/engine/report-fields';
import { cn } from '@/lib/utils';

import { ConstraintsPage, type ConstraintsChoice } from './constraints';
import { EditFieldsPage } from './edit-fields';
import { ALL_SECTION_COLUMNS, applyFilters, LINKS, optionsOf, SECTIONS, sheetSummary, type Filters, type SectionId } from './home-sections';
import { BarChart, DistributionChart, type Series } from './charts';
import { pbiAuto, pbiFormat } from './format';
import { binLoans, cumulative, HISTOGRAMS, type HistogramDef } from './histograms';
import { groupBy, MEASURES, num, text, type Loan, type MeasureKey } from './measures';
import { CashFlowPivot, LoanTable, MeasureMatrix, type Editing } from './tables';
import { CardGroup, FileSlicer, PageBanner, Slicer, VisualFrame, type InputFileOption } from './visuals';

// ---------- slicers ----------

export { applyFilters, type Filters };
export const HOME_SLICERS = ['File Name', 'Pool'] as const;
export const ANALYSIS_SLICERS = [
  { col: 'Prop State', label: 'State' },
  { col: 'Loan Status', label: 'Loan Status' },
  { col: 'Exit', label: 'Most Likely Exit' },
  { col: 'Carve', label: 'Carve' },
] as const;


/** The input files (File_Name) in Input_table and the one the model is built from. */
export interface FileChoice {
  files: InputFileOption[];
  fileName: string | null;
  onFileChange: (name: string) => void;
  /** True while the model is being built, when switching files must wait. */
  busy: boolean;
}

export interface PageProps {
  snapshot: Snapshot;
  editing: Editing;
  filters: Filters;
  setFilters: (f: Filters) => void;
  navigate: (page: PageId) => void;
  file: FileChoice;
  /** The selected file's model constants (the Constraints page). */
  constraints?: ConstraintsChoice;
}

function AnalysisSlicers({ snapshot, filters, setFilters }: Pick<PageProps, 'snapshot' | 'filters' | 'setFilters'>) {
  return (
    <div className="grid grid-cols-2 gap-300 lg:grid-cols-4">
      {ANALYSIS_SLICERS.map((s) => (
        <Slicer key={s.col} label={s.label} options={optionsOf(snapshot.loans, s.col)} selected={filters[s.col] ?? []}
          onChange={(v) => setFilters({ ...filters, [s.col]: v })} />
      ))}
    </div>
  );
}

function HomeSlicers({ snapshot, filters, setFilters, file, extra }: Pick<PageProps, 'snapshot' | 'filters' | 'setFilters' | 'file'> & { extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-300 px-300">
      <FileSlicer className="w-full sm:w-[457px]" files={file.files} value={file.fileName} onChange={file.onFileChange} disabled={file.busy} />
      <Slicer label="Pool" className="w-48" options={optionsOf(snapshot.loans, 'Pool')} selected={filters.Pool ?? []}
        onChange={(v) => setFilters({ ...filters, Pool: v })} />
      {extra}
    </div>
  );
}

const cards = (loans: Loan[], keys: MeasureKey[]) =>
  keys.map((k) => ({ label: MEASURES[k].name, value: pbiAuto(MEASURES[k].calc(loans), MEASURES[k].fmt), title: pbiFormat(MEASURES[k].calc(loans), MEASURES[k].fmt) }));

const sumBy = (loans: Loan[], col: string, measure: 'bid' | 'loans') =>
  groupBy(loans, col).map(([label, ls]) => ({ label, value: MEASURES[measure].calc(ls) ?? 0 }));

// ---------- Home ----------

const actionBtn = 'inline-flex items-center justify-center gap-100 rounded-2xl bg-action px-400 py-200 text-300 text-action-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function HomePage({ snapshot, editing, filters, setFilters, navigate, file }: PageProps) {
  const [section, setSection] = useState<SectionId>('output');
  const s = SECTIONS.find((x) => x.id === section)!;
  const loans = applyFilters(snapshot.loans, filters);
  return (
    <div className="flex flex-col gap-300 bg-card pb-300">
      <PageBanner title="GITSIT Bid Model Dashboard" />
      <HomeSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} file={file} extra={
        <>
          <button type="button" title="Clear Filters" aria-label="Clear filters" onClick={() => setFilters({})}
            className="mb-100 rounded-md p-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src={clearFilterIcon} alt="" className="icon-size-600" />
          </button>
          <button type="button" className={cn(actionBtn, 'ml-auto')} onClick={() => navigate('loanDetail')}>Master Table</button>
        </>
      } />
      <div className="flex flex-wrap items-center justify-between gap-300 px-300">
        <nav aria-label="Related reports" className="flex flex-wrap gap-200">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={actionBtn}>
              {l.label}<ExternalLink aria-hidden className="icon-size-100" />
            </a>
          ))}
        </nav>
        <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-100">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={section === x.id} onClick={() => setSection(x.id)}
              className={cn('rounded-2xl border px-300 py-200 text-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                section === x.id ? 'border-tab-active bg-tab-active text-tab-active-foreground' : 'border-visual-border bg-tab text-tab-foreground hover:bg-tab-active hover:text-tab-active-foreground')}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-300 px-300">
        <VisualFrame title={s.label}>
          {/* Coloured as the Model sheet. */}
          <LoanTable columns={s.columns} loans={loans} editing={editing} maxHeight={'scenario' in s ? 'max-h-[38vh]' : 'max-h-[62vh]'}
            summary={sheetSummary(snapshot, loans.length)} sheet={snapshot} />
        </VisualFrame>
        {'scenario' in s && (
          <VisualFrame title={`${s.scenario} Cash Flows by Month`}>
            <CashFlowPivot loans={loans} scenario={s.scenario} sheet />
          </VisualFrame>
        )}
      </div>
    </div>
  );
}

// ---------- Distribution pages ----------

export function HistogramPage({ def, combined, snapshot, filters, setFilters, file }: PageProps & { def: HistogramDef; combined?: 'upb' | 'assetMm' }) {
  const loans = applyFilters(snapshot.loans, filters);
  const title = combined === 'upb' ? 'Seller Value & Total UPB Distribution' : combined === 'assetMm' ? 'Asset Value Distribution ($mm)' : def.title;
  const bins = binLoans(def, loans);
  const count = (v: number) => v.toLocaleString('en-US');
  const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
  let columns: Series[], lines: Series[];
  if (combined === 'assetMm') {
    columns = [{ name: 'Bin Asset Value $mm', values: bins.map((b) => b.weight / 1e6), format: (v) => `$${v.toFixed(2)}`, color: 'series-1' }];
    lines = [
      { name: 'Bin LTV', values: bins.map((b) => { const bpo = b.loans.reduce((s, l) => s + num(l, 'BPO As-Is'), 0); return bpo ? (b.loans.reduce((s, l) => s + num(l, 'Total UPB'), 0) / bpo) * 100 : null; }), format: (v) => v.toFixed(1), color: 'series-3' },
      { name: '100 LTV', values: bins.map(() => 100), format: (v) => v.toFixed(0), color: 'series-4', dashed: true },
    ];
  } else if (combined === 'upb') {
    const upbBins = binLoans(def, loans, 'Total UPB', 'Total UPB');
    columns = [
      { name: 'Loans in Bin', values: bins.map((b) => b.loans.length), format: count, color: 'series-1' },
      { name: 'UPB Loans in Bin', values: upbBins.map((b) => b.loans.length), format: count, color: 'series-2' },
    ];
    lines = [
      { name: 'Cumulative %', values: cumulative(bins), format: pct1, color: 'series-3' },
      { name: 'Cumulative UPB %', values: cumulative(upbBins), format: pct1, color: 'series-4' },
    ];
  } else {
    columns = [{ name: 'Loans in Bin', values: bins.map((b) => b.loans.length), format: count, color: 'series-1' }];
    lines = [{ name: 'Cumulative %', values: cumulative(bins), format: pct1, color: 'series-3' }];
  }
  return (
    <div className="flex flex-col gap-300 bg-card pb-300">
      <PageBanner title={title} />
      <HomeSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} file={file} />
      <div className="px-300">
        <VisualFrame title={title}>
          <DistributionChart labels={def.labels} columns={columns} lines={lines} height={440} />
        </VisualFrame>
      </div>
    </div>
  );
}

// ---------- Bid Summary ----------

export function BidSummaryPage({ snapshot, filters, setFilters }: PageProps) {
  const loans = applyFilters(snapshot.loans, filters);
  const money = (v: number) => pbiAuto(v, '$#,##0');
  return (
    <div className="flex flex-col gap-300 p-300">
      <AnalysisSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} />
      <CardGroup title="Pool" items={cards(loans, ['loans', 'upb', 'payoff', 'bpo', 'faded', 'bid'])} />
      <CardGroup title="Bid and Returns" items={cards(loans, ['bidUpb', 'bidPayoff', 'bidFaded', 'moic', 'irr', 'waMonths'])} />
      <div className="grid gap-300 lg:grid-cols-3">
        <VisualFrame title="Bid by Most Likely Exit"><BarChart data={sumBy(loans, 'Exit', 'bid')} format={money} /></VisualFrame>
        <VisualFrame title="Bid by State"><BarChart data={sumBy(loans, 'Prop State', 'bid')} format={money} /></VisualFrame>
        <VisualFrame title="Bid by Loan Status"><BarChart data={sumBy(loans, 'Loan Status', 'bid')} format={money} /></VisualFrame>
      </div>
    </div>
  );
}

// ---------- Pool Stratification ----------

const STRAT: MeasureKey[] = ['loans', 'upb', 'payoff', 'faded', 'bid', 'bidUpb', 'bidFaded', 'proceedsFaded', 'irr', 'waMonths', 'poolFadedDtv'];

export function StratificationPage({ snapshot, filters, setFilters }: PageProps) {
  const loans = applyFilters(snapshot.loans, filters);
  const ms = STRAT.map((k) => MEASURES[k]);
  return (
    <div className="flex flex-col gap-300 p-300">
      <AnalysisSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} />
      <VisualFrame title="By Loan Status"><MeasureMatrix rowLabel="Loan Status" groups={groupBy(loans, 'Loan Status')} all={loans} measures={ms} /></VisualFrame>
      <VisualFrame title="By Region"><MeasureMatrix rowLabel="Region" groups={groupBy(loans, 'Region')} all={loans} measures={ms} /></VisualFrame>
      <VisualFrame title="By BPO Band"><MeasureMatrix rowLabel="BPO Band" groups={groupBy(loans, 'BPO Band')} all={loans} measures={ms} /></VisualFrame>
    </div>
  );
}

// ---------- Exit Scenarios ----------

export function ExitsPage({ snapshot, editing, filters, setFilters }: PageProps) {
  const loans = applyFilters(snapshot.loans, filters);
  return (
    <div className="flex flex-col gap-300 p-300">
      <AnalysisSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} />
      <div className="grid gap-300 lg:grid-cols-[560fr_690fr]">
        <CardGroup title="Value-Weighted Exit Probabilities" items={cards(loans, ['waPcf', 'waPpayoff', 'waPreo', 'waPnpl'])} />
        <CardGroup title="Scenario Bids" items={cards(loans, ['perfBid', 'payoffBid', 'reoBid', 'nplBid', 'pwtdBid'])} />
      </div>
      <VisualFrame title="Scenario Bids by Loan"><LoanTable columns={REPORT_TABLES.scenarioBids} loans={loans} editing={editing} /></VisualFrame>
    </div>
  );
}

// ---------- Pool Mix & Credit ----------

export function MixPage({ snapshot, filters, setFilters }: PageProps) {
  const loans = applyFilters(snapshot.loans, filters);
  const count = (v: number) => v.toLocaleString('en-US');
  return (
    <div className="flex flex-col gap-300 p-300">
      <AnalysisSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} />
      <CardGroup title="Credit" items={cards(loans, ['poolBpoLtv', 'poolFadedLtv', 'poolFadedDtv', 'fade', 'waRate', 'waMonthsDq', 'poolYield'])} />
      <CardGroup title="Pool Mix" items={cards(loans, ['fcl', 'bk', 'equity', 'recentCfs', 'modified', 'epd', 'performing'])} />
      <CardGroup title="Property Mix" items={cards(loans, ['lowValue', 'vacant', 'bpoUnder100k', 'fadedLtv140', 'condo', 'mobile', 'warnings'])} />
      <div className="grid gap-300 lg:grid-cols-2">
        <VisualFrame title="Loans by Warning"><BarChart data={sumBy(loans, 'Warning', 'loans')} format={count} /></VisualFrame>
        <VisualFrame title="Loans by Performing Note"><BarChart data={sumBy(loans, 'Perf Note', 'loans')} format={count} /></VisualFrame>
      </div>
    </div>
  );
}

// ---------- Loan Detail ----------

export function LoanDetailPage({ snapshot, editing, filters, setFilters }: PageProps) {
  const loans = applyFilters(snapshot.loans, filters);
  return (
    <div className="flex flex-col gap-300 p-300">
      <AnalysisSlicers snapshot={snapshot} filters={filters} setFilters={setFilters} />
      {/* Every Home page column (Model Output and the four DCF sections) in one table. */}
      <VisualFrame title="Loan Detail"><LoanTable columns={ALL_SECTION_COLUMNS} loans={loans} editing={editing} maxHeight="max-h-[72vh]" /></VisualFrame>
    </div>
  );
}

// ---------- Assumptions ----------

export function AssumptionsPage({ snapshot, editing }: PageProps) {
  const defaultHurdle = snapshot.assumptions.CC1;
  const overrides = useMemo(() => snapshot.loans.filter((l) => {
    const method = text(l, 'Bid Method');
    return method !== 'p-wtd' || l.values.CC !== defaultHurdle;
  }), [snapshot, defaultHurdle]);
  const thc = 'border-b-2 border-visual-border px-200 py-100 text-left font-bold';
  const tdc = 'border-b border-visual-border/60 px-200 py-100 align-top';
  return (
    <div className="grid gap-300 p-300 lg:grid-cols-[840fr_410fr]">
      <VisualFrame title="Model Assumptions">
        <div className="max-h-[78vh] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-200">
            <thead className="sticky top-0 bg-card"><tr>
              <th scope="col" className={thc}>Parameter</th><th scope="col" className={cn(thc, 'text-right')}>Value</th>
              <th scope="col" className={thc}>Excel Cell</th><th scope="col" className={thc}>Description</th>
            </tr></thead>
            <tbody>
              {ASSUMPTIONS.map((a) => {
                const live = snapshot.assumptions[a.cell];
                const v = live === undefined ? a.reportValue : live;
                return (
                  <tr key={a.parameter} className="hover:bg-hover">
                    <th scope="row" className={cn(tdc, 'text-left font-normal')}>{a.parameter}</th>
                    <td className={cn(tdc, 'text-right tabular-nums')}>{typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : pbiFormat(v, '')}</td>
                    <td className={cn(tdc, 'font-monospace text-muted-foreground')}>Model!{a.cell}</td>
                    <td className={cn(tdc, 'text-muted-foreground')}>{a.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </VisualFrame>
      <VisualFrame title="Loan Overrides">
        {overrides.length ? (
          <table className="min-w-full border-separate border-spacing-0 text-200">
            <thead><tr>
              <th scope="col" className={thc}>Loan ID</th><th scope="col" className={thc}>Bid Method</th><th scope="col" className={cn(thc, 'text-right')}>Hurdle NPL Override</th>
            </tr></thead>
            <tbody>
              {overrides.map((l) => (
                <tr key={l.row} className="hover:bg-hover">
                  <td className={tdc}>
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => editing.onOpenLoan(l.row)}>{text(l, 'Loan ID')}</button>
                  </td>
                  <td className={tdc}>{text(l, 'Bid Method')}</td>
                  <td className={cn(tdc, 'text-right tabular-nums')}>{l.values.CC !== defaultHurdle ? pbiFormat(l.values.CC, '0.00') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="py-600 text-center text-300 text-muted-foreground">No loan-level overrides in the model.</p>}
      </VisualFrame>
    </div>
  );
}

// ---------- page registry ----------

export type PageId =
  | 'home' | 'bidSummary' | 'stratification' | 'exits' | 'mix' | 'loanDetail' | 'assumptions' | 'edit_fields' | 'constraints'
  | 'h-sellerValue' | 'h-sellerUpb' | 'h-totalUpb' | 'h-assetValue' | 'h-assetMm' | 'h-ltv' | 'h-dtv'
  | 'h-monthsDq' | 'h-seasoned' | 'h-rate' | 'h-pi' | 'h-origYear' | 'h-payersYtm';

export interface PageDef {
  id: PageId;
  title: string;
  group: 'main' | 'distributions';
  filterGroup: 'home' | 'analysis' | 'none';
  render: (p: PageProps) => ReactNode;
}

const hist = (id: PageId, def: HistogramDef, title = def.title, combined?: 'upb' | 'assetMm'): PageDef =>
  ({ id, title, group: 'distributions', filterGroup: 'home', render: (p) => <HistogramPage {...p} def={def} combined={combined} /> });

/** Pages in the report's order. */
export const PAGES: PageDef[] = [
  { id: 'home', title: 'Home Page', group: 'main', filterGroup: 'home', render: (p) => <HomePage {...p} /> },
  hist('h-sellerValue', HISTOGRAMS.sellerValue),
  hist('h-sellerUpb', HISTOGRAMS.sellerValue, 'Seller Value & Total UPB Distribution', 'upb'),
  hist('h-totalUpb', HISTOGRAMS.totalUpb),
  hist('h-assetValue', HISTOGRAMS.assetValue),
  hist('h-assetMm', HISTOGRAMS.assetValue, 'Asset Value Distribution ($mm)', 'assetMm'),
  hist('h-ltv', HISTOGRAMS.ltv),
  hist('h-dtv', HISTOGRAMS.dtv),
  hist('h-monthsDq', HISTOGRAMS.monthsDq),
  hist('h-seasoned', HISTOGRAMS.seasoned),
  hist('h-rate', HISTOGRAMS.rate),
  hist('h-pi', HISTOGRAMS.pi),
  hist('h-origYear', HISTOGRAMS.origYear),
  hist('h-payersYtm', HISTOGRAMS.payersYtm),
  { id: 'bidSummary', title: 'Bid Summary', group: 'main', filterGroup: 'analysis', render: (p) => <BidSummaryPage {...p} /> },
  { id: 'stratification', title: 'Pool Stratification', group: 'main', filterGroup: 'analysis', render: (p) => <StratificationPage {...p} /> },
  { id: 'exits', title: 'Exit Scenarios', group: 'main', filterGroup: 'analysis', render: (p) => <ExitsPage {...p} /> },
  { id: 'mix', title: 'Pool Mix & Credit', group: 'main', filterGroup: 'analysis', render: (p) => <MixPage {...p} /> },
  { id: 'loanDetail', title: 'Loan Detail', group: 'main', filterGroup: 'analysis', render: (p) => <LoanDetailPage {...p} /> },
  { id: 'assumptions', title: 'Assumptions', group: 'main', filterGroup: 'none', render: (p) => <AssumptionsPage {...p} /> },
  { id: 'edit_fields', title: 'Edit Fields', group: 'main', filterGroup: 'none', render: (p) => <EditFieldsPage {...p} /> },
  { id: 'constraints', title: 'Constraints', group: 'main', filterGroup: 'none', render: (p) => <ConstraintsPage {...p} /> },
];
