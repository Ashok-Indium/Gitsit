// Constraints: the model constants of one input file (Constraints.BPL_ConstraintValues). Pick the file,
// change any values, then Apply: the model recalculates with them and they are saved for that file.

import { RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CONSTRAINT_FIELDS, CONSTRAINT_GROUPS, constraintText, type ConstraintField } from '@/engine/constraint-fields';
import defaults from '@/engine/generated/constraint-defaults.json';
import type { FileConstants } from '@/store/shared-model';
import { cn } from '@/lib/utils';

import type { PageProps } from './pages';
import { FileSlicer, PageBanner, VisualFrame } from './visuals';

/** The selected file's stored constants and how to apply new ones. */
export interface ConstraintsChoice {
  values: FileConstants;
  /** Why the stored values couldn't be read; applying is held back so they aren't overwritten blind. */
  error: string | null;
  /** Applies the given stored values (by Field_Index) to the selected file; resolves with what happened and whether they were saved. */
  onApply: (values: Map<string, string>) => Promise<{ message: string; saved: boolean }>;
}

const DEFAULTS = defaults as Record<string, string>;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** A stored value ("0.7") as it is typed: percentages as 70, dates as yyyy-mm-dd. */
function editText(f: ConstraintField, stored: string): string {
  if (f.kind === 'date') return stored;
  const n = Number(stored);
  if (!stored || !Number.isFinite(n)) return stored;
  return String(f.kind === 'pct' ? round(n * 100, 8) : n);
}

