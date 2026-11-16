// Upload Files: send NPL_/BPL_ input workbooks to the Lakehouse folder the loader pipeline watches,
// and follow each one from Waiting to Running to Completed (loaded into the app) or Failed. Also the
// Home page's button to it, which shows how the latest uploads are going.

import { AlertTriangle, CheckCircle2, Clock, FileSpreadsheet, Loader2, RefreshCw, Upload as UploadIcon, XCircle } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { fileTypeOf } from '@/store/file-type';
import { isActive, MAX_UPLOAD_MB, uploadProblem, type Upload, type UploadState, type Uploads } from '@/store/use-uploads';

import { PageBanner, VisualFrame } from './visuals';

const btn = 'inline-flex items-center justify-center gap-100 rounded-md px-300 py-200 text-300 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const PILL: Record<UploadState, { cls: string; icon: ReactNode; label: string }> = {
  Waiting: { cls: 'bg-status-waiting text-status-waiting-foreground', icon: <Clock className="icon-size-200" />, label: 'Waiting' },
  Running: { cls: 'bg-status-running text-status-running-foreground', icon: <Loader2 className="icon-size-200 animate-spin" />, label: 'Running' },
  Completed: { cls: 'bg-status-done text-status-done-foreground', icon: <CheckCircle2 className="icon-size-200" />, label: 'Completed' },
  Failed: { cls: 'bg-status-failed text-status-failed-foreground', icon: <XCircle className="icon-size-200" />, label: 'Failed' },
};

export function StatusPill({ status, children }: { status: UploadState; children?: ReactNode }) {
  const p = PILL[status];
  return (
    <span className={cn('inline-flex items-center gap-100 whitespace-nowrap rounded-2xl px-200 py-100-nudge text-200 font-semibold', p.cls)}>
      {p.icon} {children ?? p.label}
    </span>
  );
}

/** A Waiting file the pipeline hasn't picked up in this long gets a hint (it also runs hourly). */
const SLOW_MS = 15 * 60 * 1000;
/** How long a finished upload keeps showing on the Home page's button. */
const RECENT_MS = 30 * 60 * 1000;

const when = (d: Date) => d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function details(u: Upload, now: number): ReactNode {
  if (u.status === 'Waiting') {
    return now - u.updatedOn.getTime() > SLOW_MS
      ? 'Not picked up yet. The pipeline also runs every hour; check its runs in Fabric if this stays.'
      : 'Saved to the Lakehouse; the pipeline is starting (usually 1–3 minutes).';
  }
  if (u.status === 'Running') return 'Loading the loans into the database…';
  return u.message;
}

/** The Home page's way here: the button, with how the latest uploads are going. */
export function UploadFilesButton({ uploads, now, onClick }: {
  uploads: Upload[];
  /** When they were read (ms): finished uploads show for a while after. */
  now: number;
  onClick: () => void;
}) {
  const active = uploads.filter(isActive).length;
  const recent = uploads.filter((u) => now - u.updatedOn.getTime() < RECENT_MS);
  const failed = recent.filter((u) => u.status === 'Failed').length;
  const done = recent.filter((u) => u.status === 'Completed').length;
  return (
    <button type="button" onClick={onClick}
      className={cn(btn, 'mb-100 border border-action bg-card text-action hover:bg-action hover:text-action-foreground')}>
      <UploadIcon className="icon-size-200" /> Upload files
      {active > 0 ? <StatusPill status="Running">{active} running</StatusPill>
        : failed > 0 ? <StatusPill status="Failed">{failed} failed</StatusPill>
          : done > 0 ? <StatusPill status="Completed" /> : null}
    </button>
  );
}

