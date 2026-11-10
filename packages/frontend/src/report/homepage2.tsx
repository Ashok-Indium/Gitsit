// homepage2: the Home page in the GITSIT brand (gitsitusa.com) — GITSIT blue hero with the green
// "g" ring sweeping off its edge, PT Sans headings over Open Sans, the bid at a glance, and the
// same filters, sections and editable loan table as the Home page.

import { ArrowRight, ExternalLink, FilterX } from 'lucide-react';
import { useState } from 'react';

import logo from '@/assets/gitsit-logo.jpg';
import { cn } from '@/lib/utils';

import { pbiAuto, pbiFormat } from './format';
import { applyFilters, LINKS, optionsOf, SECTIONS, sheetSummary, type SectionId } from './home-sections';
import { MEASURES, type MeasureKey } from './measures';
import type { PageProps } from './pages';
import { CashFlowPivot, LoanTable } from './tables';
import { FileSlicer, Slicer } from './visuals';

const KPIS: MeasureKey[] = ['loans', 'upb', 'payoff', 'bpo', 'bid', 'bidUpb'];

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** The open green ring of the GITSIT "g", drawn as decoration. */
function BrandRing({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className={className}>
      <circle cx="100" cy="100" r="78" fill="none" className="stroke-gitsit-green" strokeWidth="24" strokeLinecap="round"
        strokeDasharray="370 120" transform="rotate(-40 100 100)" />
      <circle cx="100" cy="100" r="50" fill="none" className="stroke-on-brand" strokeWidth="2" strokeOpacity="0.2" />
    </svg>
  );
}

