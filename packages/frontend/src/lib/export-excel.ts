import { FIELD_BY_COL, LOAN_FIELDS } from '@/engine/model-schema';
import { isError, type CellOut, type Snapshot } from '@/engine/protocol';
import { ASSUMPTIONS } from '@/engine/assumptions';
import { MEASURES } from '@/report/measures';

/** Power BI format strings -> Excel number formats. */
const numFmt = (fmt: string) => (fmt.startsWith('#,##0.00') ? '#,##0.00;[Red]-#,##0.00' : fmt || undefined);
const cellValue = (v: CellOut) => (isError(v) ? v.error : v);

/** Download the recalculated loans, pool measures, assumptions and the list of overrides as .xlsx. */
export async function exportToExcel(snapshot: Snapshot, sourceTape: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const loans = wb.addWorksheet('Model Output', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  loans.columns = LOAN_FIELDS.map((f) => ({
    header: f.label, key: f.label, width: Math.max(12, Math.min(28, f.label.length + 2)),
    style: numFmt(f.fmt) ? { numFmt: numFmt(f.fmt) } : {},
  }));
  loans.getRow(1).font = { bold: true };
  const overridden = new Set(snapshot.overrides.map((o) => `${o.col}${o.row}`));
  for (const loan of snapshot.loans) {
    const row = loans.addRow(Object.fromEntries(LOAN_FIELDS.map((f) => [f.label, cellValue(loan.values[f.col])])));
    LOAN_FIELDS.forEach((f, j) => {
      if (overridden.has(`${f.col}${loan.row}`)) row.getCell(j + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CE' } };
    });
  }

  const pool = wb.addWorksheet('Pool Measures');
  pool.columns = [{ header: 'Measure', key: 'name', width: 28 }, { header: 'Value', key: 'value', width: 18 }];
  pool.getRow(1).font = { bold: true };
  for (const m of Object.values(MEASURES)) {
    const row = pool.addRow({ name: m.name, value: m.calc(snapshot.loans) });
    row.getCell(2).numFmt = m.fmt;
  }

  const as = wb.addWorksheet('Assumptions');
  as.columns = [
    { header: 'Parameter', key: 'p', width: 34 }, { header: 'Value', key: 'v', width: 14 },
    { header: 'Excel Cell', key: 'c', width: 12 }, { header: 'Description', key: 'd', width: 60 },
  ];
  as.getRow(1).font = { bold: true };
  for (const a of ASSUMPTIONS) as.addRow({ p: a.parameter, v: cellValue(snapshot.assumptions[a.cell] ?? a.reportValue), c: `Model!${a.cell}`, d: a.description });

  const ov = wb.addWorksheet('Overrides');
  ov.columns = [
    { header: 'Loan ID', key: 'loan', width: 16 }, { header: 'Field', key: 'field', width: 22 },
    { header: 'Model cell', key: 'cell', width: 12 }, { header: 'Model value', key: 'model', width: 16 }, { header: 'Override', key: 'value', width: 16 },
  ];
  ov.getRow(1).font = { bold: true };
  const idByRow = new Map(snapshot.loans.map((l) => [l.row, l.values.A]));
  for (const o of snapshot.overrides) {
    const f = FIELD_BY_COL[o.col];
    const row = ov.addRow({ loan: idByRow.get(o.row), field: f.label, cell: `Model!${o.col}${o.row}`, model: cellValue(o.modelValue), value: o.value });
    const nf = numFmt(f.fmt);
    if (nf) { row.getCell(4).numFmt = nf; row.getCell(5).numFmt = nf; }
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sourceTape.replace(/\.xlsx$/i, '')} - recalculated.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
