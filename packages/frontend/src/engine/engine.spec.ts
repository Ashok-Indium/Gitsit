// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HyperFormula } from 'hyperformula';
import { beforeAll, describe, expect, it } from 'vitest';

import { CONSTRAINT_BY_INDEX, CONSTRAINT_FIELDS, constraintCell, writeConstants } from './constraint-fields.ts';
import { EXCEL_CONFIG, excelText, registerExcelFunctions, roundWith } from './excel-functions.ts';
import type { Constants } from './protocol.ts';
import { parseAddress, translateFormula } from './formula-text.ts';
import { loadInput, loanKey, type InputRow } from './load-input.ts';
import { dependsOnHiddenRows, rewriteWorkbook } from './rewrite.ts';
import { expandSheet, type ModelTemplate } from './template.ts';

describe('Excel compatibility helpers', () => {
  it('rounds like Excel (15 significant digits first)', () => {
    expect(roundWith((0.1 / 12) * 23747.4, 2)).toBe(197.9);
    expect(roundWith(-2.5, 0)).toBe(-3);
    expect(roundWith(146321, -3)).toBe(146000);
    expect(roundWith(0.115, 2, 'down')).toBe(0.11);
  });

  it('formats TEXT() patterns used by the model', () => {
    expect(excelText(76, '000')).toBe('076');
    expect(excelText(34, '#,###')).toBe('34');
    expect(excelText(68261.4, '#,##0')).toBe('68,261');
    expect(excelText(0.0474, '0%')).toBe('5%');
    expect(excelText(2.5677952, '$0.0')).toBe('$2.6');
    expect(excelText(1.1777, '0.00x')).toBe('1.18x');
    expect(excelText(45940, 'mmm-yy')).toBe('Oct-25');
  });

  it('shifts relative references but not text inside strings', () => {
    expect(translateFormula('IF(AX11=1,"b) D30"&$A$1,EXIT!$T$6+B11)', 4, 0)).toBe('IF(AX15=1,"b) D30"&$A$1,EXIT!$T$6+B15)');
    expect(translateFormula('LOG10(A1)', 1, 1)).toBe('LOG10(B2)');
  });

  it('rewrites OFFSET lookups and named ranges', () => {
    const sheets = { Model: [['=OFFSET(EXIT!$T$6,MATCH(A1,EXIT!$T$7:$T$16,1),MATCH(B1,EXIT!$U$6:$AH$6,1))+SUM(arrears)']] };
    rewriteWorkbook(sheets, [{ name: 'arrears', ref: 'Model!$S$11:$S$61' }]);
    expect(sheets.Model[0][0]).toBe(
      '=INDEX(EXIT!$T$6:$AH$16,(MATCH(A1,EXIT!$T$7:$T$16,1))+1,(MATCH(B1,EXIT!$U$6:$AH$6,1))+1)+SUM(Model!$S$11:$S$61)');
  });
});

const template: ModelTemplate = JSON.parse(readFileSync(resolve(import.meta.dirname, 'generated/model-template.json'), 'utf8'));
const tapeRows: InputRow[] = JSON.parse(readFileSync(resolve(import.meta.dirname, '../store/generated/input-rows.json'), 'utf8'));

/** Builds the model the way the engine worker does, from Input_table-shaped rows and model constants. */
function buildModel(rows: InputRow[], constants?: Constants) {
  const sheets = Object.fromEntries(template.sheetOrder.map((n) => [n, expandSheet(template.sheets[n])]));
  writeConstants(sheets.Model, constants);
  const loaded = loadInput(sheets.Model, template, rows);
  rewriteWorkbook(sheets, template.names, { Model: loaded.hiddenRows }, dependsOnHiddenRows);
  registerExcelFunctions();
  const hf = HyperFormula.buildFromSheets(sheets as never, EXCEL_CONFIG);
  const sheet = hf.getSheetId('Model')!;
  const cell = (a: string) => { const { row, col } = parseAddress(a); return hf.getCellValue({ sheet, row, col }); };
  /** Bid by loan ID. */
  const bids = new Map(loaded.loanRows.map((r) => [loanKey(cell(`A${r}`)), cell(`CF${r}`) as number]));
  return { hf, sheet, cell, bids, loaded };
}

