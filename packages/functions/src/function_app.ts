// The model constants of each input file, in the SQL tables Constraints.BPL_ConstraintValues and
// Constraints.BPL_ConstraintChanges of the app's database gitsit-test. The app's data service only
// reaches dbo tables, so the Constraints page reads and saves them through these functions, which
// run SQL as the app identity (the owner of the Fabric app item). deleteFiles removes input files
// from every table at once, which the data service can't do in one transaction. loadLookups reads
// the lookup tables of a file type from its schema (BPL_Lookups or NPL_Lookups). uploadFile saves an
// input file into the Lakehouse folder the loader pipeline watches, and uploadStatus reads how each
// upload went (dbo.Upload_status, which the loader notebook keeps up to date).

import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import sql from 'mssql';

const udf = new UserDataFunctions();

/** gitsit-test (Fabric SQL database in workspace Gitsit_test). */
const SQL_SERVER = 'wssfdnev5nyelmdvw3xumqun3i-pqhpudri7sjejflsu6qgtrtzvm.database.fabric.microsoft.com';
const DATABASE = 'gitsit-test-e40f6906-4431-48db-8eca-33c1fd246d16';

export interface ConstraintValue {
  File_Name: string;
  Field_Index: string;
  Value: string | null;
}

export interface ConstraintEdit {
  Field_Index: string;
  Field_Name_Display: string;
  New_Value: string;
}

export interface ApplyResult {
  saved: number;
}

export interface LookupRows {
  table: string;
  /** The table's rows as JSON (FOR JSON PATH), as the engine reads them. */
  rows: string;
}

/** The lookup schema of each file type: BPL files read BPL_Lookups.BPL_…, NPL files NPL_Lookups.NPL_… */
const LOOKUP_SCHEMAS = { BPL: 'BPL_Lookups', NPL: 'NPL_Lookups' } as const;

export interface DeletedRows {
  table: string;
  rows: number;
}

/** Every table that holds rows per input file (File_Name), in the order deleteFiles empties them. */
const FILE_TABLES = [
  ['dbo', 'InputLoans'], ['dbo', 'LoanModels'], ['dbo', 'LoanModelMonthlies'], ['dbo', 'LoanChanges'], ['dbo', 'Input_files'],
  ['dbo', 'Upload_status'], ['Constraints', 'BPL_ConstraintValues'], ['Constraints', 'BPL_ConstraintChanges'],
] as const;

/** The gitsit_files Lakehouse folder the loader pipeline watches (OneLake DFS). */
const INPUT_FOLDER = 'https://onelake.dfs.fabric.microsoft.com/0efa0e7c-fc28-4492-9572-a7a069c679ab/828ac29b-3435-4e31-bc84-24b661263994/Files/input';
/** The largest file uploadFile takes (input tapes are tens of KB). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * One row per uploaded file: Waiting (saved to Files/input), Running (the loader is reading it),
 * Completed (loaded as File_Name) or Failed (Message says why). The loader notebook creates the
 * same table and adds a row for files put into Files/input some other way.
 */
const STATUS_TABLE = `IF OBJECT_ID(N'dbo.Upload_status', N'U') IS NULL
CREATE TABLE dbo.Upload_status (Upload_Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY, Source_File NVARCHAR(260) NOT NULL,
  File_Name NVARCHAR(200) NULL, Status NVARCHAR(20) NOT NULL, Loans INT NULL, Message NVARCHAR(4000) NULL,
  Uploaded_By NVARCHAR(200) NULL, Uploaded_On DATETIME2 NOT NULL, Updated_On DATETIME2 NOT NULL);`;

export interface UploadStatus {
  Upload_Id: number;
  /** The file's name as uploaded (with .xlsx). */
  Source_File: string;
  /** The name it was loaded as, with the load date (once Completed). */
  File_Name: string | null;
  Status: string;
  Loans: number | null;
  Message: string | null;
  Uploaded_By: string | null;
  /** ISO times (UTC). */
  Uploaded_On: string;
  Updated_On: string;
}

export interface UploadResult {
  uploadId: number;
  fileName: string;
}

async function connect(ctx: { Tokens: { Sql: string } }): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool({
    server: SQL_SERVER,
    database: DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token: ctx.Tokens.Sql } },
  }).connect();
}

/** Who invoked the function: the email in the caller's Rayfin token (xms_attr.<app>.rfn_email), if it carries one. */
function callerEmail(ctx: { accessToken: string }): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(ctx.accessToken.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const attrs = Object.values((claims.xms_attr ?? {}) as Record<string, Record<string, unknown>>);
    const email = [...attrs.map((a) => a?.rfn_email), claims.email, claims.preferred_username, claims.upn].find((v) => typeof v === 'string');
    return (email as string | undefined)?.slice(0, 200);
  } catch {
    return undefined;
  }
}

