// Export to Excel: one sheet per Home page section (Model Output, DCF - Perf, DCF - Payoff,
// DCF - REO, DCF - NPL), holding the loans the Home page shows, laid out and coloured as the Home
// tables are (after the Model sheet): the Average and Total rows above the header, each column's
// Excel number format, the sheet's colours and conditional formats, and the edited cells. The DCF
// sheets end with the scenario's monthly cash flows.

import type { Cell } from 'exceljs';

import { isError, type CellOut, type Snapshot } from '@/engine/protocol';
import { FIELD_BY_LABEL } from '@/engine/model-schema';
import { cellOf, fmtOf, sheetFormat } from '@/report/home-cells';
import { SECTIONS } from '@/report/home-sections';
import type { Loan } from '@/report/measures';
import { columnStyle, loanSheetStyle, sheetContext, type SheetContext, type SheetStyle } from '@/report/sheet-style';

export interface HomeExport {
  /** The loans as the Home page shows them (its filters and ticked files applied). */
  loans: Loan[];
  /** The calculated model each loan comes from (its file's), for the sheet's colours. */
  snapshotOf: (l: Loan) => Snapshot;
  /** The sheet's Average and Total rows, when one file is shown. */
  summary?: NonNullable<Snapshot['summary']>;
  /** The model's own file, when several files are shown: adds a File Name column. */
  fileColumn?: string;
  /** Names the download. */
  title: string;
}

const MONTHS = 36;
const CF_FMT = '#,##0;(#,##0)';
/** Power BI format strings -> Excel number formats, for columns the Model sheet leaves at General. */
const excelFmt = (fmt: string) => (fmt.startsWith('#,##0.00') ? '#,##0.00;[Red]-#,##0.00' : fmt);
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

function paint(cell: Cell, style: SheetStyle | undefined, bold = false) {
  cell.font = {
    name: 'Calibri', size: 10, bold: style?.bold || bold, italic: style?.italic,
    ...(style?.color && { color: { argb: argb(style.color) } }),
  };
  if (style?.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(style.fill) } };
}

/** A value as Excel stores it: numbers and text as they are, errors as their code. */
const stored = (v: CellOut): string | number | boolean | null => (v == null ? null : isError(v) ? v.error : v);

export async function exportToExcel(x: HomeExport): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const contexts = new Map<Snapshot, SheetContext>();
  const contextOf = (l: Loan) => {
    const s = x.snapshotOf(l);
    let c = contexts.get(s);
    if (!c) contexts.set(s, c = sheetContext(s));
    return c;
  };

  for (const section of SECTIONS) {
    const ws = wb.addWorksheet(section.label);
    const labels = section.columns as readonly string[];
    const scenario = 'scenario' in section ? section.scenario : null;
    const withFile = x.fileColumn !== undefined;
    // Columns: the section's, with File Name after Loan ID when several files are shown, then the months.
    const cols = labels.flatMap((label, i) => [{ label, file: false }, ...(i === 0 && withFile ? [{ label: 'File Name', file: true }] : [])]);
    const monthStart = cols.length + 1;
    ws.columns = [
      ...cols.map((c) => ({ width: c.file ? 32 : c.label === 'Loan ID' ? 15 : Math.max(10, Math.min(22, c.label.length + 3)) })),
      ...(scenario ? Array.from({ length: MONTHS }, () => ({ width: 10 })) : []),
    ];

    let r = 1;
    if (x.summary) {
      for (const kind of ['average', 'total'] as const) {
        const row = ws.getRow(r++);
        cols.forEach((c, j) => {
          const cell = row.getCell(j + 1);
          const f = FIELD_BY_LABEL[c.label];
          if (j === 0) {
            cell.value = kind === 'total' ? 'Total' : 'Average';
            paint(cell, columnStyle(f?.col, kind));
            return;
          }
          const v = f ? x.summary![kind][f.col] : null;
          if (v != null && v !== '' && !isError(v) && !(typeof v === 'number' && !Number.isFinite(v))) {
            cell.value = v;
            const nf = sheetFormat(c.label, kind) || excelFmt(fmtOf(c.label));
            if (nf) cell.numFmt = nf;
          }
          paint(cell, columnStyle(f?.col, kind));
        });
      }
    }

    const headerRow = r++;
    const head = ws.getRow(headerRow);
    head.height = 42;
    cols.forEach((c, j) => {
      const cell = head.getCell(j + 1);
      cell.value = c.label;
      paint(cell, columnStyle(FIELD_BY_LABEL[c.file ? 'Loan ID' : c.label]?.col, 'header'));
      cell.alignment = { vertical: 'bottom', wrapText: true, horizontal: fmtOf(c.file ? 'Loan ID' : c.label) ? 'right' : 'left' };
      cell.border = { bottom: { style: 'thin' } };
    });
    if (scenario) {
      for (let m = 0; m < MONTHS; m++) {
        const cell = head.getCell(monthStart + m);
        cell.value = m + 1;
        paint(cell, undefined);
        cell.alignment = { vertical: 'bottom', horizontal: 'center' };
        cell.border = { bottom: { style: 'thin' }, ...(m === 0 && { left: { style: 'thin' } }) };
      }
    }

    for (const l of x.loans) {
      const row = ws.getRow(r++);
      cols.forEach((c, j) => {
        const cell = row.getCell(j + 1);
        if (c.file) {
          cell.value = l.file ?? x.fileColumn ?? '';
          paint(cell, undefined);
          return;
        }
        const f = FIELD_BY_LABEL[c.label];
        cell.value = stored(cellOf(l, c.label));
        const nf = sheetFormat(c.label) || excelFmt(fmtOf(c.label));
        if (nf && typeof cell.value === 'number') cell.numFmt = nf;
        paint(cell, loanSheetStyle(f?.col, l, contextOf(l)));
      });
      if (scenario) {
        l.strips[scenario].slice(0, MONTHS).forEach((v, m) => {
          const cell = row.getCell(monthStart + m);
          if (v) { cell.value = v; cell.numFmt = CF_FMT; }
          paint(cell, undefined);
          if (m === 0) cell.border = { left: { style: 'thin' } };
        });
      }
    }

    ws.views = [{ state: 'frozen', xSplit: withFile ? 2 : 1, ySplit: headerRow }];
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length + (scenario ? MONTHS : 0) } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${x.title.replace(/[\\/:*?"<>|]/g, '-')} - Home.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
