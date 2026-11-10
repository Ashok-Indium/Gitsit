import { useEffect, useMemo, useRef, useState } from 'react';

import type { InputRow } from '@/engine/load-input';
import type { Lookups } from '@/engine/lookups';
import type { EngineInput } from '@/engine/use-model-engine';
import { getRayfinClient } from '@/lib/rayfin-client';

import bundledRows from './generated/input-rows.json';
import { FILE_NAME } from './generated/store-fields';
import { inputFiles, inputFingerprint, loadInputRows, loadLookups, lookupsFingerprint, seedInput } from './shared-model';

/** How often the app looks for new input files and lookup changes while it is on screen. */
const CHECK_EVERY_MS = 5 * 60 * 1000;

export const FABRIC_SOURCE = 'Input_table (Fabric SQL)';

export interface InputFile {
  name: string;
  loans: number;
}

export interface InputLoans {
  /** The selected file's loans and the lookup tables to build the model from, once known. */
  input: EngineInput | null;
  /** The input files in Input_table (each File_Name), and the one the model is built from. */
  files: InputFile[];
  fileName: string | null;
  /** Why Fabric's Input_table could not be read (the bundled input file is used instead). */
  error: string | null;
  /** Why the lookup tables could not be read (the workbook's own lookup values are used instead). */
  lookupError: string | null;
  /** Input_table or a lookup table has changed since the app loaded it. */
  updated: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Client = Awaited<ReturnType<typeof getRayfinClient>>;

/**
 * The lookup tables. They are filled from the BPL_ tables in SQL (a trigger copies every edit),
 * so the app only reads them: refilling them here would leave them out of step with BPL_.
 */
const readLookups = (client: Client): Promise<Lookups> => loadLookups(client);

/**
 * Reads every input file's loans from Input_table and the lookup tables when the app opens
 * (filling an empty Input_table from the bundled input file first), then checks for
 * changes every few minutes and on returning to the tab. The model is built from `fileName`'s
 * loans, or the first file when it is not in the table.
 */
export function useInputLoans(fileName: string | null): InputLoans {
  const [rows, setRows] = useState<InputRow[] | null>(null);
  const [lookups, setLookups] = useState<Lookups | undefined>();
  const [fromFabric, setFromFabric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let client: Client;
      let all: InputRow[];
      try {
        client = await getRayfinClient();
        all = await loadInputRows(client);
        if (!all.length) {
          await seedInput(client);
          all = await loadInputRows(client);
        }
      } catch (e) {
        if (cancelled) return;
        setError(message(e));
        setRows((bundledRows as InputRow[]).map((r) => ({ ...r, File_Name: FILE_NAME })));
        return;
      }
      let read: Lookups | undefined;
      try {
        read = await readLookups(client);
      } catch (e) {
        if (!cancelled) setLookupError(message(e));
      }
      if (cancelled) return;
      loaded.current = inputFingerprint(all) + (read ? lookupsFingerprint(read) : '');
      setLookups(read);
      setFromFabric(true);
      setRows(all);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fromFabric || updated) return;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const client = await getRayfinClient();
        const [all, read] = await Promise.all([loadInputRows(client), lookups ? loadLookups(client) : null]);
        if (inputFingerprint(all) + (read ? lookupsFingerprint(read) : '') !== loaded.current) setUpdated(true);
      } catch {
        // A missed check is retried on the next interval.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fromFabric, lookups, updated]);

  const files = useMemo(() => (rows ? inputFiles(rows) : []), [rows]);
  const selected = files.find((f) => f.name === fileName)?.name ?? files.find((f) => f.name === FILE_NAME)?.name ?? files[0]?.name ?? null;
  const input = useMemo<EngineInput | null>(() => (rows && selected
    ? { rows: rows.filter((r) => String(r.File_Name ?? FILE_NAME) === selected), source: fromFabric ? FABRIC_SOURCE : 'Bundled input file (Fabric unavailable)', lookups, fileName: selected }
    : null), [rows, selected, fromFabric, lookups]);

  return { input, files, fileName: selected, error, lookupError, updated };
}
