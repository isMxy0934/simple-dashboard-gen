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

function parseSecret(secretJson: string): PostgresConnectionSecret {
  const parsed = JSON.parse(secretJson) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Postgres datasource secret.");
  }
  const secret = parsed as Record<string, unknown>;
  if (typeof secret.connectionUrl !== "string" || !secret.connectionUrl.trim()) {
    throw new Error("Postgres connectionUrl is required.");
  }
  return secret as unknown as PostgresConnectionSecret;
}

function createPool(secret: PostgresConnectionSecret): Pool {
  return new Pool({
    connectionString: secret.connectionUrl.trim(),
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 5000,
  });
}

export const postgresEngine: DatasourceEngine = {
  kind: "postgres",

  async testConnection(secretJson: string) {
    const pool = createPool(parseSecret(secretJson));
    try {
      await pool.query("select 1 as ok");
    } finally {
      await pool.end().catch(() => undefined);
    }
  },

  async introspectSchema(secretJson: string): Promise<IntrospectedSchema[]> {
    const pool = createPool(parseSecret(secretJson));
    try {
      return await introspectPostgresSchemas(pool);
    } finally {
      await pool.end().catch(() => undefined);
    }
  },

  async executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
  ): Promise<BindingRow[]> {
    const pool = createPool(parseSecret(secretJson));
    const compiled = compilePostgresSqlTemplate(query.sql_template, params);
    assertReadOnlySql(compiled.text);

    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout = '5000ms'");
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
