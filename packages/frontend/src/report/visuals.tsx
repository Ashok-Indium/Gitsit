// Report building blocks styled after the GITSITFINAL Power BI report: white visual containers
// with a #D9DEE7 border and 6px radius, #1F3864 bold titles, dropdown slicers and card groups.

import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import logo from '@/assets/gitsit-logo.jpg';
import { cn } from '@/lib/utils';

export function VisualFrame({ title, className, actions, children }: {
  title?: string;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-visual-border bg-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-300 px-300 pt-200">
          {title && <h2 className="text-400 font-bold text-title">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1 p-300 pt-200">{children}</div>
    </section>
  );
}

/** Logo, white wedge and navy banner across the top of the home and distribution pages. */
export function PageBanner({ title }: { title: string }) {
  return (
    <div className="relative flex h-[77px] items-stretch overflow-hidden bg-banner">
      <div className="flex w-[233px] shrink-0 items-center bg-white px-200">
        <img src={logo} alt="GITSIT" className="max-h-full w-full object-contain" />
      </div>
      <svg aria-hidden viewBox="0 0 85 76" preserveAspectRatio="none" className="h-full w-[85px] shrink-0 fill-white">
        <polygon points="0,0 85,38 0,76" />
      </svg>
      <h1 className="flex flex-1 items-center justify-center px-400 text-center text-500 font-bold leading-500 text-banner-foreground md:text-hero-800 md:leading-hero-800">
        {title}
      </h1>
    </div>
  );
}

export interface CardItem {
  label: string;
  value: string;
  title?: string;
}

/** A Power BI "card (new)" with several callout values side by side. */
export function CardGroup({ title, items, className }: { title: string; items: CardItem[]; className?: string }) {
  return (
    <VisualFrame title={title} className={className}>
      <dl className="grid grid-cols-2 gap-x-400 gap-y-300 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col items-center justify-center text-center" title={i.title}>
            <dd className="order-1 font-numeric text-600 font-semibold leading-600 tabular-nums text-title">{i.value}</dd>
            <dt className="order-2 text-200 text-muted-foreground">{i.label}</dt>
          </div>
        ))}
      </dl>
    </VisualFrame>
  );
}

/** Dropdown slicer with multi-select (Ctrl-click not required) and search for long lists. */
export function Slicer({ label, options, selected, onChange, className }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = useMemo(() => options.filter((o) => o.toLowerCase().includes(query.toLowerCase())), [options, query]);
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : 'Multiple selections';
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);

  return (
    <div ref={ref} className={cn('relative flex min-w-0 flex-col gap-100', className)}>
      <span className="text-200 font-bold text-foreground">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex items-center justify-between gap-200 rounded-sm border border-input bg-card px-200 py-100 text-left text-300 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="icon-size-200 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full z-30 mt-100 w-full min-w-56 rounded-sm border border-border bg-popover p-100 shadow-lg">
          {options.length > 8 && (
            <label className="mb-100 flex items-center gap-200 border-b border-border px-200 pb-100">
              <Search className="icon-size-200 text-muted-foreground" />
              <input
                autoFocus
                aria-label={`Search ${label}`}
                className="w-full bg-transparent py-100 text-300 outline-none"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <ul id={listId} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto">
            <SlicerOption label="Select all" checked={selected.length === 0} onClick={() => onChange([])} />
            {shown.map((o) => (
              <SlicerOption key={o} label={o} checked={selected.includes(o)} onClick={() => toggle(o)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface InputFileOption {
  name: string;
  loans: number;
}

/** Single-choice slicer for the input file (File_Name) the model is built from. */
export function FileSlicer({ files, value, onChange, disabled, className, label = 'File Name' }: {
  files: InputFileOption[];
  value: string | null;
  onChange: (name: string) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className={cn('relative flex min-w-0 flex-col gap-100', className)}>
      <label htmlFor={id} className="text-200 font-bold text-foreground">{label}</label>
      <div className="relative">
        <select id={id} value={value ?? ''} disabled={disabled || !files.length} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none truncate rounded-sm border border-input bg-card py-100 pl-200 pr-600 text-300 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
          {files.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.loans} loans)</option>)}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-200 top-1/2 icon-size-200 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

function SlicerOption({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <li role="option" aria-selected={checked}>
      <button type="button" onClick={onClick}
        className="flex w-full items-center gap-200 rounded-sm px-200 py-100 text-left text-300 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className={cn('flex icon-size-200 shrink-0 items-center justify-center rounded-sm border', checked ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground')}>
          {checked && <Check className="icon-size-100" />}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}
