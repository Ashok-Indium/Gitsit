import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CONSTRAINT_FIELDS, constraintCell } from '@/engine/constraint-fields';
import type { InputRow } from '@/engine/load-input';
import type { Lookups } from '@/engine/lookups';
import type { Constants } from '@/engine/protocol';
import type { EngineInput } from '@/engine/use-model-engine';
import { getRayfinClient } from '@/lib/rayfin-client';

import bundledRows from './generated/input-rows.json';
import { FILE_NAME } from './generated/store-fields';
import {
  constraintsByFile, constraintsFingerprint, inputFiles, inputFingerprint, loadConstraints, loadInputRows, loadLookups, lookupsFingerprint, seedInput,
  type FileConstants,
} from './shared-model';

/** How often the app looks for new input files, lookup and constraint changes while it is on screen. */
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
  /** The selected file's stored model constants (Constraints.BPL_ConstraintValues) by Field_Index. */
  constants: FileConstants;
  /** Records constants this app has just saved for a file, so they are not taken for someone else's change. */
  rememberConstants: (fileName: string, values: FileConstants) => void;
  /** Why the model constants could not be read (every file calculates with the Model sheet's). */
  constraintsError: string | null;
  /** Why Fabric's Input_table could not be read (the bundled input file is used instead). */
  error: string | null;
  /** Why the lookup tables could not be read (the workbook's own lookup values are used instead). */
  lookupError: string | null;
  /** Input_table, a lookup table or a constraint has changed since the app loaded it. */
  updated: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Client = Awaited<ReturnType<typeof getRayfinClient>>;
const NONE: FileConstants = new Map();

/** A file's stored constants as Model cell values; a field without a valid value keeps the workbook's. */
function cellsOf(values: FileConstants | undefined): Constants {
  const out: Constants = {};
  for (const f of CONSTRAINT_FIELDS) {
    const v = constraintCell(f, values?.get(f.index));
    if (v !== null) out[f.cell] = v;
  }
  return out;
}

/**
 * Reads every input file's loans from Input_table, the lookup tables and the model constants when
 * the app opens (filling an empty Input_table from the bundled input file first), then checks for
 * changes every few minutes and on returning to the tab. The model is built from `fileName`'s
 * loans and constants, or the first file's when it is not in the table. The lookups come from
 * LookupCache, which triggers on the BPL_ tables in SQL fill, so the app only reads it; the constants
 * from Constraints.BPL_ConstraintValues, through the app's loadConstraints function.
 */
export function useInputLoans(fileName: string | null): InputLoans {
  const [rows, setRows] = useState<InputRow[] | null>(null);
  const [lookups, setLookups] = useState<Lookups | undefined>();
  const [known, setKnown] = useState<Map<string, FileConstants>>(() => new Map());
  // The constants as of now, for building a model without rebuilding it when they change.
  const knownRef = useRef(known);
  const [fromFabric, setFromFabric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const loaded = useRef<string | null>(null);

  const keep = useCallback((next: Map<string, FileConstants>) => {
    knownRef.current = next;
    setKnown(next);
  }, []);

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
        read = await loadLookups(client);
      } catch (e) {
        if (!cancelled) setLookupError(message(e));
      }
      // Without them every file calculates with the Model sheet's constants.
      const constraints = await loadConstraints(client).catch((e: unknown) => { if (!cancelled) setConstraintsError(message(e)); return null; });
      if (cancelled) return;
      loaded.current = inputFingerprint(all) + (read ? lookupsFingerprint(read) : '');
      setLookups(read);
      if (constraints) keep(constraintsByFile(constraints));
      setFromFabric(true);
      setRows(all);
    })();
    return () => { cancelled = true; };
  }, [keep]);

  useEffect(() => {
    if (!fromFabric || updated) return;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const client = await getRayfinClient();
        const [all, read, constraints] = await Promise.all([loadInputRows(client), lookups ? loadLookups(client) : null, loadConstraints(client)]);
        const changed = inputFingerprint(all) + (read ? lookupsFingerprint(read) : '') !== loaded.current
          || constraintsFingerprint(constraintsByFile(constraints)) !== constraintsFingerprint(knownRef.current);
        if (changed) setUpdated(true);
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

  const rememberConstants = useCallback((file: string, values: FileConstants) => {
    const next = new Map(knownRef.current);
    next.set(file, new Map([...(next.get(file) ?? []), ...values]));
    keep(next);
  }, [keep]);
  // Read when the model is built, so applying constants (which the engine takes directly) doesn't rebuild it.
  const constantsOf = useCallback((file: string) => cellsOf(knownRef.current.get(file)), []);

  const files = useMemo(() => (rows ? inputFiles(rows) : []), [rows]);
  const selected = files.find((f) => f.name === fileName)?.name ?? files.find((f) => f.name === FILE_NAME)?.name ?? files[0]?.name ?? null;
  const input = useMemo<EngineInput | null>(() => (rows && selected
    ? {
      rows: rows.filter((r) => String(r.File_Name ?? FILE_NAME) === selected), source: fromFabric ? FABRIC_SOURCE : 'Bundled input file (Fabric unavailable)',
      lookups, fileName: selected, constants: () => constantsOf(selected),
    }
    : null), [rows, selected, fromFabric, lookups, constantsOf]);

  return {
    input, files, fileName: selected, constants: (selected && known.get(selected)) || NONE, rememberConstants,
    constraintsError, error, lookupError, updated,
  };
}
