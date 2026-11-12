import { describe, expect, it } from 'vitest';

import { fileTypeOf, lookupTableName } from './file-type';

describe('file types', () => {
  it('reads the type from the start of the file name', () => {
    expect(fileTypeOf('NPL_Pacific Private Money_02-nov-26')).toBe('NPL');
    expect(fileTypeOf('npl pool')).toBe('NPL');
    expect(fileTypeOf('BPL_Pacific Private Money')).toBe('BPL');
    // Files loaded before types existed calculate as BPL, as they always have.
    expect(fileTypeOf('Pacific Private Money')).toBe('BPL');
    expect(fileTypeOf('Asset Based Lending - 2025.09 - $15mm')).toBe('BPL');
  });

  it('names the lookup tables as the SQL scripts create them', () => {
    expect(lookupTableName('NPL', 'state_names')).toBe('NPL_StateNames');
    expect(lookupTableName('BPL', 'EXIT_BPL')).toBe('BPL_ExitBpl');
    expect(lookupTableName('BPL', 'SOL_code')).toBe('BPL_SolCode');
    expect(lookupTableName('NPL', 'ZIP3')).toBe('NPL_Zip3');
  });
});
