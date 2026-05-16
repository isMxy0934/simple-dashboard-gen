import "server-only";

import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  ListDatabasesCommand,
  ListTableMetadataCommand,
  StartQueryExecutionCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena";
import type { BindingRow, JsonValue, QueryDef } from "../../../contracts";
import { DatasourceEngineDiagnosticError, type DatasourceEngine } from "../datasource-engine";
import type { AthenaConnectionSecret } from "../datasource-types";
import type { IntrospectedSchema, IntrospectedTable } from "../postgres-introspect";
import {
  assertReadOnlySql,
  compileAthenaSqlTemplate,
  normalizeQueryRowForBinding,
} from "../sql-template";

const MAX_RESULT_ROWS = 5000;
const POLL_MS = 250;
const MAX_WAIT_MS = 120_000;

function parseSecret(secretJson: string): AthenaConnectionSecret {
  const parsed = JSON.parse(secretJson) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Athena datasource secret.");
  }
  return parsed as AthenaConnectionSecret;
}

function awsCredentials(secret: AthenaConnectionSecret) {
  if (secret.accessKeyId && secret.secretAccessKey) {
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
      sessionToken: secret.sessionToken,
    };
  }
  return undefined;
}

function athenaClient(secret: AthenaConnectionSecret) {
  return new AthenaClient({
    region: secret.region,
    credentials: awsCredentials(secret),
  });
}

function athenaCatalog(secret: AthenaConnectionSecret) {
  return secret.catalog?.trim() || "AwsDataCatalog";
}

function athenaWorkgroup(secret: AthenaConnectionSecret) {
  return secret.workgroup?.trim() || "primary";
}

function athenaDefaultDatabase(secret: AthenaConnectionSecret) {
  return secret.database?.trim() || undefined;
}

function athenaTableComment(parameters: Record<string, string> | undefined) {
  return (
    parameters?.comment?.trim() ||
    parameters?.Comment?.trim() ||
    parameters?.description?.trim() ||
    parameters?.Description?.trim() ||
    undefined
  );
}

function queryExecutionContext(secret: AthenaConnectionSecret) {
  const database = athenaDefaultDatabase(secret);
  return {
    Catalog: athenaCatalog(secret),
    ...(database ? { Database: database } : {}),
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForQuery(
  client: AthenaClient,
  queryExecutionId: string,
): Promise<QueryExecutionState | undefined> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }),
    );
    const state = result.QueryExecution?.Status?.State;
    if (
      state === "SUCCEEDED" ||
      state === "FAILED" ||
      state === "CANCELLED"
    ) {
      return state;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Athena query timed out.");
}

async function listAthenaDatabaseNames(secret: AthenaConnectionSecret): Promise<string[]> {
  const client = athenaClient(secret);
  const names: string[] = [];
  let nextToken: string | undefined;

  do {
    const list = await client.send(
      new ListDatabasesCommand({
        CatalogName: athenaCatalog(secret),
        WorkGroup: athenaWorkgroup(secret),
        NextToken: nextToken,
      }),
    );
    for (const db of list.DatabaseList ?? []) {
      if (db.Name) {
        names.push(db.Name);
      }
    }
    nextToken = list.NextToken;
  } while (nextToken);

  return names.sort((a, b) => a.localeCompare(b));
}

async function listAthenaTables(
  secret: AthenaConnectionSecret,
  databaseName: string,
): Promise<IntrospectedTable[]> {
  const client = athenaClient(secret);
  const tables: IntrospectedTable[] = [];
  let nextToken: string | undefined;

  do {
    const list = await client.send(
      new ListTableMetadataCommand({
        CatalogName: athenaCatalog(secret),
        DatabaseName: databaseName,
        WorkGroup: athenaWorkgroup(secret),
        NextToken: nextToken,
      }),
    );
    for (const summary of list.TableMetadataList ?? []) {
      if (summary.Name) {
        const cols = [...(summary.Columns ?? []), ...(summary.PartitionKeys ?? [])];
        const tableComment = athenaTableComment(summary.Parameters);
        tables.push({
          name: summary.Name,
          ...(tableComment ? { comment: tableComment } : {}),
          columns: cols.map((c) => ({
            name: c.Name ?? "?",
            data_type: c.Type ?? "string",
            ...(c.Comment ? { comment: c.Comment } : {}),
            nullable: true,
          })),
        });
      }
    }
    nextToken = list.NextToken;
  } while (nextToken);

  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

async function introspectAthenaDatabase(
  secret: AthenaConnectionSecret,
  databaseName: string,
): Promise<IntrospectedSchema> {
  return { name: databaseName, tables: await listAthenaTables(secret, databaseName) };
}

async function introspectAthenaCatalog(secret: AthenaConnectionSecret): Promise<IntrospectedSchema[]> {
  const databaseNames = await listAthenaDatabaseNames(secret);

  if (databaseNames.length > 0) {
    const schemas: IntrospectedSchema[] = [];
    for (const databaseName of databaseNames) {
      schemas.push(await introspectAthenaDatabase(secret, databaseName));
    }
    return schemas;
  }

  const defaultDatabase = athenaDefaultDatabase(secret);
  if (!defaultDatabase) {
    return [];
  }

  return [await introspectAthenaDatabase(secret, defaultDatabase)];
}

async function fetchAllQueryRows(
  client: AthenaClient,
  queryExecutionId: string,
): Promise<{ columnNames: string[]; rows: Record<string, string | null>[] }> {
  let nextToken: string | undefined;
  const out: Record<string, string | null>[] = [];
  let columnNames: string[] = [];

  do {
    const page = await client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
      }),
    );

    const meta = page.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
    if (columnNames.length === 0) {
      columnNames = meta.map((c, i) => c.Name ?? `col_${i + 1}`);
    }

    const rows = page.ResultSet?.Rows ?? [];
    const isFirstPage = out.length === 0;
    for (let i = 0; i < rows.length; i++) {
      if (isFirstPage && i === 0) {
        continue;
      }
      const row = rows[i];
      const cells = row.Data ?? [];
      const record: Record<string, string | null> = {};
      for (let c = 0; c < columnNames.length; c++) {
        const raw = cells[c]?.VarCharValue ?? null;
        record[columnNames[c]] = raw;
      }
      out.push(record);
      if (out.length >= MAX_RESULT_ROWS) {
        return { columnNames, rows: out };
      }
    }

    nextToken = page.NextToken;
  } while (nextToken);

  return { columnNames, rows: out };
}