export function Homepage2({ snapshot, editing, filters, setFilters, navigate, file }: PageProps) {
  const [section, setSection] = useState<SectionId>('output');
  const s = SECTIONS.find((x) => x.id === section)!;
  const loans = applyFilters(snapshot.loans, filters);
  const filtered = loans.length !== snapshot.loans.length;

  return (
    <div className="min-h-full bg-gitsit-mist pb-800 font-brand">
      {/* Hero */}
      <section className="relative overflow-hidden bg-linear-to-br from-gitsit-blue to-gitsit-navy px-400 pb-[96px] pt-600 text-on-brand md:px-800">
        {/* Kept clear of the KPI row so every figure stays legible. */}
        <BrandRing className="pointer-events-none absolute -right-[110px] -top-[120px] size-[220px] opacity-90 md:-right-[150px] md:-top-[190px] md:size-[400px]" />
        <BrandRing className="pointer-events-none absolute -left-[120px] -top-[130px] size-[240px] opacity-15" />
        <div className="relative mx-auto flex max-w-[1180px] flex-col gap-600">
          <div className="flex flex-wrap items-center gap-300">
            <span className="rounded-2xl bg-on-brand px-300 py-200 shadow-md">
              <img src={logo} alt="GITSIT Solutions" className="h-[34px] w-auto" />
            </span>
            <span className="text-200 font-semibold uppercase tracking-widest text-on-brand/80">Bid Model · Get in touch. Stay in touch.</span>
          </div>
          <div className="flex max-w-[760px] flex-col gap-200">
            <p className="text-300 font-bold uppercase tracking-wider text-gitsit-green">Turning risk into opportunity</p>
            <h1 className="font-brand-heading text-hero-800 font-bold leading-hero-800 md:text-hero-900 md:leading-hero-900">
              {file.fileName ?? 'Bid Model'}
            </h1>
            <p className="text-400 text-on-brand/80">
              {snapshot.loans.length} loans in this file{filtered ? ` · ${loans.length} shown` : ''}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-300 sm:grid-cols-3 xl:grid-cols-6">
            {KPIS.map((k) => {
              const v = MEASURES[k].calc(loans);
              return (
                <div key={k} title={pbiFormat(v, MEASURES[k].fmt)}
                  className="flex flex-col gap-100 rounded-2xl border border-on-brand/15 bg-on-brand/10 px-400 py-300 backdrop-blur-sm">
                  <dt className="text-200 text-on-brand/75">{MEASURES[k].name}</dt>
                  <dd className="font-brand-heading text-600 font-bold leading-600 tabular-nums">{pbiAuto(v, MEASURES[k].fmt)}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      <div className="relative mx-auto -mt-[64px] flex max-w-[1180px] flex-col gap-500 px-400 md:px-800">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-400 rounded-3xl border border-visual-border bg-card p-500 shadow-lg">
          <FileSlicer className="w-full sm:w-[420px]" files={file.files} value={file.fileName} onChange={file.onFileChange} disabled={file.busy} />
          <Slicer label="Pool" className="w-48" options={optionsOf(snapshot.loans, 'Pool')} selected={filters.Pool ?? []}
            onChange={(v) => setFilters({ ...filters, Pool: v })} />
          <button type="button" onClick={() => setFilters({})} disabled={!Object.values(filters).some((v) => v.length)}
            className={cn('inline-flex items-center gap-100 rounded-full px-300 py-200 text-300 font-semibold text-gitsit-green-ink hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40', focus)}>
            <FilterX className="icon-size-200" /> Clear filters
          </button>
          <button type="button" onClick={() => navigate('loanDetail')}
            className={cn('ml-auto inline-flex items-center gap-200 rounded-full bg-gitsit-blue px-500 py-200 text-300 font-semibold text-on-brand shadow-md hover:brightness-110', focus)}>
            Master Table <ArrowRight className="icon-size-200" />
          </button>
        </div>

        {/* Links and sections */}
        <div className="flex flex-wrap items-center justify-between gap-400">
          <nav aria-label="Related reports" className="flex flex-wrap gap-200">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                className={cn('inline-flex items-center gap-200 rounded-full border border-visual-border bg-card px-400 py-200 text-300 font-semibold text-gitsit-slate hover:border-gitsit-green hover:text-gitsit-green-ink', focus)}>
                {l.label}<ExternalLink aria-hidden className="icon-size-100 text-gitsit-green-ink" />
              </a>
            ))}
          </nav>
          <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-100 rounded-full border border-visual-border bg-card p-100">
            {SECTIONS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={section === x.id} onClick={() => setSection(x.id)}
                className={cn('rounded-full px-400 py-200 text-300 font-semibold', focus,
                  section === x.id ? 'bg-gitsit-blue text-on-brand shadow-sm' : 'text-gitsit-slate hover:bg-accent')}>
                {x.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <section className="overflow-hidden rounded-3xl border border-visual-border bg-card shadow-sm">
          <div aria-hidden className="h-100 bg-linear-to-r from-gitsit-green to-gitsit-blue" />
          <header className="flex flex-wrap items-baseline justify-between gap-300 px-500 pt-400">
            <h2 className="font-brand-heading text-500 font-bold text-gitsit-slate">{s.label}</h2>
            <span className="text-200 text-muted-foreground">{loans.length} loans · click a Loan ID for its details, a pencil column to edit</span>
          </header>
          <div className="p-400 pt-300">
            <LoanTable columns={s.columns} loans={loans} editing={editing} maxHeight={'scenario' in s ? 'max-h-[38vh]' : 'max-h-[62vh]'}
              summary={sheetSummary(snapshot, loans.length)} />
          </div>
        </section>

        {'scenario' in s && (
          <section className="overflow-hidden rounded-3xl border border-visual-border bg-card shadow-sm">
            <div aria-hidden className="h-100 bg-linear-to-r from-gitsit-blue to-gitsit-green" />
            <header className="px-500 pt-400">
              <h2 className="font-brand-heading text-500 font-bold text-gitsit-slate">{s.scenario} Cash Flows by Month</h2>
            </header>
            <div className="p-400 pt-300">
              <CashFlowPivot loans={loans} scenario={s.scenario} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
