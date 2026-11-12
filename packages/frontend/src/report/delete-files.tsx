// Delete files: the Home page button that removes input files from the app and from every Fabric
// table holding them (their loans, model rows, change logs, load record and constants).

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import type { InputFileOption } from './visuals';

const btn = 'inline-flex items-center justify-center gap-100 rounded-md px-300 py-200 text-300 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** What the Fabric tables lose for each deleted file. */
const REMOVED = [
  'its loans (Input_table)',
  'its calculated model (Loan_Model and Loan_Model_Monthly)',
  'its loan changes (LoanChanges)',
  'its load record (Input_files)',
  'its constraint values and their history (Constraints schema)',
];

export function DeleteFilesButton({ files, current, disabled, onDelete }: {
  files: InputFileOption[];
  /** The file the model is built from, ticked when the dialog opens. */
  current: string | null;
  disabled?: boolean;
  /** Deletes the files; rejects with why when it couldn't. */
  onDelete: (names: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const start = () => {
    setChosen(current ? [current] : []);
    setError(null);
    setOpen(true);
  };
  const toggle = (name: string) => setChosen((c) => (c.includes(name) ? c.filter((n) => n !== name) : [...c, name]));
  // The app needs loans to show (with none it would load its bundled file again), so one file stays.
  const all = chosen.length >= files.length;
  const loans = files.filter((f) => chosen.includes(f.name)).reduce((s, f) => s + f.loans, 0);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  return (
    <>
      <button type="button" onClick={start} disabled={disabled || files.length < 2}
        title={files.length < 2 ? 'There is only one input file; the app needs at least one.' : 'Delete input files'}
        className={cn(btn, 'mb-100 border border-destructive bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground')}>
        <Trash2 className="icon-size-200" /> Delete files
      </button>
      <dialog ref={dialog} aria-labelledby="delete-files-title" onCancel={(e) => { if (deleting) e.preventDefault(); else setOpen(false); }}
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-lg border border-visual-border bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/40">
        <div className="flex flex-col gap-400 p-500">
          <h2 id="delete-files-title" className="flex items-center gap-200 text-500 font-bold text-title">
            <Trash2 className="icon-size-300 text-destructive" /> Delete input files
          </h2>
          <fieldset className="flex flex-col gap-100">
            <legend className="mb-200 text-300 font-semibold">Choose the files to delete</legend>
            <ul className="flex max-h-64 flex-col gap-100 overflow-y-auto">
              {files.map((f) => (
                <li key={f.name}>
                  <label className="flex cursor-pointer items-center gap-300 rounded-md px-200 py-200 text-300 hover:bg-accent has-checked:bg-destructive/10">
                    <input type="checkbox" checked={chosen.includes(f.name)} onChange={() => toggle(f.name)} disabled={deleting}
                      className="icon-size-200 shrink-0 accent-destructive" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-200 text-muted-foreground">{f.loans} loans</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex gap-200 rounded-md border border-destructive/40 bg-destructive/10 p-300 text-200">
            <AlertTriangle className="icon-size-200 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">This can't be undone. For each file, Fabric loses:</p>
              <ul className="mt-100 list-disc pl-500">{REMOVED.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-100">The uploaded file itself stays in the Lakehouse archive; upload it again to bring it back with default constraints.</p>
            </div>
          </div>
          {all && <p role="alert" className="text-200 text-destructive">Leave at least one file: the app needs loans to show.</p>}
          {error && <p role="alert" className="text-200 text-destructive">Nothing was deleted: {error}</p>}
          <div className="flex flex-wrap justify-end gap-200">
            <button type="button" autoFocus onClick={() => setOpen(false)} disabled={deleting}
              className={cn(btn, 'border border-visual-border font-normal hover:bg-accent')}>Cancel</button>
            <button type="button" onClick={() => void confirm()} disabled={deleting || !chosen.length || all}
              className={cn(btn, 'bg-destructive text-destructive-foreground hover:brightness-110')}>
              {deleting ? <Loader2 className="icon-size-200 animate-spin" /> : <Trash2 className="icon-size-200" />}
              {deleting ? 'Deleting…' : chosen.length
                ? `Delete ${chosen.length} file${chosen.length === 1 ? '' : 's'} (${loans} loans)`
                : 'Delete'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
