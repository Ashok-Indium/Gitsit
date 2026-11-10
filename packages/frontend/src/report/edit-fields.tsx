// Edit Fields: pick loans with a WHERE-style condition builder, then set the editable Model
// columns for all of them at once. Every change is applied in one batch and one recalculation.

import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { EditableValue } from '@/components/editable-value';
import { roundWith } from '@/engine/excel-format';
import { colNum } from '@/engine/formula-text';
import { FIELD_BY_COL, FIELD_BY_LABEL, LOAN_FIELDS, type LoanField } from '@/engine/model-schema';
import { isError, type CellChange, type CellOut, type CellRef } from '@/engine/protocol';
import { parseInput } from '@/lib/format';
import { cn } from '@/lib/utils';

import { pbiFormat } from './format';
import type { Loan } from './measures';
import type { PageProps } from './pages';
import { PageBanner, Slicer, VisualFrame } from './visuals';

// ---------- fields ----------

/** Editable columns in Model-sheet order (S, Y, AJ … ALD). */
const EDITABLE = [...new Map(LOAN_FIELDS.filter((f) => f.editable).map((f) => [f.col, f])).values()]
  .sort((a, b) => colNum(a.col) - colNum(b.col));
const ALL_FIELDS = [...new Map(LOAN_FIELDS.map((f) => [f.label, f])).values()];
const COMMON = ['Loan ID', 'Pool', 'Carve', 'Prop State', 'Prop City', 'Loan Status', 'Exit', 'Lien', 'Loan Type', 'Region', 'Property Type Group', 'Total UPB'];
const OTHER = ALL_FIELDS.filter((f) => !f.editable && !COMMON.includes(f.label)).sort((a, b) => a.label.localeCompare(b.label));

const isChoice = (f: LoanField) => f.kind === 'text' || f.kind === 'flag';
const shown = (v: CellOut, f: LoanField) => (f.kind === 'flag' ? (v ? 'Yes' : 'No') : v == null || isError(v) ? '' : String(v));
/** Decimals the report shows for a field; equality compares at that precision (0.00% → 4). */
const decimalsOf = (f: LoanField) => (f.fmt.split(';')[0].split('.')[1]?.match(/0/g)?.length ?? 0) + (f.kind === 'pct' ? 2 : 0);

function toSerial(iso: string): number | null {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5 : null;
}
const operand = (t: string, f: LoanField): number | null => {
  if (f.kind === 'date') return toSerial(t);
  const n = parseInput(t, f.kind);
  return typeof n === 'number' ? n : null;
};

const sqlName = (label: string) => `[${label}]`;
const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------- WHERE ----------

type Op = 'in' | 'notIn' | 'contains' | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between' | 'blank' | 'notBlank';
const OP_LABEL: Record<Op, string> = {
  in: 'is one of', notIn: 'is not one of', contains: 'contains', eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤',
  between: 'between', blank: 'is blank', notBlank: 'is not blank',
};
const SQL_OP: Partial<Record<Op, string>> = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' };
const CHOICE_OPS: Op[] = ['in', 'notIn', 'contains', 'blank', 'notBlank'];
const NUMBER_OPS: Op[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'blank', 'notBlank'];
const opsFor = (f: LoanField) => (isChoice(f) ? CHOICE_OPS : NUMBER_OPS);

interface Condition { id: number; label: string; op: Op; values: string[]; a: string; b: string }

let nextId = 1;
const newCondition = (label = 'Prop State'): Condition =>
  ({ id: nextId++, label, op: opsFor(FIELD_BY_LABEL[label])[0], values: [], a: '', b: '' });

/** A condition the user hasn't finished yet matches every loan (and is left out of the statement). */
function isComplete(c: Condition): boolean {
  const f = FIELD_BY_LABEL[c.label];
  if (c.op === 'blank' || c.op === 'notBlank') return true;
  if (c.op === 'in' || c.op === 'notIn') return c.values.length > 0;
  if (c.op === 'contains') return !!c.a.trim();
  return operand(c.a, f) !== null && (c.op !== 'between' || operand(c.b, f) !== null);
}

