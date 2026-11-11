import { BarChart3, ChevronDown, Cloud, CloudOff, Download, History, Loader2, Moon, RefreshCw, RotateCcw, Sun, X } from 'lucide-react';
import { useContext, useMemo, useState } from 'react';

import { LoanDetail } from '@/components/loan-detail';
import { CONSTRAINT_BY_INDEX, constraintCell } from '@/engine/constraint-fields';
import { FIELD_BY_COL } from '@/engine/model-schema';
import type { Constants, Override } from '@/engine/protocol';
import { useModelEngine } from '@/engine/use-model-engine';
import { AuthContext } from '@/hooks/auth.context';
import { useTheme } from '@/hooks/theme.context';
import { displayName, type ConstraintEdit } from '@/store/shared-model';
import { FABRIC_SOURCE, useInputLoans } from '@/store/use-input-loans';
import { useSharedModel, type StoreStatus } from '@/store/use-shared-model';
import { exportToExcel } from '@/lib/export-excel';
import { cn } from '@/lib/utils';
import { pbiFormat } from '@/report/format';
import type { ConstraintsChoice } from '@/report/constraints';
import { PAGES, type Filters, type PageId } from '@/report/pages';
import type { Editing } from '@/report/tables';

const navItem = 'flex w-full items-center gap-200 rounded-md px-300 py-200 text-left text-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Whether changes have reached the Fabric tables. */
function SaveStatus({ status }: { status: StoreStatus }) {
  if (status.state === 'error') {
    return (
      <p role="alert" className="flex items-start gap-200 text-200 text-destructive">
        <CloudOff className="mt-100-nudge icon-size-200 shrink-0" /> Not saved to Fabric: {status.message}
      </p>
    );
  }
  return (
    <p aria-live="polite" className="flex items-center gap-200 text-200 text-muted-foreground">
      {status.state === 'saved' ? <Cloud className="icon-size-200" /> : <Loader2 className="icon-size-200 animate-spin" />}
      {status.state === 'loading' ? 'Loading saved changes…'
        : status.state === 'saving' ? 'Saving to Fabric…'
          : `Saved to Fabric at ${status.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
    </p>
  );
}

/** The input file this viewer last chose (a convenience; the files themselves are in Input_table). */
const FILE_CHOICE_KEY = 'gitsit.inputFile';
function rememberedFile(): string | null {
  try { return localStorage.getItem(FILE_CHOICE_KEY); } catch { return null; }
}

function App() {
  const email = useContext(AuthContext)?.session?.user?.email ?? null;
  const [fileChoice, setFileChoice] = useState<string | null>(rememberedFile);
  const loans = useInputLoans(fileChoice);
  const engine = useModelEngine(loans.input);
  const { isDark, toggleTheme } = useTheme();
  const fromFabric = loans.input?.source === FABRIC_SOURCE;
  const user = useMemo(() => (email && fromFabric ? { email, name: displayName(email) } : null), [email, fromFabric]);
  const shared = useSharedModel(engine, user, loans.error ? "The input loans couldn't be read from Fabric, so changes aren't saved."
    : loans.lookupError ? "The lookup tables couldn't be read from Fabric, so changes aren't saved." : undefined, loans.fileName);
  const { snapshot, status, info } = engine;
  // Hold edits until everyone's saved changes have been replayed.
  const busy = status === 'busy' || status === 'loading' || shared.status.state === 'loading';
  const [pageId, setPageId] = useState<PageId>('home');
  const [distOpen, setDistOpen] = useState(false);
  const [filters, setFilters] = useState<Record<'home' | 'analysis', Filters>>({ home: {}, analysis: {} });
  const [openLoan, setOpenLoan] = useState<number | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [exporting, setExporting] = useState(false);

  const chooseFile = (name: string) => {
    if (name === loans.fileName) return;
    setFileChoice(name);
    // Another file's loans: its pools and states differ, so start with no filters.
    setFilters({ home: {}, analysis: {} });
    try { localStorage.setItem(FILE_CHOICE_KEY, name); } catch { /* remembered for this visit only */ }
  };
  const filePicker = (id: string) => (
    <>
      <label className="sr-only" htmlFor={id}>Input file</label>
      <select id={id} value={loans.fileName ?? ''} disabled={!loans.files.length || busy} onChange={(e) => chooseFile(e.target.value)}
        className="w-full min-w-0 rounded-md border border-input bg-card px-200 py-100 text-200">
        {loans.files.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.loans} loans)</option>)}
      </select>
    </>
  );

  const page = PAGES.find((p) => p.id === pageId)!;
  const overrides = useMemo(
    () => new Map<string, Override>((snapshot?.overrides ?? []).map((o) => [`${o.col}${o.row}`, o])),
    [snapshot],
  );
  const idByRow = useMemo(() => new Map((snapshot?.loans ?? []).map((l) => [l.row, String(l.values.A ?? '')])), [snapshot]);
  const editing: Editing = {
    overrides, busy,
    onCommit: (row, col, value) => void shared.commit([{ row, col, value }]),
    onReset: (row, col) => void shared.reset([{ row, col }]),
    onCommitMany: shared.commit,
    onResetMany: shared.reset,
    onOpenLoan: setOpenLoan,
  };
  const constraints: ConstraintsChoice = {
    values: loans.constants,
    error: loans.constraintsError,
    // The model recalculates with the new values at once; they are saved to Constraints.BPL_ConstraintValues
    // and logged in Constraints.BPL_ConstraintChanges.
    onApply: async (values) => {
      const file = loans.fileName;
      if (!file) throw new Error('No input file is selected.');
      const cells: Constants = {};
      const entries: ConstraintEdit[] = [];
      for (const [index, value] of values) {
        const f = CONSTRAINT_BY_INDEX.get(index);
        const cell = f ? constraintCell(f, value) : null;
        if (!f || cell === null) continue;
        cells[f.cell] = cell;
        if (user) entries.push({ File_Name: file, Field_Index: index, Field_Name_Display: f.display, New_Value: value });
      }
      const n = Object.keys(cells).length;
      const done = await shared.applyConstants(cells, entries);
      if (!done.applied) throw new Error("the model couldn't recalculate with them");
      if (done.saved) loans.rememberConstants(file, new Map(entries.map((e) => [e.Field_Index, e.New_Value])));
      const what = `Applied ${n} change${n === 1 ? '' : 's'} to ${file}; the model has recalculated.`;
      const why = done.error ?? (shared.status.state === 'error' ? shared.status.message : 'not signed in');
      return { saved: done.saved, message: done.saved ? `${what} Saved for this file in Fabric.` : `${what} Not saved to Fabric (${why}); Apply again to retry.` };
    },
  };
  const loan = snapshot?.loans.find((l) => l.row === openLoan) ?? null;
  const fg = page.filterGroup === 'none' ? 'analysis' : page.filterGroup;

  const go = (id: PageId) => { setPageId(id); window.scrollTo(0, 0); };
  const onExport = async () => {
    if (!snapshot || !info) return;
    setExporting(true);
    try { await exportToExcel(snapshot, info.sourceTape); } finally { setExporting(false); }
  };

  const main = PAGES.filter((p) => p.group === 'main');
  const dists = PAGES.filter((p) => p.group === 'distributions');

  return (
    <div className="flex min-h-full bg-canvas">
      <nav aria-label="Report pages" className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-visual-border bg-card lg:flex">
        <div className="border-b border-visual-border px-400 py-300">
          <p className="text-200 font-semibold uppercase tracking-wider text-muted-foreground">GITSIT</p>
          <p className="text-400 font-bold text-title">Bid Model Dashboard</p>
          <div className="mt-200">{filePicker('file-picker')}</div>
        </div>
        <ul className="flex-1 overflow-y-auto p-200">
          <li>
            <button type="button" aria-current={pageId === 'home' ? 'page' : undefined} onClick={() => go('home')}
              className={cn(navItem, pageId === 'home' ? 'bg-tab-active text-tab-active-foreground' : 'hover:bg-accent')}>Home Page</button>
          </li>
          <li>
            <button type="button" aria-current={pageId === 'homepage2' ? 'page' : undefined} onClick={() => go('homepage2')}
              className={cn(navItem, pageId === 'homepage2' ? 'bg-tab-active text-tab-active-foreground' : 'hover:bg-accent')}>homepage2</button>
          </li>
          <li>
            <button type="button" aria-expanded={distOpen || page.group === 'distributions'} onClick={() => setDistOpen((o) => !o)}
              className={cn(navItem, 'hover:bg-accent')}>
              <BarChart3 className="icon-size-200 text-muted-foreground" /> Distributions
              <ChevronDown className={cn('ml-auto icon-size-200 transition-transform', (distOpen || page.group === 'distributions') && 'rotate-180')} />
            </button>
            {(distOpen || page.group === 'distributions') && (
              <ul className="ml-300 border-l border-visual-border pl-100">
                {dists.map((p) => (
                  <li key={p.id}>
                    <button type="button" aria-current={pageId === p.id ? 'page' : undefined} onClick={() => go(p.id)}
                      className={cn(navItem, 'py-100 text-200', pageId === p.id ? 'bg-tab-active text-tab-active-foreground' : 'hover:bg-accent')}>{p.title}</button>
                  </li>
                ))}
              </ul>
            )}
          </li>
          {main.filter((p) => p.id !== 'home' && p.id !== 'homepage2').map((p) => (
            <li key={p.id}>
              <button type="button" aria-current={pageId === p.id ? 'page' : undefined} onClick={() => go(p.id)}
                className={cn(navItem, pageId === p.id ? 'bg-tab-active text-tab-active-foreground' : 'hover:bg-accent')}>{p.title}</button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-200 border-t border-visual-border p-300">
          <p aria-live="polite" className="flex items-center gap-200 text-200 text-muted-foreground">
            {busy ? <><Loader2 className="icon-size-200 animate-spin" /> {status === 'loading' ? 'Loading the model…' : 'Recalculating…'}</>
              : snapshot ? `Recalculated in ${snapshot.recalcMs} ms` : null}
          </p>
          <SaveStatus status={shared.status} />
          <button type="button" onClick={() => setShowChanges(true)} disabled={!snapshot}
            className={cn(navItem, 'border border-visual-border px-200', overrides.size ? 'bg-override text-override-foreground' : 'hover:bg-accent')}>
            <History className="icon-size-200" /> Your changes ({overrides.size})
          </button>
          <div className="flex gap-200">
            <button type="button" disabled={busy || !overrides.size} onClick={() => void shared.resetAll()}
              className="inline-flex flex-1 items-center justify-center gap-100 rounded-md border border-visual-border px-200 py-200 text-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <RotateCcw className="icon-size-200" /> Reset all
            </button>
            <button type="button" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}
              className="rounded-md border border-visual-border p-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {isDark ? <Sun className="icon-size-200" /> : <Moon className="icon-size-200" />}
            </button>
          </div>
          <button type="button" disabled={busy || exporting || !snapshot} onClick={() => void onExport()}
            className="inline-flex items-center justify-center gap-200 rounded-md bg-primary px-300 py-200 text-300 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {exporting ? <Loader2 className="icon-size-200 animate-spin" /> : <Download className="icon-size-200" />} Export to Excel
          </button>
          {info && <p className="text-100 text-muted-foreground">{info.sourceTape} → {info.sourceModel}</p>}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Narrow screens: page picker instead of the navigation pane. */}
        <div className="flex flex-wrap items-center gap-200 border-b border-visual-border bg-card p-200 lg:hidden">
          <div className="w-full">{filePicker('file-picker-narrow')}</div>
          <label className="sr-only" htmlFor="page-picker">Report page</label>
          <select id="page-picker" value={pageId} onChange={(e) => go(e.target.value as PageId)}
            className="min-w-0 flex-1 rounded-md border border-input bg-card px-200 py-100 text-300">
            {PAGES.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button type="button" onClick={() => setShowChanges(true)} className="rounded-md border border-visual-border px-200 py-100 text-200">
            Changes ({overrides.size})
          </button>
        </div>

        <main className="mx-auto w-full max-w-[1280px] flex-1">
          {engine.error && (
            <div role="alert" className="m-300 rounded-lg border border-destructive bg-card p-400 text-300 text-destructive">
              {status === 'error' ? "The model couldn't be loaded: " : "That change couldn't be applied: "}{engine.error}
            </div>
          )}
          {loans.updated && (
            <div role="status" className="m-300 flex flex-wrap items-center justify-between gap-300 rounded-lg border border-action bg-card p-400 text-300">
              <span>New input files, lookup data or constraints have arrived in Fabric. Reload to recalculate with them.</span>
              <button type="button" onClick={() => window.location.reload()}
                className="inline-flex items-center gap-200 rounded-2xl bg-action px-400 py-200 font-semibold text-action-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <RefreshCw className="icon-size-200" /> Reload
              </button>
            </div>
          )}
          {loans.error && (
            <div role="alert" className="m-300 rounded-lg border border-destructive bg-card p-400 text-300 text-destructive">
              Couldn't read the input loans from Fabric ({loans.error}). Showing the input file bundled with the app instead.
            </div>
          )}
          {loans.lookupError && (
            <div role="alert" className="m-300 rounded-lg border border-destructive bg-card p-400 text-300 text-destructive">
              Couldn't read the lookup tables from Fabric ({loans.lookupError}). Calculating with the workbook's own lookup values instead.
            </div>
          )}
          {!!info?.dropped.length && (
            <div role="alert" className="m-300 rounded-lg border border-destructive bg-card p-400 text-300 text-destructive">
              Input_table has {info.capacity + info.dropped.length} loans but the model holds {info.capacity}, so these are not included: {info.dropped.join(', ')}.
            </div>
          )}
          {shared.status.state === 'error' && (
            <div className="m-300 rounded-lg border border-destructive bg-card p-400 text-300 text-destructive lg:hidden">
              Changes aren't being saved to Fabric: {shared.status.message}
            </div>
          )}
          {snapshot ? (
            page.render({
              snapshot, editing, navigate: go,
              filters: filters[fg],
              setFilters: (f) => setFilters((all) => ({ ...all, [fg]: f })),
              file: { files: loans.files, fileName: loans.fileName, onFileChange: chooseFile, busy },
              constraints,
            })
          ) : status !== 'error' && (
            <div className="flex flex-col gap-300 p-300" aria-label="Loading the model">
              <h1 className="sr-only">Pacific Private Money</h1>
              <div className="h-[77px] animate-pulse rounded-md bg-banner/80" />
              <div className="h-64 animate-pulse rounded-lg bg-card" />
              <p className="text-center text-300 text-muted-foreground">Loading the model…</p>
            </div>
          )}
        </main>
      </div>

      {(loan || showChanges) && (
        <div className="fixed inset-0 z-40 flex justify-end bg-foreground/20" onClick={() => { setOpenLoan(null); setShowChanges(false); }}>
          <div className="h-full w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            {loan ? (
              <LoanDetail loan={loan} overrides={overrides} busy={busy} onClose={() => setOpenLoan(null)}
                onCommit={editing.onCommit} onReset={editing.onReset} />
            ) : (
              <aside aria-label="Your changes" className="flex h-full flex-col border-l border-visual-border bg-card shadow-xl">
                <header className="flex items-center justify-between border-b border-visual-border p-400">
                  <h2 className="text-500 font-bold text-title">Your changes</h2>
                  <button type="button" aria-label="Close" onClick={() => setShowChanges(false)} className="rounded-md p-100 hover:bg-accent">
                    <X className="icon-size-300" />
                  </button>
                </header>
                {overrides.size ? (
                  <ul className="flex flex-1 flex-col gap-200 overflow-y-auto p-400 text-300">
                    {[...overrides.values()].map((o) => {
                      const f = FIELD_BY_COL[o.col];
                      return (
                        <li key={`${o.col}${o.row}`} className="flex items-center gap-200 rounded-md bg-override px-300 py-200 text-override-foreground">
                          <div className="min-w-0 flex-1">
                            <button type="button" className="font-semibold hover:underline" onClick={() => { setShowChanges(false); setOpenLoan(o.row); }}>
                              {idByRow.get(o.row)}
                            </button>
                            <p className="truncate text-200">{f.label} · Model!{o.col}{o.row}</p>
                          </div>
                          <span className="whitespace-nowrap tabular-nums">{pbiFormat(o.modelValue, f.fmt) || '–'} → {pbiFormat(o.value, f.fmt)}</span>
                          <button type="button" aria-label={`Reset ${f.label} for loan ${idByRow.get(o.row)}`} disabled={busy}
                            className="rounded-sm p-100 hover:bg-background/40" onClick={() => void shared.reset([{ row: o.row, col: o.col }])}>
                            <RotateCcw className="icon-size-200" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="p-400 text-300 text-muted-foreground">
                    No overrides yet. Click a value in any column marked with a pencil (or open a loan) to change it;
                    every dependent calculation in the model updates.
                  </p>
                )}
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
