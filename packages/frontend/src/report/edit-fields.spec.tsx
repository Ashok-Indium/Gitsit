import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Snapshot } from '@/engine/protocol';

import { EditFieldsPage } from './edit-fields';
import type { Editing } from './tables';

const loan = (row: number, id: string, state: string, fade: number, bpo: number) =>
  ({ row, values: { A: id, L: state, AJ: fade, Y: bpo }, strips: { Perf: [], Payoff: [], REO: [], NPL: [] } });

const snapshot: Snapshot = {
  loans: [loan(17, '1001', 'CA', 0.2, 100000), loan(18, '1002', 'NV', 0.3, 200000), loan(19, '1003', 'CA', 0.1, 300000)],
  assumptions: {}, monthEnds: [], overrides: [], recalcMs: 0,
};

function setup() {
  const editing: Editing = {
    overrides: new Map(), busy: false,
    onCommit: vi.fn(), onReset: vi.fn(), onOpenLoan: vi.fn(),
    onCommitMany: vi.fn().mockResolvedValue(undefined), onResetMany: vi.fn().mockResolvedValue(undefined),
  };
  render(<EditFieldsPage snapshot={snapshot} editing={editing} filters={{}} setFilters={vi.fn()} navigate={vi.fn()}
    file={{ files: [], fileName: null, onFileChange: vi.fn(), busy: false }} />);
  const [whereField, setField] = screen.getAllByLabelText('Field') as HTMLSelectElement[];
  return { editing, whereField, setField };
}

describe('EditFieldsPage', () => {
  it('sets a field on every loan the conditions select', async () => {
    const { editing } = setup();
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'contains' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'ca' } });
    fireEvent.change(screen.getByLabelText('Value (%)'), { target: { value: '25' } });

    expect(screen.getByLabelText('Update statement')).toHaveTextContent("SET [Fade] = 25.00% WHERE [Prop State] LIKE '%ca%'");
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 2 loans' }));

    await screen.findByText(/Updated 2 values on 2 loans/);
    expect(editing.onCommitMany).toHaveBeenCalledWith([
      { row: 17, col: 'AJ', value: 0.25 },
      { row: 19, col: 'AJ', value: 0.25 },
    ]);
  });

  it('scales a field by a percentage and leaves unticked loans alone', async () => {
    const { editing, whereField, setField } = setup();
    fireEvent.change(whereField, { target: { value: 'Fade' } });
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'ge' } });
    fireEvent.change(screen.getAllByLabelText('Value')[0], { target: { value: '20' } });
    fireEvent.change(setField, { target: { value: 'Y' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'scale' } });
    fireEvent.change(screen.getByLabelText('Change %'), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('Include loan 1002'));

    fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 loan' }));
    await screen.findByText(/Updated 1 value on 1 loan/);
    expect(editing.onCommitMany).toHaveBeenCalledWith([{ row: 17, col: 'Y', value: 110000 }]);
  });
});