function matches(l: Loan, c: Condition): boolean {
  if (!isComplete(c)) return true;
  const f = FIELD_BY_LABEL[c.label];
  const v = l.values[f.col];
  const blank = v == null || v === '' || isError(v);
  if (c.op === 'blank') return blank;
  if (c.op === 'notBlank') return !blank;
  if (isChoice(f)) {
    const t = shown(v, f);
    if (c.op === 'contains') return t.toLowerCase().includes(c.a.trim().toLowerCase());
    return c.values.includes(t) === (c.op === 'in');
  }
  if (typeof v !== 'number') return false;
  const d = decimalsOf(f);
  const x = roundWith(v, d), y = roundWith(operand(c.a, f)!, d);
  switch (c.op) {
    case 'eq': return x === y;
    case 'ne': return x !== y;
    case 'gt': return x > y;
    case 'ge': return x >= y;
    case 'lt': return x < y;
    case 'le': return x <= y;
    case 'between': return x >= y && x <= roundWith(operand(c.b, f)!, d);
    default: return true;
  }
}

function conditionSql(c: Condition): string {
  const f = FIELD_BY_LABEL[c.label];
  const name = sqlName(c.label);
  const lit = (t: string) => pbiFormat(operand(t, f), f.fmt);
  switch (c.op) {
    case 'blank': return `${name} IS NULL`;
    case 'notBlank': return `${name} IS NOT NULL`;
    case 'contains': return `${name} LIKE ${sqlText(`%${c.a.trim()}%`)}`;
    case 'in': case 'notIn': return `${name} ${c.op === 'in' ? 'IN' : 'NOT IN'} (${c.values.map(sqlText).join(', ')})`;
    case 'between': return `${name} BETWEEN ${lit(c.a)} AND ${lit(c.b)}`;
    default: return `${name} ${SQL_OP[c.op]} ${lit(c.a)}`;
  }
}

// ---------- SET ----------

type Mode = 'set' | 'add' | 'scale' | 'reset';
const MODE_LABEL: Record<Mode, string> = { set: 'set to', add: 'add', scale: 'change by %', reset: 'reset to model value' };
const modesFor = (f: LoanField): Mode[] => (f.options || f.kind === 'flag' ? ['set', 'reset'] : ['set', 'add', 'scale', 'reset']);

interface Assignment { id: number; col: string; mode: Mode; value: string }
const newAssignment = (col: string): Assignment => ({ id: nextId++, col, mode: 'set', value: '' });

/** The typed amount: a value in the field's units, or a plain percentage for "change by %". */
function amount(a: Assignment, f: LoanField): number | string | null {
  if (a.mode === 'reset') return null;
  if (a.mode === 'set' && f.options) return a.value || null;
  if (a.mode === 'set' && f.kind === 'flag') return a.value === '' ? null : Number(a.value);
  if (a.mode === 'set' && f.kind === 'date') return toSerial(a.value);
  return parseInput(a.value, a.mode === 'scale' ? 'number' : f.kind);
}
const isReady = (a: Assignment) => a.mode === 'reset' || amount(a, FIELD_BY_COL[a.col]) !== null;

/** New value for one loan, or null when it can't be computed (e.g. adding to a blank cell). */
function nextValue(l: Loan, a: Assignment, f: LoanField): number | string | null {
  const n = amount(a, f);
  if (n === null || a.mode === 'set') return n;
  const cur = l.values[f.col];
  if (typeof cur !== 'number' || typeof n !== 'number') return null;
  return Number((a.mode === 'add' ? cur + n : cur * (1 + n / 100)).toPrecision(15));
}

