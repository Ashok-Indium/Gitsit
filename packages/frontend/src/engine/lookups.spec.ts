// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';

import { EXCEL_CONFIG, registerExcelFunctions } from './excel-functions.ts';
import { parseAddress } from './formula-text.ts';
import { loadInput, type InputRow } from './load-input.ts';
import { applyLookups, type Lookups } from './lookups.ts';
import { dependsOnHiddenRows, rewriteWorkbook, type Cell } from './rewrite.ts';
import { expandSheet, type ModelTemplate } from './template.ts';

const template: ModelTemplate = JSON.parse(readFileSync(resolve(import.meta.dirname, 'generated/model-template.json'), 'utf8'));
const tapeRows: InputRow[] = JSON.parse(readFileSync(resolve(import.meta.dirname, '../store/generated/input-rows.json'), 'utf8'));
const workbookLookups: Lookups = JSON.parse(readFileSync(resolve(import.meta.dirname, '../store/generated/lookup-rows.json'), 'utf8'));

const sheetsOf = () => Object.fromEntries(template.sheetOrder.map((n) => [n, expandSheet(template.sheets[n])])) as Record<string, Cell[][]>;

/** Pool bid (Model!CF9) with the given lookup rows written in. */
function poolBid(lookups?: Lookups) {
  const sheets = sheetsOf();
  applyLookups(sheets, lookups);
  const loaded = loadInput(sheets.Model, template, tapeRows);
  rewriteWorkbook(sheets, template.names, { Model: loaded.hiddenRows }, dependsOnHiddenRows);
  registerExcelFunctions();
  const hf = HyperFormula.buildFromSheets(sheets as never, EXCEL_CONFIG);
  const { row, col } = parseAddress('CF9');
  return hf.getCellValue({ sheet: hf.getSheetId('Model')!, row, col }) as number;
}

const copy = (l: Lookups): Lookups => JSON.parse(JSON.stringify(l));

describe('lookup tables', () => {
  it('writes the workbook\'s own values back without changing a cell', () => {
    const before = sheetsOf();
    const after = sheetsOf();
    applyLookups(after, workbookLookups);
    for (const name of template.sheetOrder) {
      const a = before[name], b = after[name];
      for (let r = 0; r < Math.max(a.length, b.length); r++) {
        for (let c = 0; c < Math.max(a[r]?.length ?? 0, b[r]?.length ?? 0); c++) {
          if ((a[r]?.[c] ?? null) !== (b[r]?.[c] ?? null)) throw new Error(`${name} row ${r + 1} col ${c + 1}: ${a[r]?.[c]} -> ${b[r]?.[c]}`);
        }
      }
    }
  });

  it('changes the results when a lookup value changes', () => {
    const base = poolBid(workbookLookups);
    expect(base).toBeCloseTo(2567795.2, 1);
    const changed = copy(workbookLookups);
    for (const r of changed.EXIT) for (const k of Object.keys(r)) if (k.startsWith('DQ_') && typeof r[k] === 'number') r[k] = (r[k] as number) * 0.5;
    expect(poolBid(changed)).not.toBeCloseTo(base, 0);
    const otherType = copy(workbookLookups);
    for (const r of otherType.EXIT) r.Table_Type = 'RPL'; // another category's rows are ignored
    expect(poolBid(otherType)).toBeCloseTo(base, 6);
  }, 120_000);

  it('widens the formula ranges when rows are added, and narrows them when removed', () => {
    const more = copy(workbookLookups);
    more.ZIP3.push({ Prop_State: 'ZZ', Zip3: '999', Prop_Sale_Pct_CV: 0.5, Note_Sale_Pct_CV: 0.4 });
    const sheets = sheetsOf();
    applyLookups(sheets, more);
    const formulas = (n: string) => sheets[n].flat().filter((v): v is string => typeof v === 'string' && v.startsWith('='));
    expect(formulas('Model').some((f) => f.includes('ZIP3!$B$11:$B$944'))).toBe(true);
    expect(formulas('Model').some((f) => f.includes('ZIP3!$B$11:$B$943'))).toBe(false);
    expect(formulas('ZIP3')).toContain('=AVERAGE(C11:C944)');
    expect(sheets.ZIP3[943]).toEqual(["'ZZ", "'999", 0.5, 0.4]);

    const fewer = copy(workbookLookups);
    fewer.value_code = fewer.value_code.slice(0, 10);
    const s2 = sheetsOf();
    applyLookups(s2, fewer);
    expect(s2.Model.flat().some((v) => typeof v === 'string' && v.includes('value_code!$A$2:$A$11'))).toBe(true);
    expect(s2.value_code[11]?.[0] ?? null).toBeNull();
  });

  it('places grid values by segment, outcome and LTV band, whatever the row order', () => {
    const shuffled = copy(workbookLookups);
    shuffled.EXIT.reverse();
    const row = shuffled.EXIT.find((r) => r.Segment === 'BK7 only' && r.Outcome === 'REO' && r.LTV_Band === '60-80')!;
    row.DQ_CUR = 0.123;
    const sheets = sheetsOf();
    applyLookups(sheets, shuffled);
    // BK7 block starts at column S; REO label row 34, bands from row 35; 60-80 is the third band; CUR is two columns in.
    expect(sheets.EXIT[36][parseAddress('U1').col]).toBe(0.123);
  });
});
