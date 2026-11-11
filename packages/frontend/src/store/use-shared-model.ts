import { useCallback, useEffect, useRef, useState } from 'react';

import type { CellChange, CellRef, Constants, Snapshot } from '@/engine/protocol';
import type { ModelEngine } from '@/engine/use-model-engine';
import { getRayfinClient } from '@/lib/rayfin-client';

import {
  editEntries, latestEdits, loadChangeLog, loadModelRows, resetEntries, syncModelRows, saveConstraints, writeChangeLog,
  type ConstraintEdit, type StoredModel, type StoreUser,
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
  /**
   * Applies model constants to the model and saves them to Constraints.BPL_ConstraintValues
   * (logged in BPL_ConstraintChanges). Resolves with whether the model took them and whether
   * they were saved (nothing is written without a signed-in user or without entries).
   */
  applyConstants: (constants: Constants, entries: ConstraintEdit[]) => Promise<{ applied: boolean; saved: boolean; error?: string }>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Client = Awaited<ReturnType<typeof getRayfinClient>>;

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

  /** Applies a change to the model, then writes its log rows (`log`, when there are any) and the recalculated loans. */
  const record = useCallback(async (log: ((client: Client) => Promise<void>) | null, apply: () => Promise<Snapshot | null>) => {
    const next = await apply();
    if (!next || !user || !fileName || !log) return;
    await enqueue(async () => {
      await log(await getRayfinClient());
      await sync(next, user, fileName);
    });
  }, [user, fileName, enqueue, sync]);

  const commit = useCallback(async (changes: CellChange[]) => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? editEntries(before, changes, user, fileNameOf) : [];
    await record(entries.length ? (c) => writeChangeLog(c, entries) : null, () => engineRef.current.setOverrides(changes));
  }, [user, record, fileNameOf]);

  const reset = useCallback(async (cells: CellRef[]) => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? resetEntries(before, cells, user, fileNameOf) : [];
    await record(entries.length ? (c) => writeChangeLog(c, entries) : null, () => engineRef.current.resetOverrides(cells));
  }, [user, record, fileNameOf]);

  const resetAll = useCallback(async () => {
    const before = engineRef.current.snapshot;
    const entries = before && user ? resetEntries(before, before.overrides, user, fileNameOf) : [];
    await record(entries.length ? (c) => writeChangeLog(c, entries) : null, () => engineRef.current.resetAll());
  }, [user, record, fileNameOf]);

  const applyConstants = useCallback(async (constants: Constants, entries: ConstraintEdit[]) => {
    const next = await engineRef.current.setConstants(constants);
    if (!next) return { applied: false, saved: false };
    if (!user || !fileName || !entries.length) return { applied: true, saved: false };
    const outcome: { error?: string } = {};
    await enqueue(async () => {
      const client = await getRayfinClient();
      try {
        await saveConstraints(client, entries, user.email);
      } catch (e) {
        outcome.error = message(e);
        throw e;
      }
      await sync(next, user, fileName);
    });
    return { applied: true, saved: !outcome.error, error: outcome.error };
  }, [user, fileName, enqueue, sync]);

  return {
    status: offline ? { state: 'error', message: offline }
      : user ? status : { state: 'error', message: 'Not signed in, so changes are not saved.' },
    commit, reset, resetAll, applyConstants,
  };
}