function assignmentSql(a: Assignment): string {
  const f = FIELD_BY_COL[a.col];
  const name = sqlName(f.label);
  const n = amount(a, f);
  switch (a.mode) {
    case 'reset': return `${name} = <model value>`;
    case 'scale': return `${name} = ${name} * (1 ${Number(n) < 0 ? '-' : '+'} ${Math.abs(Number(n))}%)`;
    case 'add': return `${name} = ${name} + ${pbiFormat(n, f.fmt)}`;
    default: return `${name} = ${f.options ? sqlText(String(n)) : f.kind === 'flag' ? (n ? 'Yes' : 'No') : pbiFormat(n, f.fmt)}`;
  }
}

// ---------- UI ----------

const control = 'min-w-0 rounded-sm border border-input bg-card px-200 py-100 text-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const iconBtn = 'rounded-md p-200 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const ghostBtn = 'inline-flex items-center gap-100 rounded-md border border-visual-border px-300 py-100 text-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Labeled({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-100', className)}>
      <span className="text-200 font-bold text-foreground">{label}</span>
      {children}
    </label>
  );
}

const placeholderFor = (f: LoanField) =>
  f.kind === 'pct' ? 'e.g. 25 for 25%' : f.kind === 'money' ? 'e.g. 150000' : f.kind === 'multiple' ? 'e.g. 1.25' : 'Value';

function NumberInput({ label, field, value, onChange }: { label: string; field: LoanField; value: string; onChange: (v: string) => void }) {
  const invalid = value.trim() !== '' && operand(value, field) === null;
  return (
    <Labeled label={label} className="w-40">
      <input type={field.kind === 'date' ? 'date' : 'text'} inputMode="decimal" aria-invalid={invalid} value={value}
        placeholder={placeholderFor(field)} onChange={(e) => onChange(e.target.value)}
        className={cn(control, 'tabular-nums', invalid && 'border-destructive')} />
    </Labeled>
  );
}

/** Matching key for pasted values: case and spacing ignored, loan IDs with or without leading zeros. */
const pasteKey = (s: string) => s.trim().toLowerCase().replace(/^0+(?=\d)/, '');

/**
 * Adds many values at once: paste a list, one per line (as copied from an Excel column) or
 * separated by commas, semicolons or tabs. Spaces stay part of a value ("REO 71180").
 */
