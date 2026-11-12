// An input file's type, from the start of its name: NPL files (NPL_Pacific Private Money_02-nov-26)
// are calculated with the NPL_Lookups tables, BPL files (BPL_Pacific Private Money) and files with
// neither prefix (the ones loaded before types existed) with the BPL_Lookups tables.

export const FILE_TYPES = ['BPL', 'NPL'] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const fileTypeOf = (fileName: string): FileType => (/^\s*NPL/i.test(fileName) ? 'NPL' : 'BPL');

/** state_names -> StateNames, as the lookup tables are named (scripts/gen-entities.ts). */
const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');

/** A lookup's SQL table for a file type: (NPL, state_names) -> NPL_StateNames, in NPL_Lookups. */
export const lookupTableName = (type: FileType, table: string) => `${type}_${pascal(table)}`;