/** Typed text in the stored form, or null when it isn't a valid value. */
function storedText(f: ConstraintField, text: string): string | null {
  const t = text.trim();
  if (f.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
  const n = Number(t.replace(/[$,%\s]/g, ''));
  if (!t || !Number.isFinite(n)) return null;
  return constraintText(f, f.kind === 'pct' ? n / 100 : n);
}

/** A stored value as the page shows it (70%, -8,900, 2025-10-10). */
function shown(f: ConstraintField, stored: string): string {
  const n = Number(stored);
  if (f.kind === 'date' || !stored || !Number.isFinite(n)) return stored;
  return f.kind === 'pct' ? `${round(n * 100, 6).toLocaleString()}%` : round(n, 8).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

const ghostBtn = 'inline-flex items-center justify-center gap-100 rounded-md border border-visual-border px-300 py-200 text-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const th = 'border-b-2 border-visual-border px-200 py-100 text-left font-bold';
const td = 'border-b border-visual-border/60 px-200 py-100 align-middle';

export function ConstraintsPage({ editing, file, constraints }: PageProps) {
  // Typed values not applied yet, per input file and Field_Index.
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ file: string; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const fileName = file.fileName ?? '';
  const draft = useMemo(() => drafts[fileName] ?? {}, [drafts, fileName]);
  const stored = (f: ConstraintField) => constraints?.values.get(f.index) ?? DEFAULTS[f.index] ?? '';

  // Each typed value: valid (its stored form) or not, and whether it differs from what is stored.
  const edits = useMemo(() => CONSTRAINT_FIELDS.flatMap((f) => {
    const text = draft[f.index];
    if (text === undefined) return [];
    const next = storedText(f, text);
    const current = constraints?.values.get(f.index) ?? DEFAULTS[f.index] ?? '';
    return next === current ? [] : [{ f, next }];
  }), [draft, constraints]);
  const invalid = edits.filter((e) => e.next === null);
  const pending = edits.filter((e): e is { f: ConstraintField; next: string } => e.next !== null);

  const setDraft = (index: string, text: string | undefined) => setDrafts((all) => {
    const mine = { ...(all[fileName] ?? {}) };
    if (text === undefined) delete mine[index];
    else mine[index] = text;
    return { ...all, [fileName]: mine };
  });

  const q = query.trim().toLowerCase();
  const groups = CONSTRAINT_GROUPS.map((g) => ({
    group: g,
    fields: CONSTRAINT_FIELDS.filter((f) => f.group === g && (!q || [f.display, f.index, f.cell].some((s) => s.toLowerCase().includes(q))))
      .sort((a, b) => a.order - b.order),
  })).filter((g) => g.fields.length);
  const fromDefault = CONSTRAINT_FIELDS.filter((f) => stored(f) !== DEFAULTS[f.index]).length;

  const apply = async () => {
    if (!constraints || !pending.length || invalid.length) return;
    setApplying(true);
    try {
      const done = await constraints.onApply(new Map(pending.map((e) => [e.f.index, e.next])));
      // Values that weren't saved stay typed in, so Apply can try again.
      if (done.saved) setDrafts((all) => ({ ...all, [fileName]: {} }));
      setResult({ file: fileName, text: done.message });
    } catch (e) {
      setResult({ file: fileName, text: `Not applied: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setApplying(false);
    }
  };
  const busy = editing.busy || applying;

  return (
    <div className="flex flex-col gap-300 bg-card pb-300">
      <PageBanner title="Constraints" />
      <div className="flex flex-col gap-300 px-300">
        <VisualFrame>
          <div className="flex flex-wrap items-end gap-300">
            <FileSlicer className="w-full sm:w-[457px]" files={file.files} value={file.fileName} onChange={file.onFileChange} disabled={file.busy || applying} />
            <label className="flex min-w-56 flex-1 flex-col gap-100 text-200 font-semibold">
              Find a field
              <span className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-200 top-1/2 icon-size-200 -translate-y-1/2 text-muted-foreground" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Field_Index or cell"
                  className="w-full rounded-md border border-input bg-card py-100 pl-600 pr-200 text-300 font-normal" />
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-200">
              <button type="button" className={ghostBtn} disabled={busy || !Object.keys(draft).length}
                onClick={() => setDrafts((all) => ({ ...all, [fileName]: {} }))}>Discard</button>
              <button type="button" disabled={busy || !constraints || !!constraints.error || !pending.length || invalid.length > 0} onClick={() => void apply()}
                className="inline-flex items-center justify-center rounded-2xl bg-action px-400 py-200 text-300 font-semibold text-action-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {applying ? 'Applying…' : `Apply${pending.length ? ` ${pending.length} change${pending.length === 1 ? '' : 's'}` : ''}`}
              </button>
            </div>
          </div>
          <p aria-live="polite" className="mt-200 text-200 text-muted-foreground">
            {constraints?.error ? <span role="alert" className="text-destructive">Couldn't read the saved values from Constraints.BPL_ConstraintValues ({constraints.error}). The Model sheet's values are shown and Apply is off.</span>
              : invalid.length ? <span className="text-destructive">Fix {invalid.map((e) => e.f.display).join(', ')} before applying.</span>
              : result?.file === fileName ? result.text
                : `${fromDefault} of ${CONSTRAINT_FIELDS.length} fields differ from the Model sheet for this file. Percent fields take percentages (70 = 70%).`}
          </p>
        </VisualFrame>

        <VisualFrame title={`Model constants · ${fileName || 'no input file'}`}>
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-200">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th scope="col" className={th}>Field_Name_Display</th>
                  <th scope="col" className={th}>Field_Index</th>
                  <th scope="col" className={cn(th, 'text-right')}>Value</th>
                  <th scope="col" className={cn(th, 'text-right')}>Model sheet</th>
                  <th scope="col" className={th}>Cell</th>
                </tr>
              </thead>
              {groups.map(({ group, fields }) => (
                <tbody key={group}>
                  <tr><th scope="colgroup" colSpan={5} className="bg-muted px-200 py-100 text-left text-200 font-bold text-title">{group}</th></tr>
                  {fields.map((f) => {
                    const current = stored(f);
                    const text = draft[f.index] ?? editText(f, current);
                    const next = draft[f.index] === undefined ? current : storedText(f, text);
                    const bad = next === null;
                    const changed = !bad && next !== current;
                    const differs = current !== DEFAULTS[f.index];
                    return (
                      <tr key={f.index} className="hover:bg-hover">
                        <th scope="row" className={cn(td, 'text-left font-normal')}>
                          <label htmlFor={`constraint-${f.index}`}>{f.display}</label>
                        </th>
                        <td className={cn(td, 'font-monospace text-muted-foreground')}>{f.index}</td>
                        <td className={cn(td, 'text-right')}>
                          <span className="inline-flex items-center gap-100">
                            <input id={`constraint-${f.index}`} type={f.kind === 'date' ? 'date' : 'text'} inputMode={f.kind === 'date' ? undefined : 'decimal'}
                              value={text} disabled={busy} aria-invalid={bad || undefined}
                              onChange={(e) => setDraft(f.index, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Escape') setDraft(f.index, undefined); }}
                              className={cn('w-36 rounded-md border bg-card px-200 py-100 text-right tabular-nums',
                                bad ? 'border-destructive' : 'border-input', changed && 'bg-override text-override-foreground',
                                !changed && differs && 'font-semibold')} />
                            <span aria-hidden className="w-200 text-left text-muted-foreground">{f.kind === 'pct' ? '%' : ''}</span>
                            <button type="button" aria-label={`Set ${f.display} back to the Model sheet's value`} title="Model sheet value"
                              disabled={busy || (next === DEFAULTS[f.index] && !bad)}
                              onClick={() => setDraft(f.index, editText(f, DEFAULTS[f.index] ?? ''))}
                              className="rounded-sm p-100 text-muted-foreground hover:bg-accent disabled:invisible">
                              <RotateCcw className="icon-size-200" />
                            </button>
                          </span>
                        </td>
                        <td className={cn(td, 'text-right tabular-nums text-muted-foreground')}>{shown(f, DEFAULTS[f.index] ?? '')}</td>
                        <td className={cn(td, 'font-monospace text-muted-foreground')}>Model!{f.cell}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
            {!groups.length && <p className="py-600 text-center text-300 text-muted-foreground">No field matches “{query}”.</p>}
          </div>
        </VisualFrame>
      </div>
    </div>
  );
}