function PasteValues({ options, selected, onAdd }: { options: string[]; selected: string[]; onAdd: (values: string[]) => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const add = () => {
    const byKey = new Map(options.map((o) => [pasteKey(o), o]));
    const found: string[] = [];
    const missing: string[] = [];
    for (const t of text.split(/[\r\n,;\t]+/).map((s) => s.trim()).filter(Boolean)) {
      const o = byKey.get(pasteKey(t));
      if (o) found.push(o); else missing.push(t);
    }
    const next = [...new Set([...selected, ...found])];
    onAdd(next);
    setNote(`${next.length - selected.length} added`
      + (missing.length ? `; not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}` : ''));
    if (!missing.length) setText('');
  };
  return (
    <div className="flex w-64 flex-col gap-100">
      <Labeled label="Or paste a list">
        <textarea rows={3} value={text} placeholder={'One per line, e.g.\n2007400\n2007403'}
          onChange={(e) => { setText(e.target.value); setNote(null); }} className={cn(control, 'resize-y font-mono')} />
      </Labeled>
      <div className="flex items-center gap-200">
        <button type="button" className={ghostBtn} disabled={!text.trim()} onClick={add}>
          <Plus className="icon-size-200" /> Add pasted
        </button>
        {note && <span role="status" className="text-200 text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
}

function ConditionRow({ c, loans, onChange, onRemove }: {
  c: Condition; loans: Loan[]; onChange: (c: Condition) => void; onRemove: () => void;
}) {
  const f = FIELD_BY_LABEL[c.label];
  const options = useMemo(
    () => [...new Set(loans.map((l) => shown(l.values[f.col], f)).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [loans, f],
  );
  return (
    <li className="flex flex-wrap items-end gap-200">
      <Labeled label="Field" className="w-56">
        <select className={control} value={c.label} onChange={(e) => onChange({ ...newCondition(e.target.value), id: c.id })}>
          <optgroup label="Common">{COMMON.map((l) => <option key={l}>{l}</option>)}</optgroup>
          <optgroup label="Editable fields">{EDITABLE.map((x) => <option key={x.label}>{x.label}</option>)}</optgroup>
          <optgroup label="Other fields">{OTHER.map((x) => <option key={x.label}>{x.label}</option>)}</optgroup>
        </select>
      </Labeled>
      <Labeled label="Operator" className="w-36">
        <select className={control} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Op })}>
          {opsFor(f).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </select>
      </Labeled>
      {(c.op === 'in' || c.op === 'notIn') && (
        <div className="flex flex-col gap-200">
          <Slicer label="Values" className="w-64" options={options} selected={c.values} onChange={(values) => onChange({ ...c, values })} />
          <PasteValues options={options} selected={c.values} onAdd={(values) => onChange({ ...c, values })} />
        </div>
      )}
      {c.op === 'contains' && (
        <Labeled label="Text" className="w-48">
          <input className={control} value={c.a} onChange={(e) => onChange({ ...c, a: e.target.value })} />
        </Labeled>
      )}
      {NUMBER_OPS.includes(c.op) && c.op !== 'blank' && c.op !== 'notBlank' && (
        <NumberInput label={c.op === 'between' ? 'From' : 'Value'} field={f} value={c.a} onChange={(a) => onChange({ ...c, a })} />
      )}
      {c.op === 'between' && <NumberInput label="To" field={f} value={c.b} onChange={(b) => onChange({ ...c, b })} />}
      <button type="button" aria-label={`Remove condition on ${c.label}`} className={iconBtn} onClick={onRemove}>
        <Trash2 className="icon-size-200" />
      </button>
    </li>
  );
}

function AssignmentRow({ a, taken, onChange, onRemove }: {
  a: Assignment; taken: Set<string>; onChange: (a: Assignment) => void; onRemove: () => void;
}) {
  const f = FIELD_BY_COL[a.col];
  const modes = modesFor(f);
  const invalid = a.value.trim() !== '' && !isReady(a);
  return (
    <li className="flex flex-wrap items-end gap-200">
      <Labeled label="Field" className="w-56">
        <select className={control} value={a.col} onChange={(e) => onChange({ ...newAssignment(e.target.value), id: a.id })}>
          {EDITABLE.filter((x) => x.col === a.col || !taken.has(x.col)).map((x) => (
            <option key={x.col} value={x.col}>{x.label} ({x.col})</option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Action" className="w-44">
        <select className={control} value={a.mode} onChange={(e) => onChange({ ...a, mode: e.target.value as Mode, value: '' })}>
          {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
      </Labeled>
      {a.mode !== 'reset' && (
        <Labeled label={a.mode === 'scale' ? 'Change %' : f.kind === 'pct' ? 'Value (%)' : 'Value'} className="w-40">
          {a.mode === 'set' && (f.options || f.kind === 'flag') ? (
            <select className={control} value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })}>
              <option value="">Choose…</option>
              {f.options ? f.options.map((o) => <option key={o}>{o}</option>) : <><option value="1">Yes</option><option value="0">No</option></>}
            </select>
          ) : (
            <input type={a.mode === 'set' && f.kind === 'date' ? 'date' : 'text'} inputMode="decimal" aria-invalid={invalid} value={a.value}
              placeholder={a.mode === 'scale' ? 'e.g. 10 or -5' : placeholderFor(f)}
              onChange={(e) => onChange({ ...a, value: e.target.value })}
              className={cn(control, 'tabular-nums', invalid && 'border-destructive')} />
          )}
        </Labeled>
      )}
      <button type="button" aria-label={`Remove ${f.label}`} className={iconBtn} onClick={onRemove}>
        <Trash2 className="icon-size-200" />
      </button>
    </li>
  );
}

const th = 'border-b-2 border-visual-border px-200 py-100 align-bottom font-bold text-foreground';
const td = 'border-b border-visual-border/60 px-200 py-100 whitespace-nowrap';

export function EditFieldsPage({ snapshot, editing }: PageProps) {
  const [conditions, setConditions] = useState<Condition[]>(() => [newCondition()]);
  const [assignments, setAssignments] = useState<Assignment[]>(() => [newAssignment(FIELD_BY_LABEL.Fade?.col ?? EDITABLE[0].col)]);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [result, setResult] = useState<string | null>(null);

  const matching = useMemo(() => snapshot.loans.filter((l) => conditions.every((c) => matches(l, c))), [snapshot, conditions]);
  const targets = matching.filter((l) => !excluded.has(l.row));
  const ready = assignments.filter(isReady);
  const taken = new Set(assignments.map((a) => a.col));
  const targeted = new Set(ready.map((a) => a.col));

  const where = conditions.filter(isComplete).map(conditionSql);
  const unticked = matching.length - targets.length;
  const statement = [
    'UPDATE loans',
    ready.length ? `SET ${ready.map(assignmentSql).join(',\n    ')}` : 'SET …',
    where.length ? `WHERE ${where.join('\n  AND ')}` : '-- no conditions: every loan',
    ...(unticked ? [`-- excluding ${unticked} unticked loan${unticked === 1 ? '' : 's'}`] : []),
  ].join('\n');

  const update = <T extends { id: number }>(set: (fn: (xs: T[]) => T[]) => void, x: T) => set((xs) => xs.map((y) => (y.id === x.id ? x : y)));
  const toggleRow = (row: number) => setExcluded((s) => { const n = new Set(s); if (n.has(row)) n.delete(row); else n.add(row); return n; });
  const allTicked = targets.length === matching.length;

  const apply = async () => {
    const changes: CellChange[] = [], resets: CellRef[] = [];
    let skipped = 0;
    for (const l of targets) {
      for (const a of ready) {
        if (a.mode === 'reset') {
          if (editing.overrides.has(`${a.col}${l.row}`)) resets.push({ row: l.row, col: a.col });
          continue;
        }
        const v = nextValue(l, a, FIELD_BY_COL[a.col]);
        if (v === null) skipped++;
        else changes.push({ row: l.row, col: a.col, value: v });
      }
    }
    if (resets.length) await editing.onResetMany(resets);
    if (changes.length) await editing.onCommitMany(changes);
    const n = changes.length + resets.length;
    const touched = new Set([...changes, ...resets].map((c) => c.row)).size;
    setResult(`Updated ${n} value${n === 1 ? '' : 's'} on ${touched} loan${touched === 1 ? '' : 's'}.` +
      (skipped ? ` Skipped ${skipped} blank value${skipped === 1 ? '' : 's'} that couldn't be added to or scaled.` : ''));
  };

  return (
    <div className="flex flex-col gap-300 bg-card pb-300">
      <PageBanner title="Edit Fields" />
      <div className="flex flex-col gap-300 px-300">
        <div className="grid gap-300 xl:grid-cols-2">
          <VisualFrame title="1. Select loans (WHERE)" actions={
            <span className="text-200 text-muted-foreground">{matching.length} of {snapshot.loans.length} loans match</span>
          }>
            <p className="mb-200 text-200 text-muted-foreground">Loans must meet every condition. Leave a condition empty to ignore it.</p>
            <ul className="flex flex-col gap-300">
              {conditions.map((c) => (
                <ConditionRow key={c.id} c={c} loans={snapshot.loans} onChange={(x) => update(setConditions, x)}
                  onRemove={() => setConditions((cs) => cs.filter((y) => y.id !== c.id))} />
              ))}
            </ul>
            <div className="mt-300 flex flex-wrap gap-200">
              <button type="button" className={ghostBtn} onClick={() => setConditions((cs) => [...cs, newCondition()])}>
                <Plus className="icon-size-200" /> Add condition
              </button>
              {conditions.length > 0 && (
                <button type="button" className={ghostBtn} onClick={() => { setConditions([]); setExcluded(new Set()); }}>Clear conditions</button>
              )}
            </div>
          </VisualFrame>

          <VisualFrame title="2. Set values (SET)">
            <p className="mb-200 text-200 text-muted-foreground">
              Percent fields take percentages (25 = 25%). “Change by %” scales the current value (10 = +10%).
            </p>
            <ul className="flex flex-col gap-300">
              {assignments.map((a) => (
                <AssignmentRow key={a.id} a={a} taken={taken} onChange={(x) => update(setAssignments, x)}
                  onRemove={() => setAssignments((as) => as.filter((y) => y.id !== a.id))} />
              ))}
            </ul>
            {taken.size < EDITABLE.length && (
              <button type="button" className={cn(ghostBtn, 'mt-300')}
                onClick={() => setAssignments((as) => [...as, newAssignment(EDITABLE.find((x) => !taken.has(x.col))!.col)])}>
                <Plus className="icon-size-200" /> Add field
              </button>
            )}
          </VisualFrame>
        </div>

        <VisualFrame title="3. Review and apply">
          <div className="flex flex-col gap-300 lg:flex-row lg:items-end">
            <pre aria-label="Update statement" className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-300 font-monospace text-200 leading-300">{statement}</pre>
            <div className="flex flex-col items-stretch gap-200 lg:w-64">
              <button type="button" disabled={editing.busy || !targets.length || !ready.length} onClick={() => void apply()}
                className="inline-flex items-center justify-center rounded-2xl bg-action px-400 py-200 text-300 font-semibold text-action-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                Apply to {targets.length} loan{targets.length === 1 ? '' : 's'}
              </button>
              <p aria-live="polite" className="text-200 text-muted-foreground">{result}</p>
            </div>
          </div>
        </VisualFrame>

        <VisualFrame title={`Editable fields · ${matching.length} matching loan${matching.length === 1 ? '' : 's'}`}>
          {matching.length ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-200">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th scope="col" className={cn(th, 'sticky left-0 z-10 bg-card text-left')}>
                      <label className="inline-flex items-center gap-200">
                        <input type="checkbox" checked={allTicked} aria-label="Include all matching loans"
                          ref={(el) => { if (el) el.indeterminate = !allTicked && targets.length > 0; }}
                          onChange={() => setExcluded(allTicked ? new Set(matching.map((l) => l.row)) : new Set())} />
                        Loan ID
                      </label>
                    </th>
                    {EDITABLE.map((f) => (
                      <th key={f.col} scope="col" title={`Model!${f.col}`}
                        className={cn(th, isChoice(f) ? 'text-left' : 'text-right', targeted.has(f.col) && 'bg-override text-override-foreground')}>
                        <span className="inline-block max-w-32 whitespace-normal text-balance">{f.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matching.map((l) => {
                    const on = !excluded.has(l.row);
                    return (
                      <tr key={l.row} className={cn('hover:bg-hover', !on && 'text-muted-foreground')}>
                        <td className={cn(td, 'sticky left-0 bg-card')}>
                          <span className="inline-flex items-center gap-200">
                            <input type="checkbox" checked={on} aria-label={`Include loan ${String(l.values.A ?? '')}`} onChange={() => toggleRow(l.row)} />
                            <button type="button" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => editing.onOpenLoan(l.row)}>{String(l.values.A ?? '')}</button>
                          </span>
                        </td>
                        {EDITABLE.map((f) => (
                          <td key={f.col} className={cn(td, !isChoice(f) && 'text-right tabular-nums')}>
                            <EditableValue field={f} value={l.values[f.col]} override={editing.overrides.get(`${f.col}${l.row}`)} disabled={editing.busy}
                              align={isChoice(f) ? 'left' : 'right'}
                              onCommit={(value) => editing.onCommit(l.row, f.col, value)}
                              onReset={() => editing.onReset(l.row, f.col)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="py-800 text-center text-300 text-muted-foreground">No loans match these conditions.</p>}
        </VisualFrame>
      </div>
    </div>
  );
}
