import { RotateCcw } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import type { LoanField } from '@/engine/model-schema';
import type { CellOut, Override } from '@/engine/protocol';
import { editText, parseInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { pbiFormat } from '@/report/format';

interface EditableValueProps {
  field: LoanField;
  value: CellOut;
  override?: Override;
  disabled?: boolean;
  align?: 'left' | 'right';
  onCommit: (value: number | string) => void;
  onReset: () => void;
  /** How the value is shown; the report's format by default. */
  format?: (value: CellOut) => string;
}

/** A model value that turns into an input on click; overridden values are highlighted. */
export function EditableValue({ field, value, override, disabled, align = 'right', onCommit, onReset, format }: EditableValueProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const show = format ?? ((v: CellOut) => pbiFormat(v, field.fmt));
  const display = show(value) || '–';
  const title = override ? `Model value: ${show(override.modelValue) || '–'}` : `Click to override ${field.label}`;

  const commit = (text: string) => {
    const parsed = parseInput(text, field.kind);
    if (parsed === null) { setInvalid(true); return; }
    setDraft(null);
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { setDraft(null); setInvalid(false); }
    if (e.key === 'Enter' && draft !== null) commit(draft);
  };

  if (draft !== null && (field.options || field.kind === 'flag')) {
    const options = field.options ?? ['0', '1'];
    return (
      <select
        autoFocus
        aria-label={field.label}
        className="w-full rounded-md border border-ring bg-background px-100 py-100-nudge text-200"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={onKey}
      >
        {options.map((o) => (
          <option key={o} value={o}>{field.kind === 'flag' ? (o === '1' ? 'Yes' : 'No') : o}</option>
        ))}
      </select>
    );
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        aria-label={field.label}
        aria-invalid={invalid}
        className={cn(
          'w-full min-w-0 rounded-md border bg-background px-100 py-100-nudge text-200 tabular-nums outline-none',
          align === 'right' && 'text-right',
          invalid ? 'border-destructive' : 'border-ring',
        )}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onBlur={() => commit(draft)}
        onKeyDown={onKey}
        onFocus={(e) => e.target.select()}
      />
    );
  }

  return (
    <span className={cn('group/ev flex items-center gap-100', align === 'right' ? 'justify-end' : 'justify-start')}>
      {override && (
        <button
          type="button"
          title="Reset to model value"
          aria-label={`Reset ${field.label} to model value`}
          className="rounded-sm p-100-nudge text-override-foreground opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onReset(); }}
        >
          <RotateCcw className="icon-size-100" />
        </button>
      )}
      <button
        type="button"
        title={title}
        disabled={disabled}
        className={cn(
          'rounded-md px-100 py-100-nudge tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait',
          override && 'bg-override font-semibold text-override-foreground hover:bg-override',
        )}
        onClick={(e) => { e.stopPropagation(); setDraft(field.kind === 'flag' ? String(value ? 1 : 0) : editText(value, field.kind)); }}
      >
        {display}
      </button>
    </span>
  );
}
