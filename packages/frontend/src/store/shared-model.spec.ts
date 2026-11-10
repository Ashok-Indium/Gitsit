import { describe, expect, it } from 'vitest';

import type { Snapshot } from '@/engine/protocol';

import { camelCase } from './column-names';
import { MODEL_COLUMNS, MONTHLY_SERIES } from './generated/store-fields';
import { changedColumns, displayName, editEntries, latestEdits, modelRow, monthlyRows, resetEntries } from './shared-model';

const strips = { Perf: [100, 50], Payoff: [], REO: [], NPL: [] };
const loan = (row: number, id: string, fade: number) => ({ row, values: { A: id, AJ: fade, Y: 200000, L: 'CA' }, strips });
const snapshot: Snapshot = {
  loans: [loan(17, '1001', 0.2), loan(18, '1002', 0.3)],
  assumptions: {}, constants: {}, monthEnds: [], recalcMs: 0,
  overrides: [{ row: 18, col: 'AJ', value: 0.3, modelValue: 0.15 }],
};
const user = { name: 'Ashok G', email: 'ashok.g@indium.tech' };
const at = new Date('2026-10-27T10:00:00Z');

describe('shared model store', () => {
  it('derives a display name from the sign-in email', () => {
    expect(displayName('ashok.g@indium.tech')).toBe('Ashok G');
    expect(displayName('mary_ann-lee@x.com')).toBe('Mary Ann Lee');
  });

  it('logs edits with File_Name, the Loan_Model column and clean values', () => {
    expect(editEntries(snapshot, [{ row: 17, col: 'AJ', value: 0.013000000000000001 }], user, () => 'Pacific Private Money', at)).toEqual([{
      Table_Type: 'BPL', File_Name: 'Pacific Private Money', Loan_Id: '1001', Column_Name: 'fade', Old_Value: '0.2', New_Value: '0.013',
      User_mail: 'ashok.g@indium.tech', Changed_On: at,
    }]);
  });

  it('does not log a change that leaves the value as it was', () => {
    expect(editEntries(snapshot, [{ row: 17, col: 'AJ', value: 0.2 }], user)).toEqual([]);
  });

  it('logs resets back to the model value marked "(reset)", skipping cells with no override', () => {
    const entries = resetEntries(snapshot, [{ row: 18, col: 'AJ' }, { row: 17, col: 'AJ' }], user, undefined, at);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ Loan_Id: '1002', Column_Name: 'fade', Old_Value: '0.3', New_Value: '0.15 (reset)', File_Name: 'Pacific Private Money' });
  });

  it('replays only the latest change per loan and column, and drops resets', () => {
    const e = (Loan_Id: string, New_Value: string, hour: number) => ({ Loan_Id, Column_Name: 'fade', New_Value, Changed_On: new Date(Date.UTC(2026, 9, 27, hour)) });
    const log = [e('1001', '0.25', 10), e('1001', '0.3', 11), e('1002', '0.4', 10), e('1002', '0.15 (reset)', 12), e('9999', '0.5', 12)];
    expect(latestEdits(log, snapshot.loans)).toEqual([{ row: 17, col: 'AJ', value: 0.3 }]);
  });

  it('builds model rows from every Model column and finds the columns that changed', () => {
    const row = modelRow(snapshot.loans[0]);
    expect(Object.keys(row)).toHaveLength(MODEL_COLUMNS.length);
    expect(row).toMatchObject({ loan_id: '1001', fade: 0.2, bpo_as_is: 200000, st: 'CA', bid: null });
    expect(changedColumns(row, { ...row })).toEqual({});
    expect(changedColumns({ ...row, fade: 0.25 }, { ...row, bpo_as_is: '200000.0000000000' })).toEqual({ fade: 0.25 });
  });

  it('keeps Loan_Model in one SQL table', () => {
    expect(MODEL_COLUMNS[0]).toMatchObject({ name: 'loan_id', col: 'A' });
    expect(MODEL_COLUMNS.length + 3).toBeLessThanOrEqual(1024); // + changed_by, user_email, modifiedon
    expect(MODEL_COLUMNS.filter((c) => c.type === 'decimal').length * 13).toBeLessThan(8000);
    expect(new Set(MODEL_COLUMNS.map((c) => c.name)).size).toBe(MODEL_COLUMNS.length);
    expect(new Set(MODEL_COLUMNS.map((c) => camelCase(c.name))).size).toBe(MODEL_COLUMNS.length);
  });

  it('puts the month-by-month blocks in Loan_Model_Monthly, one row per series', () => {
    const perf = MONTHLY_SERIES.find((s) => s.series === 'Perf CF')!;
    const l = { row: 17, values: { A: '1001', [perf.cols[0]]: 100, [perf.cols[1]]: 'x', [perf.cols[2]]: 50.123456789012 }, strips };
    const rows = monthlyRows(l);
    expect(rows).toHaveLength(MONTHLY_SERIES.length);
    expect(rows.find((r) => r.series === 'Perf CF')).toMatchObject({ loan_id: '1001', periods: 'month 1-36', m01: 100, m02: null, m03: 50.123456789 });
    const covered = new Set([...MODEL_COLUMNS.map((c) => c.col), ...MONTHLY_SERIES.flatMap((s) => s.cols)]);
    expect(covered.size).toBe(MODEL_COLUMNS.length + MONTHLY_SERIES.reduce((n, s) => n + s.cols.length, 0));
  });
});
