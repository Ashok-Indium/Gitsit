import { useCallback, useEffect, useRef, useState } from 'react';

import type { InputRow } from './load-input.ts';
import type { Lookups } from './lookups.ts';
import type { CellChange, CellRef, EngineRequest, EngineResponse, Snapshot, TemplateInfo } from './protocol.ts';

type Pending = { resolve: (r: EngineResponse) => void };
type Payload = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export type EngineStatus = 'loading' | 'ready' | 'busy' | 'error';

export interface ModelEngine {
  status: EngineStatus;
  snapshot: Snapshot | null;
  info: TemplateInfo | null;
  error: string | null;
  /** The input file the current snapshot was built from (null until the first build). */
  builtFor: string | null;
  // Each resolves with the recalculated snapshot, or null when the change was refused.
  setOverride: (row: number, col: string, value: number | string) => Promise<Snapshot | null>;
  /** Override many cells with a single recalculation. */
  setOverrides: (changes: CellChange[]) => Promise<Snapshot | null>;
  resetOverride: (row: number, col: string) => Promise<Snapshot | null>;
  resetOverrides: (cells: CellRef[]) => Promise<Snapshot | null>;
  resetAll: () => Promise<Snapshot | null>;
}

export interface EngineInput {
  rows: InputRow[];
  /** Shown as the data source, e.g. "Input_table (Fabric SQL)". */
  source: string;
  /** The lookup tables (EXIT, ZIP3 …) to write into the model; absent = the workbook's values. */
  lookups?: Lookups;
  /** The input file (File_Name) the rows come from. */
  fileName?: string;
}

/**
 * Owns the engine worker for the lifetime of the component tree. The model is built once
 * `input` arrives, and rebuilt whenever a new input object is passed.
 */
export function useModelEngine(input: EngineInput | null): ModelEngine {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builtFor, setBuiltFor] = useState<string | null>(null);

  const send = useCallback((payload: Payload) => {
    const w = worker.current;
    if (!w) return Promise.reject(new Error('The calculation engine is not running.'));
    const id = nextId.current++;
    return new Promise<EngineResponse>((resolve) => {
      pending.current.set(id, { resolve });
      w.postMessage({ ...payload, id } as EngineRequest);
    });
  }, []);

  const receive = useCallback((res: EngineResponse, initializing: boolean) => {
    if (res.ok) {
      setSnapshot(res.snapshot);
      if (res.info) setInfo(res.info);
      setError(null);
      setStatus('ready');
    } else {
      setError(res.error);
      setStatus(initializing ? 'error' : 'ready');
    }
  }, []);

  const apply = useCallback(async (payload: Payload) => {
    setStatus('busy');
    const res = await send(payload);
    receive(res, false);
    return res.ok ? res.snapshot : null;
  }, [send, receive]);

  useEffect(() => {
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    const waiting = pending.current;
    worker.current = w;
    w.onmessage = (e: MessageEvent<EngineResponse>) => {
      waiting.get(e.data.id)?.resolve(e.data);
      waiting.delete(e.data.id);
    };
    w.onerror = (e) => {
      setError(e.message || 'The calculation engine stopped unexpectedly.');
      setStatus('error');
    };
    return () => {
      w.terminate();
      worker.current = null;
      waiting.clear();
    };
  }, []);

  useEffect(() => {
    if (!input) return;
    void send({ type: 'init', input: input.rows, source: input.source, lookups: input.lookups }).then((res) => {
      receive(res, true);
      if (res.ok) setBuiltFor(input.fileName ?? '');
    });
  }, [input, send, receive]);

  // A new input (another file) is loading until the engine has built it.
  const rebuilding = !!input && builtFor !== null && (input.fileName ?? '') !== builtFor && status !== 'error';
  return {
    status: rebuilding ? 'loading' : status,
    snapshot,
    info,
    error,
    builtFor,
    setOverride: (row, col, value) => apply({ type: 'set', row, col, value }),
    setOverrides: (changes) => apply({ type: 'setMany', changes }),
    resetOverride: (row, col) => apply({ type: 'reset', row, col }),
    resetOverrides: (cells) => apply({ type: 'resetMany', cells }),
    resetAll: () => apply({ type: 'resetAll' }),
  };
}