const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Invalid input.');
  return v;
};

udf.func(
  'loadConstraints',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>): Promise<ConstraintValue[]> => {
    const pool = await connect(ctx);
    try {
      const result = await pool.request()
        .query<ConstraintValue>('SELECT [File_Name], [Field_Index], [Value] FROM [Constraints].[BPL_ConstraintValues]');
      return result.recordset.map((r) => ({ File_Name: r.File_Name, Field_Index: r.Field_Index, Value: r.Value }));
    } finally {
      await pool.close();
    }
  },
  [],
);

udf.func(
  'applyConstraints',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>, fileName: string, edits: ConstraintEdit[], userMail: string): Promise<ApplyResult> => {
    const file = text(fileName, 200);
    if (!Array.isArray(edits) || !edits.length || edits.length > 500) throw new Error('Invalid input.');
    const rows = edits.map((e) => ({
      index: text(e?.Field_Index, 100), display: text(e?.Field_Name_Display, 200), value: text(e?.New_Value, 100),
    }));
    // The token's email when it has one, else the signed-in user's email the app sends.
    const user = callerEmail(ctx) ?? (typeof userMail === 'string' && userMail.trim() ? userMail.trim().slice(0, 200) : 'unknown');
    const pool = await connect(ctx);
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      for (const r of rows) {
        // The value it replaces goes into the change log with the new one.
        await new sql.Request(tx)
          .input('file', sql.NVarChar(200), file).input('index', sql.NVarChar(100), r.index)
          .input('display', sql.NVarChar(200), r.display).input('value', sql.NVarChar(100), r.value)
          .input('user', sql.NVarChar(200), user)
          .query(`DECLARE @old NVARCHAR(100) = (SELECT [Value] FROM [Constraints].[BPL_ConstraintValues] WHERE [File_Name] = @file AND [Field_Index] = @index);
UPDATE [Constraints].[BPL_ConstraintValues] SET [Value] = @value WHERE [File_Name] = @file AND [Field_Index] = @index;
IF @@ROWCOUNT = 0
  INSERT INTO [Constraints].[BPL_ConstraintValues] ([File_Name], [Field_Index], [Field_Name_Display], [Value]) VALUES (@file, @index, @display, @value);
INSERT INTO [Constraints].[BPL_ConstraintChanges] ([File_Name], [Field_Index], [Field_Name_Display], [Old_Value], [New_Value], [User_mail], [Changed_On])
VALUES (@file, @index, @display, @old, @value, @user, SYSUTCDATETIME());`);
      }
      await tx.commit();
      return { saved: rows.length };
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw e;
    } finally {
      await pool.close();
    }
  },
  [],
);

// The lookup tables (EXIT, ZIP3 …) of one file type, read from that type's schema: BPL_Lookups for
// BPL files, NPL_Lookups for NPL files. `tables` are the SQL table names (BPL_Exit …).
udf.func(
  'loadLookups',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>, fileType: string, tables: string[]): Promise<LookupRows[]> => {
    if (fileType !== 'BPL' && fileType !== 'NPL') throw new Error('Invalid input.');
    const schema = LOOKUP_SCHEMAS[fileType];
    if (!Array.isArray(tables) || !tables.length || tables.length > 50
      || !tables.every((t) => typeof t === 'string' && new RegExp(`^${fileType}_[A-Za-z0-9]{1,100}$`).test(t))) throw new Error('Invalid input.');
    const pool = await connect(ctx);
    try {
      const out: LookupRows[] = [];
      for (const table of tables) {
        const result = await pool.request().query<{ found: number; j: string | null }>(`SELECT CASE WHEN OBJECT_ID(N'[${schema}].[${table}]', N'U') IS NULL THEN 0 ELSE 1 END AS found;`);
        if (!result.recordset[0]?.found) throw new Error(`The lookup table ${schema}.${table} doesn't exist.`);
        const rows = await pool.request().query<{ j: string | null }>(`SELECT (SELECT * FROM [${schema}].[${table}] FOR JSON PATH, INCLUDE_NULL_VALUES) AS j;`);
        out.push({ table, rows: rows.recordset[0]?.j ?? '[]' });
      }
      return out;
    } finally {
      await pool.close();
    }
  },
  [],
);