export function UploadPage({ uploads, email, loadedFiles, onOpen }: {
  uploads: Uploads;
  /** The signed-in user (uploads need a Fabric sign-in). */
  email: string | null;
  /** The files the app has loaded, which can be opened on the Home page. */
  loadedFiles: Set<string>;
  onOpen: (fileName: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const now = uploads.readAt;
  const busy = sending.length > 0;

  const send = async (list: File[]) => {
    if (!email || busy || !list.length) return;
    const bad = list.flatMap((f) => { const p = uploadProblem(f); return p ? [`${f.name} ${p}.`] : []; });
    const good = list.filter((f) => !uploadProblem(f));
    setProblems(bad);
    if (!good.length) return;
    setSending(good.map((f) => f.name));
    try {
      const failed = await uploads.upload(good, email);
      setProblems([...bad, ...failed.map((f) => `${f.name} wasn't uploaded: ${f.error}`)]);
    } finally {
      setSending([]);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void send([...e.dataTransfer.files]);
  };

  return (
    <div className="flex flex-col gap-300 bg-card pb-300">
      <PageBanner title="Upload Files" />
      <div className="flex flex-col gap-300 px-300">
        <VisualFrame title="Upload input files">
          <div onDragOver={(e) => { e.preventDefault(); if (email && !busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
            className={cn('flex flex-col items-center gap-300 rounded-lg border-2 border-dashed px-400 py-600 text-center transition-colors',
              dragging ? 'border-action bg-action/10' : 'border-visual-border')}>
            <FileSpreadsheet aria-hidden className="icon-size-600 text-muted-foreground" />
            <div className="flex flex-col gap-100">
              <p className="text-400 font-semibold text-title">Drag Excel files here, or choose them</p>
              <p className="text-200 text-muted-foreground">
                .xlsx workbooks up to {MAX_UPLOAD_MB} MB, named NPL_… or BPL_… (the start of the name picks the NPL or BPL lookup tables).
                Each file is loaded under its name with today's date, e.g. BPL_Pacific Private Money_11_16_2026.
              </p>
            </div>
            <input ref={input} type="file" accept=".xlsx" multiple className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => { void send([...(e.target.files ?? [])]); e.target.value = ''; }} />
            <button type="button" disabled={!email || busy} onClick={() => input.current?.click()}
              className={cn(btn, 'rounded-2xl bg-action text-action-foreground hover:brightness-110')}>
              {busy ? <Loader2 className="icon-size-200 animate-spin" /> : <UploadIcon className="icon-size-200" />}
              {busy ? `Uploading ${sending.join(', ')}…` : 'Choose files'}
            </button>
            {!email && <p role="alert" className="text-200 text-destructive">Sign in to Fabric to upload files.</p>}
          </div>
          {problems.length > 0 && (
            <div role="alert" className="mt-300 flex gap-200 rounded-md border border-destructive/40 bg-destructive/10 p-300 text-200">
              <AlertTriangle className="icon-size-200 shrink-0 text-destructive" />
              <ul className="flex flex-col gap-100">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </VisualFrame>

        <VisualFrame title="Upload status" actions={
          <button type="button" onClick={() => uploads.refresh()} aria-label="Refresh upload status"
            className="rounded-md p-100 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RefreshCw className="icon-size-200" />
          </button>
        }>
          <p className="mb-200 text-200 text-muted-foreground">
            Updates every few seconds while a file is loading. You also get an email when each file is loaded or fails.
          </p>
          {uploads.error && <p role="alert" className="mb-200 text-200 text-destructive">Couldn't read the upload status: {uploads.error}</p>}
          {!uploads.loaded ? (
            <p className="flex items-center gap-200 text-300 text-muted-foreground"><Loader2 className="icon-size-200 animate-spin" /> Reading the upload status…</p>
          ) : !uploads.uploads.length ? (
            <p className="text-300 text-muted-foreground">No files uploaded yet.</p>
          ) : (
            <div className="max-h-[calc(100vh-420px)] min-h-48 overflow-auto rounded-md border border-visual-border">
              <table className="w-full border-collapse text-left text-200">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-visual-border text-muted-foreground">
                    {['File', 'Type', 'Uploaded', 'Status', 'Loaded as', 'Loans', 'Details'].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-200 py-200 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody aria-live="polite">
                  {uploads.uploads.map((u) => (
                    <tr key={u.id} className="border-b border-visual-border align-top last:border-0">
                      <td className="max-w-64 px-200 py-200 font-semibold break-words">{u.sourceFile}</td>
                      <td className="px-200 py-200">{fileTypeOf(u.sourceFile)}</td>
                      <td className="whitespace-nowrap px-200 py-200">
                        {when(u.uploadedOn)}
                        <span className="block text-100 text-muted-foreground">{u.uploadedBy ?? 'Added in the Lakehouse'}</span>
                      </td>
                      <td className="px-200 py-200"><StatusPill status={u.status} /></td>
                      <td className="px-200 py-200">
                        {u.fileName && (
                          <div className="flex flex-col items-start gap-100">
                            <span className="break-words">{u.fileName}</span>
                            {u.status === 'Completed' && (loadedFiles.has(u.fileName) ? (
                              <button type="button" onClick={() => onOpen(u.fileName!)} className="font-semibold text-action hover:underline">Open in Home</button>
                            ) : (
                              <button type="button" onClick={() => window.location.reload()} className="font-semibold text-action hover:underline">Reload the app to open it</button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-200 py-200 tabular-nums">{u.loans ?? ''}</td>
                      <td className={cn('max-w-96 px-200 py-200 break-words', u.status === 'Failed' ? 'text-destructive' : 'text-muted-foreground')}>
                        {details(u, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </VisualFrame>
      </div>
    </div>
  );
}
