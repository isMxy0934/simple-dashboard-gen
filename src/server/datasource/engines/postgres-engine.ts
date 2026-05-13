import "server-only";

import { Pool } from "pg";
import type { BindingRow, JsonValue, QueryDef } from "../../../contracts";
import type { DatasourceEngine } from "../datasource-engine";
import type { PostgresConnectionSecret } from "../datasource-types";
import { introspectPostgresSchemas, type IntrospectedSchema } from "../postgres-introspect";
import {
  assertReadOnlySql,
  compilePostgresSqlTemplate,
  normalizeQueryRowForBinding,
} from "../sql-template";
import { normalizeSchemaAllowlist } from "@/shared/datasource-schema-allowlist";

function parseSecret(secretJson: string): PostgresConnectionSecret {
  const parsed = JSON.parse(secretJson) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Postgres datasource secret.");
  }
  const secret = parsed as Record<string, unknown>;
  if (typeof secret.connectionUrl !== "string" || !secret.connectionUrl.trim()) {
    throw new Error("Postgres connectionUrl is required.");
  }
  const schemaAllowlist = normalizeSchemaAllowlist(secret.schemaAllowlist);
  return {
    connectionUrl: secret.connectionUrl,
    ...(schemaAllowlist && schemaAllowlist.length > 0 ? { schemaAllowlist } : {}),
  };
}

function createPool(secret: PostgresConnectionSecret): Pool {
  return new Pool({
    connectionString: secret.connectionUrl.trim(),
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 5000,
  });
}

function filterSchemas(
  schemas: IntrospectedSchema[],
  schemaAllowlist: readonly string[] | undefined,
): IntrospectedSchema[] {
  if (!schemaAllowlist?.length) {
    return schemas;
  }
  const allowed = new Set(schemaAllowlist);
  return schemas.filter((schema) => allowed.has(schema.name));
}

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function assertAllowedSchemasExist(
  pool: Pool,
  schemaAllowlist: readonly string[] | undefined,
) {
  if (!schemaAllowlist?.length) {
    return;
  }
  const result = await pool.query<{ nspname: string }>(
    `select nspname from pg_namespace where nspname = any($1::text[])`,
    [schemaAllowlist],
  );
  const existing = new Set(result.rows.map((row) => row.nspname));
  const missing = schemaAllowlist.filter((schema) => !existing.has(schema));
  if (missing.length > 0) {
    throw new Error(`Postgres schema(s) not found: ${missing.join(", ")}.`);
  }
}

async function setSearchPathForAllowedSchemas(
  client: { query: (text: string) => Promise<unknown> },
  schemaAllowlist: readonly string[] | undefined,
) {
  if (!schemaAllowlist?.length) {
    return;
  }
  await client.query(
    `set local search_path to ${schemaAllowlist.map(quotePgIdentifier).join(", ")}`,
  );
}

export const postgresEngine: DatasourceEngine = {
  kind: "postgres",

  async testConnection(secretJson: string) {
    const secret = parseSecret(secretJson);
    const pool = createPool(secret);
    try {
      await pool.query("select 1 as ok");
      await assertAllowedSchemasExist(pool, secret.schemaAllowlist);
    } finally {
      await pool.end().catch(() => undefined);
    }
  },

  async introspectSchema(secretJson: string): Promise<IntrospectedSchema[]> {
    const secret = parseSecret(secretJson);
    const pool = createPool(secret);
    try {
      return filterSchemas(
        await introspectPostgresSchemas(pool),
        secret.schemaAllowlist,
      );
    } finally {
      await pool.end().catch(() => undefined);
    }
  },

  async executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
  ): Promise<BindingRow[]> {
    const secret = parseSecret(secretJson);
    const pool = createPool(secret);
    const compiled = compilePostgresSqlTemplate(query.sql_template, params);
    assertReadOnlySql(compiled.text);

    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout = '5000ms'");
      await setSearchPathForAllowedSchemas(client, secret.schemaAllowlist);
      const result = await client.query(compiled.text, compiled.values);
      await client.query("rollback");
      return result.rows.map((row) => normalizeQueryRowForBinding(row, query));
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // noop
      }
      throw error;
    } finally {
      client.release();
      await pool.end().catch(() => undefined);
    }
  },
};