describe('model loaded from the input tape', () => {
  let base: ReturnType<typeof buildModel>;
  beforeAll(() => { base = buildModel(tapeRows); }, 60_000);

  it('reproduces the pool totals Excel saved in the workbook', () => {
    expect(base.loaded.loanRows).toHaveLength(33);
    expect(base.cell('CF9')).toBeCloseTo(2567795.2, 2); // Bid
    expect(base.cell('CG9')).toBeCloseTo(2811119.4733805, 4); // Gross proceeds
    expect(base.cell('CK9')).toBeCloseTo(10.6312996673695, 8); // Months
    expect(base.cell('CL9')).toBeCloseTo(0.20059278457545, 10); // Gross IRR
    expect(base.cell('CC16')).toBe(1.3); // loan 2008091 keeps its own NPL hurdle
  });

  it('recalculates dependents when a value is overridden', () => {
    const { hf, sheet, cell } = base;
    const at = parseAddress('AK17');
    const formula = hf.getCellFormula({ sheet, ...at })!;
    const before = cell('CF9') as number;
    hf.setCellContents({ sheet, ...at }, [[2000000]]);
    expect(cell('AK9')).toBeCloseTo(10651000 - 3454000 + 2000000, 0);
    expect(cell('CF9')).not.toBeCloseTo(before, 0);
    hf.setCellContents({ sheet, ...at }, [[formula]]);
    expect(cell('CF9')).toBeCloseTo(before, 6);
  });

  it('gives every loan the same results whatever order the rows arrive in', () => {
    const shuffled = buildModel([...tapeRows].reverse());
    expect(shuffled.cell('CF9')).toBeCloseTo(base.cell('CF9') as number, 6);
    for (const [id, bid] of base.bids) expect(shuffled.bids.get(id)).toBeCloseTo(bid, 6);
    expect(shuffled.cell(`CC${shuffled.loaded.loanRows[shuffled.loaded.loanRows.length - 6]}`)).toBe(1.3);
  }, 60_000);

  it('adds new loans to the pool totals', () => {
    const extra = tapeRows.slice(0, 5).map((r, i) => ({ ...r, loan_id: `NEW-${i + 1}` }));
    const more = buildModel([...tapeRows, ...extra]);
    expect(more.loaded.loanRows).toHaveLength(38);
    const added = tapeRows.slice(0, 5).reduce((s, r) => s + base.bids.get(loanKey(r.loan_id))!, 0);
    expect(more.cell('CF9')).toBeCloseTo((base.cell('CF9') as number) + added, 1);
    expect(more.bids.get('NEW-1')).toBeCloseTo(base.bids.get(loanKey(tapeRows[0].loan_id))!, 6);
  }, 60_000);

  it('drops loans that are no longer in the input', () => {
    const fewer = buildModel(tapeRows.slice(0, 20));
    expect(fewer.loaded.hiddenRows).toHaveLength(28);
    const kept = tapeRows.slice(0, 20).reduce((s, r) => s + base.bids.get(loanKey(r.loan_id))!, 0);
    expect(fewer.cell('CF9')).toBeCloseTo(kept, 1); // cents of rounding
  }, 60_000);

  it('gives the model its own values when every constant is at the Model sheet value', () => {
    const defaults: Record<string, string> = JSON.parse(readFileSync(resolve(import.meta.dirname, 'generated/constraint-defaults.json'), 'utf8'));
    const all: Constants = Object.fromEntries(CONSTRAINT_FIELDS.map((f) => [f.cell, constraintCell(f, defaults[f.index])!]));
    expect(Object.keys(all)).toHaveLength(CONSTRAINT_FIELDS.length);
    const same = buildModel(tapeRows, all);
    for (const a of ['CF9', 'CG9', 'CK9', 'CL9']) expect(same.cell(a)).toBeCloseTo(base.cell(a) as number, 6);
    for (const [id, bid] of base.bids) expect(same.bids.get(id)).toBeCloseTo(bid, 6);
    for (const r of base.loaded.loanRows) for (const c of ['AFR', 'AFV']) expect(same.cell(`${c}${r}`)).toBe(base.cell(`${c}${r}`));
  }, 60_000);

  it('recalculates with changed constants, including ones the workbook types into formulas', () => {
    const cell = (index: string) => CONSTRAINT_BY_INDEX.get(index)!.cell;
    const hurdle = buildModel(tapeRows, { [cell('hurdle_npl')]: 1.5 });
    expect(hurdle.cell('CF9')).toBeLessThan(base.cell('CF9') as number);
    // Every loan's REO preservation cost uses the high-value amount once the line is above every BPO.
    const ppres = buildModel(tapeRows, { [cell('reo_ppress_constant')]: 1e9 });
    for (const r of ppres.loaded.loanRows) expect(ppres.cell(`AFR${r}`)).toBe(-3600);
    expect(base.loaded.loanRows.some((r) => base.cell(`AFR${r}`) === -9000)).toBe(true);
  }, 60_000);

  it('reports loans beyond the 48 the model holds', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...tapeRows[i % 33], loan_id: `L${i}` }));
    const sheets = Object.fromEntries(template.sheetOrder.map((n) => [n, expandSheet(template.sheets[n])]));
    expect(loadInput(sheets.Model, template, many).dropped).toEqual(['L48', 'L49']);
  });
});
