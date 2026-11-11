// The model constants of each input file, in the SQL tables Constraints.BPL_ConstraintValues and
// Constraints.BPL_ConstraintChanges of the app's database gitsit-test. The app's data service only
// reaches dbo tables, so the Constraints page reads and saves them through these functions, which
// run SQL as the app identity (the owner of the Fabric app item).

import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import sql from 'mssql';

const udf = new UserDataFunctions();

/** gitsit-test (Fabric SQL database in workspace Gitsit_test). */
const SQL_SERVER = 'wssfdnev5nyelmdvw3xumqun3i-pqhpudri7sjejflsu6qgtrtzvm.database.fabric.microsoft.com';
const DATABASE = 'gitsit-test-e40f6906-4431-48db-8eca-33c1fd246d16';

type SqlContext = RayfinContext<Record<string, never>, AudienceType.Sql>;

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

async function connect(ctx: SqlContext): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool({
    server: SQL_SERVER,
    database: DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token: ctx.Tokens.Sql } },
  }).connect();
}

/** Who invoked the function: the email in the caller's Rayfin token. */
function callerEmail(ctx: SqlContext): string {
  try {
    const claims = JSON.parse(Buffer.from(ctx.accessToken.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const email = [claims.email, claims.preferred_username, claims.upn, claims.unique_name].find((v) => typeof v === 'string');
    return (email as string | undefined)?.slice(0, 200) ?? 'unknown';
  } catch {
    return 'unknown';
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
  async (ctx: RayfinContext<Record<string, never>, AudienceType.Sql>, fileName: string, edits: ConstraintEdit[]): Promise<ApplyResult> => {
    const file = text(fileName, 200);
    if (!Array.isArray(edits) || !edits.length || edits.length > 500) throw new Error('Invalid input.');
    const rows = edits.map((e) => ({
      index: text(e?.Field_Index, 100), display: text(e?.Field_Name_Display, 200), value: text(e?.New_Value, 100),
    }));
    const user = callerEmail(ctx);
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
