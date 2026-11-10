// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { excelDisplay } from './excel-format.ts';

const ACCOUNTING = '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)';

describe('excelDisplay (the Model sheet number formats)', () => {
  it('formats accounting numbers, negatives in brackets and zero as a dash', () => {
    expect(excelDisplay(2567795.19, ACCOUNTING)).toBe('2,567,795');
    expect(excelDisplay(-1234.6, ACCOUNTING)).toBe('(1,235)');
    expect(excelDisplay(0, ACCOUNTING)).toBe('-');
  });

  it('drops [Red] and keeps the section sign rules', () => {
    expect(excelDisplay(-4523.68, '#,##0;[Red]#,##0')).toBe('4,524');
    expect(excelDisplay(1500, '#,##0 ;(#,##0)')).toBe('1,500');
    expect(excelDisplay(-1500, '#,##0 ;(#,##0)')).toBe('(1,500)');
    expect(excelDisplay(-2, '#,##0')).toBe('-2');
    expect(excelDisplay(0, '#,##0;;"-"')).toBe('-');
  });

  it('formats percentages, multiples, currency and decimals', () => {
    expect(excelDisplay(0.5697, '0.00%')).toBe('56.97%');
    expect(excelDisplay(0.07125, '0.000%')).toBe('7.125%');
    expect(excelDisplay(-0.2, '0%;-0%;"-"_%')).toBe('-20%');
    expect(excelDisplay(0, '0%;-0%;"-"_%')).toBe('-');
    expect(excelDisplay(1.25, '0.000x')).toBe('1.250x');
    expect(excelDisplay(0.5697, '"$"#,##0.00')).toBe('$0.57');
    expect(excelDisplay(3, '0;(0);"-"')).toBe('3');
    expect(excelDisplay(0, '0;(0);"-"')).toBe('-');
  });

  it('shows General numbers and text as they are', () => {
    expect(excelDisplay(12.5, '')).toBe('12.5');
    expect(excelDisplay('CUR', '#,##0')).toBe('CUR');
    expect(excelDisplay(null, '#,##0')).toBe('');
  });
});
