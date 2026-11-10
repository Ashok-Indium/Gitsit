// Messages between the UI and the engine worker.

import type { InputRow } from './load-input.ts';
import type { Lookups } from './lookups.ts';
import type { Scenario } from './model-schema.ts';

export type CellOut = number | string | boolean | null | { error: string };

export interface LoanSnapshot {
  /** 1-based Model row. */
  row: number;
  /** Values by Model column letter. */
  values: Record<string, CellOut>;
  /** Monthly cash flows, months 1-36, per exit scenario. */
  strips: Record<Scenario, number[]>;
}

export interface Override {
  row: number;
  col: string;
  value: number | string;
  /** The model's value just before the override was applied. */
  modelValue: CellOut;
}

export interface Snapshot {
  loans: LoanSnapshot[];
  /** Assumption values by Model cell (e.g. CC1). */
  assumptions: Record<string, CellOut>;
  /** Month-end dates (Excel serials) of the cash-flow strip months. */
  monthEnds: CellOut[];
  /** The Model sheet's Average (row 8) and Total (row 9) values, by report column. */
  summary?: { average: Record<string, CellOut>; total: Record<string, CellOut> };
  overrides: Override[];
  recalcMs: number;
}

export interface TemplateInfo {
  sourceModel: string;
  /** Where the input loans came from, e.g. "Input_table (Fabric SQL)". */
  sourceTape: string;
  generatedAt: string;
  /** How many loans the model holds. */
  capacity: number;
  /** Loan IDs left out because the input had more loans than the model holds. */
  dropped: string[];
}

export interface CellRef {
  row: number;
  col: string;
}

export interface CellChange extends CellRef {
  value: number | string;
}

export type EngineRequest =
  | { id: number; type: 'init'; input: InputRow[]; source: string; lookups?: Lookups }
  | { id: number; type: 'set'; row: number; col: string; value: number | string }
  | { id: number; type: 'setMany'; changes: CellChange[] }
  | { id: number; type: 'reset'; row: number; col: string }
  | { id: number; type: 'resetMany'; cells: CellRef[] }
  | { id: number; type: 'resetAll' };

export type EngineResponse =
  | { id: number; ok: true; snapshot: Snapshot; info?: TemplateInfo }
  | { id: number; ok: false; error: string };

export const isError = (v: CellOut): v is { error: string } => !!v && typeof v === 'object';
