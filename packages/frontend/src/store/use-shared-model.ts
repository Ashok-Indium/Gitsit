import { useCallback, useEffect, useRef, useState } from 'react';

import type { CellChange, CellRef, Snapshot } from '@/engine/protocol';
import type { ModelEngine } from '@/engine/use-model-engine';
import { getRayfinClient } from '@/lib/rayfin-client';

import {
  editEntries, latestEdits, loadChangeLog, loadModelRows, resetEntries, syncModelRows, writeChangeLog,
  type ChangeEntry, type StoredModel, type StoreUser,
} from './shared-model';

export type StoreStatus =
  | { state: 'loading' }
  | { state: 'saving' }
  | { state: 'saved'; at: Date }
  | { state: 'error'; message: string };

export interface SharedModel {
  status: StoreStatus;
  commit: (changes: CellChange[]) => Promise<void>;
  reset: (cells: CellRef[]) => Promise<void>;
  resetAll: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Keeps one input file's model in step with Fabric: when the model loads it replays everyone's
 * saved edits to that file and brings its Loan_Model and Loan_Model_Monthly rows up to date; every
 * later change is logged to LoanChanges and the loans whose values moved are rewritten there.
 * Nothing is written without a `user`; `offline` gives the reason when the loans did not come from
 * Fabric. Choosing another `fileName` starts over with that file.
 */
export function useSharedModel(engine: ModelEngine, user: StoreUser | null, offline: string | undefined,
  fileName: string | null): SharedModel {
  const [status, setStatus] = useState<StoreStatus>({ state: 'loading' });
  const engineRef = useRef(engine);
  const stored = useRef<StoredModel | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const started = useRef<string | null>(null);
  const fileNameOf = useCallback(() => fileName ?? '', [fileName]);

  useEffect(() => { engineRef.current = engine; });

  /** Fabric writes run one after another, in the order the changes were made. */
  const enqueue = useCallback((task: () => Promise<void>) => {
    pending.current++;
    setStatus({ state: 'saving' });
    queue.current = queue.current.then(task).then(
      () => { if (--pending.current === 0) setStatus({ state: 'saved', at: new Date() }); },
      (e) => {
        pending.current--;
        stored.current = null; // re-read the model tables before the next write
        setStatus({ state: 'error', message: message(e) });
      },
    );
    return queue.current;
  }, []);

  const sync = useCallback(async (snapshot: Snapshot, who: StoreUser, file: string) => {
    const client = await getRayfinClient();
    stored.current ??= await loadModelRows(client, file);
    await syncModelRows(client, snapshot, stored.current, who, () => file);
  }, []);

  // A new file's model: replay its saved edits once the engine has built it.
  const snapshot = engine.snapshot;
  const ready = engine.status === 'ready' && engine.builtFor === fileName;
  useEffect(() => {
    if (!snapshot || !ready || !user || !fileName || started.current === fileName) return;
    started.current = fileName;
    stored.current = null;
    void enqueue(async () => {
      const client = await getRayfinClient();
      const replay = latestEdits(await loadChangeLog(client, fileName), snapshot.loans);
      const current = replay.length ? (await engineRef.current.setOverrides(replay)) ?? snapshot : snapshot;
      await sync(current, user, fileName);
    });
  }, [snapshot, ready, user, fileName, enqueue, sync]);

  const record = useCallback(async (entries: ChangeEntry[], apply: () => Promise<Snapshot | null>) => {
    const next = await apply();
    if (!next || !user || !fileName || !entries.length) return;
    await enqueue(async () => {
      await writeChangeLog(await getRayfinClient(), entries);
      await sync(next, user, fileName);
    });
  }, [user, fileName, enqueue, sync]);

  const commit = useCallback(async (changes: CellChange[]) => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? editEntries(before, changes, user, fileNameOf) : [];
    await record(entries, () => engineRef.current.setOverrides(changes));
  }, [user, record, fileNameOf]);

  const reset = useCallback(async (cells: CellRef[]) => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? resetEntries(before, cells, user, fileNameOf) : [];
    await record(entries, () => engineRef.current.resetOverrides(cells));
  }, [user, record, fileNameOf]);

  const resetAll = useCallback(async () => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? resetEntries(before, before.overrides, user, fileNameOf) : [];
    await record(entries, () => engineRef.current.resetAll());
  }, [user, record, fileNameOf]);

  return {
    status: offline ? { state: 'error', message: offline }
      : user ? status : { state: 'error', message: 'Not signed in, so changes are not saved.' },
    commit, reset, resetAll,
  };
}
