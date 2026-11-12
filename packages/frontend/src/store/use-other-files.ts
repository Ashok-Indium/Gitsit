// The other input files ticked on the Home page: each calculated in a worker of its own, with its
// own constraints and its saved loan changes, so its loans can be shown beside the model being
// edited. They are read-only; a file is recalculated when it is ticked again.

import { useEffect, useMemo, useRef, useState } from 'react';

import { buildSnapshot } from '@/engine/build-snapshot';
import type { Snapshot } from '@/engine/protocol';
import type { EngineInput } from '@/engine/use-model-engine';
import { getRayfinClient } from '@/lib/rayfin-client';

import { latestEdits, loadChangeLog } from './shared-model';

export interface FileView {
  name: string;
  /** The file's calculated loans, each marked with the file; null while it is calculating. */
  snapshot: Snapshot | null;
  /** Why it couldn't be calculated. */
  error: string | null;
}

type Result = Omit<FileView, 'name'>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Calculates `names` (the ticked files other than the model's own) one at a time, keeping each
 * result while the file stays ticked. `withChanges` replays each file's saved loan changes (when
 * signed in to Fabric), as opening the file would.
 */
export function useOtherFiles(names: string[], inputFor: (name: string) => EngineInput | null, withChanges: boolean): FileView[] {
  const [built, setBuilt] = useState<Map<string, Result>>(() => new Map());
  // What has been calculated, and from which input data (new data recalculates every file).
  const done = useRef(new Map<string, Result>());
  const source = useRef<[typeof inputFor, boolean] | null>(null);
  const key = names.join('\n');

  useEffect(() => {
    if (source.current?.[0] !== inputFor || source.current[1] !== withChanges) {
      done.current = new Map();
      source.current = [inputFor, withChanges];
    }
    const wanted = key ? key.split('\n') : [];
    for (const n of [...done.current.keys()]) if (!wanted.includes(n)) done.current.delete(n);
    setBuilt(new Map(done.current));
    let cancelled = false;
    void (async () => {
      for (const name of wanted) {
        if (cancelled) return;
        const input = done.current.has(name) ? null : inputFor(name);
        if (!input) continue;
        let result: Result;
        try {
          const snapshot = await buildSnapshot(input, withChanges
            ? async (s) => latestEdits(await loadChangeLog(await getRayfinClient(), name), s.loans)
            : undefined);
          result = { snapshot: { ...snapshot, loans: snapshot.loans.map((l) => ({ ...l, file: name })) }, error: null };
        } catch (e) {
          result = { snapshot: null, error: message(e) };
        }
        if (cancelled) return;
        done.current.set(name, result);
        setBuilt(new Map(done.current));
      }
    })();
    return () => { cancelled = true; };
  }, [key, inputFor, withChanges]);

  return useMemo(
    () => (key ? key.split('\n') : []).map((name) => ({ name, ...(built.get(name) ?? { snapshot: null, error: null }) })),
    [key, built],
  );
}
