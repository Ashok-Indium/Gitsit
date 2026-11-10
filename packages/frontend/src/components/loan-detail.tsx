import { X } from 'lucide-react';
import { useState } from 'react';

import { FIELD_BY_LABEL } from '@/engine/model-schema';
import type { LoanSnapshot, Override } from '@/engine/protocol';
import { REPORT_TABLES } from '@/engine/report-fields';
import { pbiFormat } from '@/report/format';
import { cfTotal } from '@/report/measures';

import { EditableValue } from './editable-value';

const GROUPS: [string, readonly string[]][] = [
  ['Model Output', REPORT_TABLES.modelOutput.slice(1)],
  ['DCF - Perf', REPORT_TABLES.dcfPerf.slice(1)],
  ['DCF - Payoff', REPORT_TABLES.dcfPayoff.slice(1)],
  ['DCF - REO', REPORT_TABLES.dcfReo.slice(1)],
  ['DCF - NPL', [...REPORT_TABLES.dcfNpl.slice(1), 'NPL T&I Exp', 'NPL FCL Exp', 'NPL PPRES Exp']],
  ['DCF - Custom', ['Custom Exit %', 'Custom Capex %', 'Custom Timeline', 'Custom Return']],
];
const CF_TOTAL = /^(Perf|Payoff|REO|NPL) CF Total$/;

interface LoanDetailProps {
  loan: LoanSnapshot;
  overrides: Map<string, Override>;
  busy: boolean;
  onClose: () => void;
  onCommit: (row: number, col: string, value: number | string) => void;
  onReset: (row: number, col: string) => void;
}

/** Every report field for one loan, grouped like the report's tables; editable ones inline. */
export function LoanDetail({ loan, overrides, busy, onClose, onCommit, onReset }: LoanDetailProps) {
  const [editableOnly, setEditableOnly] = useState(true);
  return (
    <aside aria-label={`Loan ${loan.values.A}`} className="flex h-full flex-col border-l border-visual-border bg-card shadow-xl">
      <header className="flex items-start justify-between gap-300 border-b border-visual-border p-400">
        <div>
          <p className="text-200 font-semibold uppercase tracking-wider text-muted-foreground">Loan</p>
          <h2 className="text-500 font-bold text-title">{String(loan.values.A ?? '')}</h2>
          <p className="text-200 text-muted-foreground">
            {[loan.values.K, loan.values.L].filter(Boolean).join(', ')} · Model row {loan.row}
          </p>
          <label className="mt-200 flex items-center gap-200 text-200">
            <input type="checkbox" checked={editableOnly} onChange={(e) => setEditableOnly(e.target.checked)} />
            Editable fields only
          </label>
        </div>
        <button type="button" aria-label="Close loan details"
          className="rounded-md p-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}>
          <X className="icon-size-300" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-400">
        {GROUPS.map(([group, labels]) => {
          const shown = labels.filter((l) => !editableOnly || FIELD_BY_LABEL[l]?.editable);
          if (!shown.length) return null;
          return (
            <section key={group} className="mb-500">
              <h3 className="mb-200 border-b border-visual-border pb-100 text-300 font-bold text-title">{group}</h3>
              <dl className="grid grid-cols-[1fr_auto] items-center gap-x-300 gap-y-100 text-300">
                {shown.map((label) => {
                  const cf = CF_TOTAL.exec(label);
                  const f = FIELD_BY_LABEL[label];
                  return (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">
                        {label}
                        {f && <span className="ml-100 text-100 text-muted-foreground/70">{f.col}</span>}
                      </dt>
                      <dd className="text-right tabular-nums">
                        {cf ? (
                          <span className="px-100">{pbiFormat(cfTotal(loan, cf[1] as 'Perf'), '#,##0.00')}</span>
                        ) : f.editable ? (
                          <EditableValue field={f} value={loan.values[f.col]} override={overrides.get(`${f.col}${loan.row}`)} disabled={busy}
                            onCommit={(v) => onCommit(loan.row, f.col, v)} onReset={() => onReset(loan.row, f.col)} />
                        ) : (
                          <span className="px-100">{pbiFormat(loan.values[f.col], f.fmt) || '–'}</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