// Removes input files from the app: their loans, model rows, change logs, load record and
// constants, in one transaction (all of it or none). Returns the rows removed per table.
udf.func(
  'deleteFiles',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>, fileNames: string[]): Promise<DeletedRows[]> => {
    if (!Array.isArray(fileNames) || !fileNames.length || fileNames.length > 50) throw new Error('Invalid input.');
    const files = JSON.stringify([...new Set(fileNames.map((f) => text(f, 200)))]);
    const pool = await connect(ctx);
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const out: DeletedRows[] = [];
      for (const [schema, table] of FILE_TABLES) {
        // The loader creates Input_files on its first run, so it may not exist yet.
        const result = await new sql.Request(tx).input('files', sql.NVarChar(sql.MAX), files)
          .query(`IF OBJECT_ID(N'[${schema}].[${table}]', N'U') IS NOT NULL
  DELETE FROM [${schema}].[${table}] WHERE [File_Name] IN (SELECT [value] FROM OPENJSON(@files));`);
        out.push({ table: `${schema}.${table}`, rows: result.rowsAffected.reduce((a, b) => a + b, 0) });
      }
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw e;
    } finally {
      await pool.close();
    }
  },
  [],
);

/** Writes a file to OneLake (create, append, flush), replacing one of the same name. */
async function putFile(token: string, url: string, bytes: Buffer): Promise<void> {
  const call = async (method: string, query: string, body?: Buffer) => {
    const res = await fetch(`${url}?${query}`, { method, body, headers: { Authorization: `Bearer ${token}`, 'x-ms-version': '2023-11-03' } });
    if (!res.ok) throw new Error(`OneLake ${query.split('&')[0]} returned ${res.status} ${(await res.text()).slice(0, 300)}`);
  };
  await call('PUT', 'resource=file');
  await call('PATCH', 'action=append&position=0', bytes);
  await call('PATCH', `action=flush&position=${bytes.length}`);
}

// Saves an input workbook into the Lakehouse's Files/input folder, where its arrival starts the
// loader pipeline, and records it in Upload_status as Waiting. `content` is the file, base64.
udf.func(
  'uploadFile',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql | AudienceType.Storage>, fileName: string, content: string, userMail: string): Promise<UploadResult> => {
    const name = text(fileName, 200).trim();
    // An NPL_ or BPL_ workbook, named without a folder.
    if (!/^(NPL|BPL)_[^/\\:*?"<>|]+\.xlsx$/i.test(name)) throw new Error('The file must be an .xlsx workbook whose name starts with NPL_ or BPL_.');
    if (typeof content !== 'string' || !content.length) throw new Error('The file is empty.');
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    // An .xlsx workbook is a zip archive.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("The file isn't an Excel workbook (.xlsx).");
    const user = callerEmail(ctx) ?? (typeof userMail === 'string' && userMail.trim() ? userMail.trim().slice(0, 200) : null);
    const pool = await connect(ctx);
    try {
      await pool.request().query(STATUS_TABLE);
      // Recorded first, so the loader finds the row when the file's arrival starts it.
      const row = await pool.request()
        .input('file', sql.NVarChar(260), name).input('user', sql.NVarChar(200), user)
        .query<{ id: number }>(`INSERT INTO dbo.Upload_status (Source_File, Status, Uploaded_By, Uploaded_On, Updated_On)
OUTPUT INSERTED.Upload_Id AS id VALUES (@file, N'Waiting', @user, SYSUTCDATETIME(), SYSUTCDATETIME());`);
      const id = row.recordset[0].id;
      try {
        await putFile(ctx.Tokens.Storage, `${INPUT_FOLDER}/${encodeURIComponent(name)}`, bytes);
      } catch (e) {
        const message = `Couldn't save the file to the Lakehouse: ${e instanceof Error ? e.message : String(e)}`;
        await pool.request().input('id', sql.Int, id).input('message', sql.NVarChar(4000), message.slice(0, 4000))
          .query(`UPDATE dbo.Upload_status SET Status = N'Failed', Message = @message, Updated_On = SYSUTCDATETIME() WHERE Upload_Id = @id;`);
        throw new Error(message);
      }
      return { uploadId: id, fileName: name };
    } finally {
      await pool.close();
    }
  },
  [],
);

// The latest uploads (newest first) and how each went.
udf.func(
  'uploadStatus',
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>): Promise<UploadStatus[]> => {
    const pool = await connect(ctx);
    try {
      const result = await pool.request().query<Omit<UploadStatus, 'Uploaded_On' | 'Updated_On'> & { Uploaded_On: Date; Updated_On: Date }>(
        `IF OBJECT_ID(N'dbo.Upload_status', N'U') IS NOT NULL
SELECT TOP (200) Upload_Id, Source_File, File_Name, Status, Loans, Message, Uploaded_By, Uploaded_On, Updated_On
FROM dbo.Upload_status ORDER BY Upload_Id DESC;`);
      // The times are stored in UTC (SYSUTCDATETIME), and the driver reads them as UTC.
      return (result.recordset ?? []).map((r) => ({ ...r, Uploaded_On: r.Uploaded_On.toISOString(), Updated_On: r.Updated_On.toISOString() }));
    } finally {
      await pool.close();
    }
  },
  [],
);
