// Input files uploaded from the app: the uploadFile function saves each into the Lakehouse folder
// gitsit_files/Files/input, whose arrival starts the loader pipeline, and records it in
// dbo.Upload_status; the loader notebook moves it to Running, then Completed or Failed.

import { useCallback, useEffect, useState } from 'react';

import { getRayfinClient } from '@/lib/rayfin-client';

export type UploadState = 'Waiting' | 'Running' | 'Completed' | 'Failed';

export interface Upload {
  id: number;
  /** The file's name as uploaded (with .xlsx). */
  sourceFile: string;
  /** The name it was loaded as, with the load date (once Completed). */
  fileName: string | null;
  status: UploadState;
  loans: number | null;
  message: string | null;
  uploadedBy: string | null;
  uploadedOn: Date;
  updatedOn: Date;
}

/** The largest file the uploadFile function takes. */
export const MAX_UPLOAD_MB = 4;

/** Why a file can't be uploaded: not an Excel workbook, no NPL_/BPL_ file type, too large … */
export type UploadProblem = 'format' | 'type' | 'name' | 'size' | 'empty';

/** What's wrong with a file, or null when it can be uploaded: an NPL_ or BPL_ .xlsx workbook. */
export function uploadProblem(file: File): UploadProblem | null {
  if (!/\.xlsx$/i.test(file.name)) return 'format';
  if (!/^(NPL|BPL)_/i.test(file.name)) return 'type';
  if (/[/\\:*?"<>|]/.test(file.name)) return 'name';
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return 'size';
  if (!file.size) return 'empty';
  return null;
}

const STATES: UploadState[] = ['Waiting', 'Running', 'Completed', 'Failed'];
export const isActive = (u: Upload) => u.status === 'Waiting' || u.status === 'Running';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** How often the list is read again: often while a file is being loaded, rarely otherwise. */
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 60000;

/**
 * The latest uploads (newest first), read again every few seconds while any is Waiting or Running.
 * `upload` sends files one at a time; it resolves with the files that couldn't be sent and why.
 */
export function useUploads(enabled: boolean) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the list was last read (ms), the "now" its ages are judged against. */
  const [readAt, setReadAt] = useState(0);
  // Bumped to read at once (after an upload, or the Refresh button) instead of at the next poll.
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    async function read() {
      let next = IDLE_POLL_MS;
      try {
        const rows = await (await getRayfinClient()).functions.uploadStatus.invoke();
        if (stopped) return;
        const list = rows.map((r): Upload => ({
          id: r.Upload_Id, sourceFile: r.Source_File, fileName: r.File_Name,
          status: STATES.includes(r.Status as UploadState) ? (r.Status as UploadState) : 'Waiting',
          loans: r.Loans, message: r.Message, uploadedBy: r.Uploaded_By,
          uploadedOn: new Date(r.Uploaded_On), updatedOn: new Date(r.Updated_On),
        }));
        setUploads(list);
        setError(null);
        if (list.some(isActive)) next = ACTIVE_POLL_MS;
      } catch (e) {
        if (stopped) return;
        setError(message(e));
      }
      setLoaded(true);
      setReadAt(Date.now());
      timer = window.setTimeout(() => void read(), next);
    }
    void read();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, asked]);

  const upload = useCallback(async (files: File[], userMail: string) => {
    const failed: { name: string; error: string }[] = [];
    const client = await getRayfinClient();
    for (const file of files) {
      try {
        await client.functions.uploadFile.invoke({ fileName: file.name, content: await base64(file), userMail });
      } catch (e) {
        failed.push({ name: file.name, error: message(e) });
      }
      // Each upload shows as Waiting as soon as it is saved.
      refresh();
    }
    return failed;
  }, [refresh]);

  return { uploads, loaded, error, readAt, refresh, upload };
}

export type Uploads = ReturnType<typeof useUploads>;
