import { excelText } from '@/engine/excel-format';
import { isError, type CellOut } from '@/engine/protocol';

/** Format a value with a Power BI format string (e.g. `#,##0.00`, `0.0%`, `$#,##0`, `#,##0;(#,##0)`). */
export function pbiFormat(v: CellOut | undefined, fmt: string): string {
  if (v == null || v === '') return '';
  if (isError(v)) return v.error;
  if (typeof v !== 'number') return String(v);
  if (!fmt) return String(v);
  const [pos, neg] = fmt.split(';');
  if (v < 0 && neg) return `(${excelText(-v, neg.replace(/[()]/g, ''))})`;
  return excelText(v, pos);
}

/** Power BI "Auto" display units for card values: 2.57M, 456.39K. */
export function pbiAuto(v: number | null, fmt: string): string {
  if (v == null || !Number.isFinite(v)) return '(Blank)';
  const currency = fmt.startsWith('$');
  const a = Math.abs(v);
  if (fmt.includes('%') || a < 1000) return pbiFormat(v, fmt);
  const [d, unit] = a >= 1e9 ? [1e9, 'bn'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const scaled = v / d;
  const digits = Math.abs(scaled) >= 100 ? 1 : 2;
  return `${scaled < 0 ? '-' : ''}${currency ? '$' : ''}${Math.abs(scaled).toFixed(digits)}${unit}`;
}

export const isNumericFmt = (fmt: string) => /[0#]/.test(fmt);
