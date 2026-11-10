import type { ValueKind } from '@/engine/model-schema';
import { isError, type CellOut } from '@/engine/protocol';

/** The text an input shows when editing a value (percentages as 12.5, not 0.125). */
export function editText(v: CellOut, kind: ValueKind): string {
  if (typeof v !== 'number') return v == null || isError(v) ? '' : String(v);
  if (kind === 'pct') return String(Math.round(v * 1e8) / 1e6);
  return String(Math.round(v * 1e6) / 1e6);
}

/** Parse user input for a field; returns null when it is not a valid value. */
export function parseInput(text: string, kind: ValueKind): number | string | null {
  const t = text.trim();
  if (kind === 'text') return t || null;
  const n = Number(t.replace(/[$,%x\s]/gi, ''));
  if (!t || !Number.isFinite(n)) return null;
  if (kind === 'pct') return n / 100;
  if (kind === 'flag') return n ? 1 : 0;
  return n;
}
