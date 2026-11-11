import { describe, expect, it } from 'vitest';

import type { Override, Snapshot } from '@/engine/protocol';

import type { Loan } from './measures';
import { duplicatesOf, headerStyle, loanCellStyle, type SheetContext } from './sheet-style';

const loan = (row: number, values: Loan['values']): Loan => ({ row, values, strips: { Perf: [], Payoff: [], REO: [], NPL: [] } } as unknown as Loan);

function context(loans: Loan[], overrides: Override[] = []): SheetContext {
  const snapshot = {
    loans, assumptions: { AB1: 12, CC1: 1.2 }, constants: {}, monthEnds: [], overrides, recalcMs: 0,
    summary: { average: { BR: 0.5 }, total: {} },
  } as unknown as Snapshot;
  return {
    snapshot, overrides: new Map(overrides.map((o) => [`${o.col}${o.row}`, o])),
    duplicates: (col) => duplicatesOf(loans, col),
  };
}

describe('Model sheet styles', () => {
  it('colours headers and the Average and Total rows as the sheet does', () => {
    expect(headerStyle('A', 'header')).toEqual({ backgroundColor: '#D9D9D9', color: '#0000FF', fontWeight: 700 });
    expect(headerStyle('A', 'total')).toEqual({ backgroundColor: '#000000', color: '#FFFFFF' });
  });

  it('applies the conditional formats that hold for a loan', () => {
    const stale = loan(11, { AB: 13 }), fresh = loan(12, { AB: 6 });
    const ctx = context([stale, fresh]);
    // BPO older than the Constraints' fade_stale_months (AB1).
    expect(loanCellStyle('AB', stale, ctx)).toMatchObject({ backgroundColor: '#FFFF99' });
    expect(loanCellStyle('AB', fresh, ctx).backgroundColor).toBeUndefined();
    // A negative gross gain is red; a bid % above the pool average has red text.
    expect(loanCellStyle('CI', loan(11, { CI: -5 }), ctx)).toMatchObject({ backgroundColor: '#C00000', color: '#FFFFFF' });
    expect(loanCellStyle('BR', loan(11, { BR: 0.7 }), ctx)).toMatchObject({ color: '#FF0000' });
    expect(loanCellStyle('BR', loan(11, { BR: 0.3 }), ctx)).toMatchObject({ color: '#000000' });
    // A hurdle that differs from the default (CC1).
    expect(loanCellStyle('CC', loan(11, { CC: 1.35 }), ctx)).toMatchObject({ backgroundColor: '#FFFFCC', color: '#0000FF' });
  });

  it('marks duplicate Loan IDs and cells typed over a formula', () => {
    const a = loan(11, { A: '7', B: 'x', J: 1 }), b = loan(12, { A: '7', B: 'x', J: 1 });
    expect(loanCellStyle('A', a, context([a, b]))).toMatchObject({ backgroundColor: '#FFC7CE' });
    const edited = loan(11, { AJ: 0.2 });
    const ctx = context([edited], [{ row: 11, col: 'AJ', value: 0.2, modelValue: 0.1 } as Override]);
    expect(loanCellStyle('AJ', edited, ctx)).toMatchObject({ backgroundColor: '#FFFFCC', color: '#0000FF', fontWeight: 700, fontStyle: 'italic' });
  });
});