export const athenaEngine: DatasourceEngine = {
  kind: "athena",

  async testConnection(secretJson: string) {
    const secret = parseSecret(secretJson);
    if (!secret.region.trim() || !secret.workgroup?.trim() || !secret.outputLocation.trim()) {
      throw new DatasourceEngineDiagnosticError(
        "Athena region, workgroup, and outputLocation are required.",
        {
          code: "ATHENA_CONFIGURATION_INCOMPLETE",
        },
      );
    }
    const client = athenaClient(secret);
    const start = await client.send(
      new StartQueryExecutionCommand({
        QueryString: "select 1 as ok",
        WorkGroup: athenaWorkgroup(secret),
        QueryExecutionContext: queryExecutionContext(secret),
        ResultConfiguration: {
          OutputLocation: secret.outputLocation,
        },
      }),
    );
    const id = start.QueryExecutionId;
    if (!id) {
      throw new DatasourceEngineDiagnosticError(
        "Athena did not return a query execution id.",
        {
          code: "ATHENA_QUERY_START_FAILED",
          metadata: {
            database: athenaDefaultDatabase(secret),
            catalog: athenaCatalog(secret),
            workgroup: athenaWorkgroup(secret),
          },
        },
      );
    }
    const state = await waitForQuery(client, id);
    if (state !== "SUCCEEDED") {
      const reason = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const msg = reason.QueryExecution?.Status?.StateChangeReason ?? "Athena query failed.";
      throw new DatasourceEngineDiagnosticError(msg, {
        code: "ATHENA_QUERY_FAILED",
        metadata: {
          queryExecutionId: id,
          state: state ?? "UNKNOWN",
          database: athenaDefaultDatabase(secret),
          catalog: athenaCatalog(secret),
          workgroup: athenaWorkgroup(secret),
        },
      });
    }
  },

  async introspectSchema(secretJson: string): Promise<IntrospectedSchema[]> {
    const secret = parseSecret(secretJson);
    return introspectAthenaCatalog(secret);
  },

  async executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
  ): Promise<BindingRow[]> {
    const secret = parseSecret(secretJson);
    const compiled = compileAthenaSqlTemplate(query.sql_template, params);
    assertReadOnlySql(compiled);

    const client = athenaClient(secret);
    const start = await client.send(
      new StartQueryExecutionCommand({
        QueryString: compiled,
        WorkGroup: athenaWorkgroup(secret),
        QueryExecutionContext: queryExecutionContext(secret),
        ResultConfiguration: {
          OutputLocation: secret.outputLocation,
        },
      }),
    );
    const id = start.QueryExecutionId;
    if (!id) {
      throw new DatasourceEngineDiagnosticError(
        "Athena did not return a query execution id.",
        {
          code: "ATHENA_QUERY_START_FAILED",
          metadata: {
            database: athenaDefaultDatabase(secret),
            catalog: athenaCatalog(secret),
            workgroup: athenaWorkgroup(secret),
          },
        },
      );
    }
    const state = await waitForQuery(client, id);
    if (state !== "SUCCEEDED") {
      const detail = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const msg = detail.QueryExecution?.Status?.StateChangeReason ?? "Athena query failed.";
      throw new DatasourceEngineDiagnosticError(msg, {
        code: "ATHENA_QUERY_FAILED",
        metadata: {
          queryExecutionId: id,
          state: state ?? "UNKNOWN",
          database: athenaDefaultDatabase(secret),
          catalog: athenaCatalog(secret),
          workgroup: athenaWorkgroup(secret),
        },
      });
    }

    const { rows } = await fetchAllQueryRows(client, id);
    return rows.map((row) => normalizeQueryRowForBinding(row, query));
  },
};
