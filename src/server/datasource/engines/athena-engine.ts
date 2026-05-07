import "server-only";

import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena";
import { GetTableCommand, GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import type { BindingRow, JsonValue, QueryDef } from "../../../contracts";
import type { DatasourceEngine } from "../datasource-engine";
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

function glueClient(secret: AthenaConnectionSecret) {
  return new GlueClient({
    region: secret.region,
    credentials: awsCredentials(secret),
  });
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

async function introspectGlueDatabase(secret: AthenaConnectionSecret): Promise<IntrospectedSchema[]> {
  const glue = glueClient(secret);
  const db = secret.database.trim();
  if (!db) {
    throw new Error("Athena database name is required.");
  }

  const tables: IntrospectedTable[] = [];
  let nextToken: string | undefined;

  do {
    const list = await glue.send(
      new GetTablesCommand({ DatabaseName: db, NextToken: nextToken }),
    );
    for (const summary of list.TableList ?? []) {
      if (!summary.Name) {
        continue;
      }
      const full = await glue.send(
        new GetTableCommand({ DatabaseName: db, Name: summary.Name }),
      );
      const cols = full.Table?.StorageDescriptor?.Columns ?? [];
      tables.push({
        name: summary.Name,
        ...(full.Table?.Description ? { comment: full.Table.Description } : {}),
        columns: cols.map((c) => ({
          name: c.Name ?? "?",
          data_type: c.Type ?? "string",
          ...(c.Comment ? { comment: c.Comment } : {}),
          nullable: true,
        })),
      });
    }
    nextToken = list.NextToken;
  } while (nextToken);

  tables.sort((a: IntrospectedTable, b: IntrospectedTable) =>
    a.name.localeCompare(b.name),
  );
  return [{ name: db, tables }];
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
    if (!secret.region.trim() || !secret.database.trim() || !secret.outputLocation.trim()) {
      throw new Error("Athena region, database, and outputLocation are required.");
    }
    const client = athenaClient(secret);
    const start = await client.send(
      new StartQueryExecutionCommand({
        QueryString: "select 1 as ok",
        WorkGroup: secret.workgroup ?? "primary",
        QueryExecutionContext: {
          Database: secret.database,
          Catalog: secret.catalog ?? "AwsDataCatalog",
        },
        ResultConfiguration: {
          OutputLocation: secret.outputLocation,
        },
      }),
    );
    const id = start.QueryExecutionId;
    if (!id) {
      throw new Error("Athena did not return a query execution id.");
    }
    const state = await waitForQuery(client, id);
    if (state !== "SUCCEEDED") {
      const reason = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const msg = reason.QueryExecution?.Status?.StateChangeReason ?? "Athena query failed.";
      throw new Error(msg);
    }
  },

  async introspectSchema(secretJson: string): Promise<IntrospectedSchema[]> {
    const secret = parseSecret(secretJson);
    return introspectGlueDatabase(secret);
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
        WorkGroup: secret.workgroup ?? "primary",
        QueryExecutionContext: {
          Database: secret.database,
          Catalog: secret.catalog ?? "AwsDataCatalog",
        },
        ResultConfiguration: {
          OutputLocation: secret.outputLocation,
        },
      }),
    );
    const id = start.QueryExecutionId;
    if (!id) {
      throw new Error("Athena did not return a query execution id.");
    }
    const state = await waitForQuery(client, id);
    if (state !== "SUCCEEDED") {
      const detail = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const msg = detail.QueryExecution?.Status?.StateChangeReason ?? "Athena query failed.";
      throw new Error(msg);
    }

    const { rows } = await fetchAllQueryRows(client, id);
    return rows.map((row) => normalizeQueryRowForBinding(row, query));
  },
};
