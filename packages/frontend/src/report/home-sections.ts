// The Home page's related-report links, Model Output / DCF sections, and the slicer filtering.

import type { Snapshot } from '@/engine/protocol';
import { REPORT_TABLES } from '@/engine/report-fields';

import { text, type Loan } from './measures';
import type { SheetSummary } from './tables';

export type Filters = Record<string, string[]>;

export const applyFilters = (loans: Loan[], f: Filters) =>
  loans.filter((l) => Object.entries(f).every(([col, sel]) => !sel.length || sel.includes(text(l, col))));

export const optionsOf = (loans: Loan[], col: string) =>
  [...new Set(loans.map((l) => text(l, col)).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export const LINKS = [
  { label: 'Dynamic Fields', href: 'https://app.fabric.microsoft.com/groups/eb6edf16-f039-4e9e-8d96-75b35e6baeba/reports/0ad31c42-bf51-43fc-84f3-1e7593c6ee04?ctid=0241c0ff-4d5c-47ce-a1fa-a6d7a6adfcdf&pbi_source=linkShare&bookmarkGuid=9ecab3c1-b683-4e2f-baa3-6f1c294efd75' },
  { label: 'Constants', href: 'https://app.fabric.microsoft.com/groups/eb6edf16-f039-4e9e-8d96-75b35e6baeba/reports/0ad31c42-bf51-43fc-84f3-1e7593c6ee04?ctid=0241c0ff-4d5c-47ce-a1fa-a6d7a6adfcdf&pbi_source=linkShare&bookmarkGuid=9ecab3c1-b683-4e2f-baa3-6f1c294efd75' },
  { label: 'Manuals', href: 'https://indiumsoft.sharepoint.com/:f:/r/sites/GITSITTeam/Shared%20Documents/General/Manuals?csf=1&web=1&e=3c3vmU' },
  { label: 'Power Apps', href: 'https://apps.powerapps.com/play/e/default-0241c0ff-4d5c-47ce-a1fa-a6d7a6adfcdf/a/fc11bbe1-2c33-4653-a4ba-91b24225d796?tenantId=0241c0ff-4d5c-47ce-a1fa-a6d7a6adfcdf&hint=3fdbd17b-122f-41a2-aa1a-c3334fe89d3c&sourcetime=1758001936426&source=portal' },
];

export const SECTIONS = [
  { id: 'output', label: 'Model Output', columns: REPORT_TABLES.modelOutput },
  { id: 'perf', label: 'DCF - Perf', columns: REPORT_TABLES.dcfPerf, scenario: 'Perf' },
  { id: 'payoff', label: 'DCF - Payoff', columns: REPORT_TABLES.dcfPayoff, scenario: 'Payoff' },
  { id: 'reo', label: 'DCF - REO', columns: REPORT_TABLES.dcfReo, scenario: 'REO' },
  { id: 'npl', label: 'DCF - NPL', columns: REPORT_TABLES.dcfNpl, scenario: 'NPL' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * The Model sheet's Average and Total rows for the Home tables. They are the sheet's own
 * calculations over every loan in the file, so with filters on they are labelled as such.
 */
export function sheetSummary(snapshot: Snapshot, shown: number): SheetSummary | undefined {
  if (!snapshot.summary) return undefined;
  const all = snapshot.loans.length;
  return { values: snapshot.summary, note: shown < all ? `all ${all} loans` : undefined };
}

/** Every column of the Home page's sections in one list, in section order, each column once. */
export const ALL_SECTION_COLUMNS: readonly string[] = [...new Set(SECTIONS.flatMap((s) => s.columns as readonly string[]))];
