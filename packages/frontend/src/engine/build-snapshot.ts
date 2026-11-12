// Calculates an input file's model once, in a worker of its own that is closed afterwards: for
// showing another file's loans beside the model being edited (the Home page with several files
// ticked). The worker is the same engine; nothing here can change the file.

import type { CellChange, EngineRequest, EngineResponse, Snapshot } from './protocol.ts';
import type { EngineInput } from './use-model-engine.ts';

type Payload = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * Builds the model for `input`, then applies the overrides `replay` returns for it (the file's
 * saved loan changes), and resolves with the recalculated snapshot.
 */
export async function buildSnapshot(input: EngineInput, replay?: (s: Snapshot) => Promise<CellChange[]>): Promise<Snapshot> {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const call = (payload: Payload) => new Promise<EngineResponse>((resolve, reject) => {
    const id = nextId++;
    worker.onmessage = (e: MessageEvent<EngineResponse>) => { if (e.data.id === id) resolve(e.data); };
    worker.onerror = (e) => reject(new Error(e.message || 'The calculation engine stopped unexpectedly.'));
    worker.postMessage({ ...payload, id } as EngineRequest);
  });
  try {
    let res = await call({ type: 'init', input: input.rows, source: input.source, lookups: input.lookups, constants: input.constants?.() });
    if (!res.ok) throw new Error(res.error);
    const changes = replay ? await replay(res.snapshot) : [];
    if (changes.length) {
      const replayed = await call({ type: 'setMany', changes });
      if (replayed.ok) res = replayed;
    }
    return res.snapshot;
  } finally {
    worker.terminate();
  }
}
