import { describe, expect, it } from 'vitest';

import { MAX_UPLOAD_MB, uploadProblem } from './use-uploads';

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name);

describe('uploadProblem', () => {
  it('accepts NPL_ and BPL_ workbooks, in any case', () => {
    expect(uploadProblem(file('BPL_Pacific Private Money.xlsx'))).toBeNull();
    expect(uploadProblem(file('npl_Groundfloor Tape.XLSX'))).toBeNull();
  });

  it('asks for the file type when the name has no NPL_/BPL_ prefix', () => {
    expect(uploadProblem(file('Pacific Private Money.xlsx'))).toBe('type');
    expect(uploadProblem(file('BPLPacific.xlsx'))).toBe('type');
  });

  it('asks for an .xlsx workbook for other formats', () => {
    expect(uploadProblem(file('BPL_Pacific.xls'))).toBe('format');
    expect(uploadProblem(file('BPL_Pacific.csv'))).toBe('format');
    expect(uploadProblem(file('Pacific'))).toBe('format');
  });

  it('refuses empty and oversized files', () => {
    expect(uploadProblem(file('BPL_Pacific.xlsx', 0))).toBe('empty');
    expect(uploadProblem(file('BPL_Pacific.xlsx', MAX_UPLOAD_MB * 1024 * 1024 + 1))).toBe('size');
  });
});
