import "server-only";

import { Pool } from "pg";
import type { BindingRow, JsonValue, QueryDef } from "../../../contracts";
import type { DatasourceEngine } from "../datasource-engine";
import type { PostgresConnectionSecret } from "../datasource-types";
import { introspectPostgresSchemas, type IntrospectedSchema } from "../postgres-introspect";
import { getPgPool } from "../postgres";
import {
  assertReadOnlySql,
  compilePostgresSqlTemplate,
  normalizeQueryRowForBinding,
} from "../sql-template";

interface ParsedPostgresSecret extends Partial<PostgresConnectionSecret> {
  builtinPool?: boolean;
}

function parseSecret(secretJson: string): ParsedPostgresSecret {
  const parsed = JSON.parse(secretJson) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Postgres datasource secret.");
  }
  return parsed as ParsedPostgresSecret;
}

function createPool(secret: ParsedPostgresSecret): { pool: Pool; shouldClose: boolean } {
  if (secret.builtinPool) {
    return { pool: getPgPool(), shouldClose: false };
  }
  const url = secret.connectionUrl?.trim();
  if (!url) {
    throw new Error("Postgres connectionUrl is required.");
  }
  return {
    pool: new Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 5000,
    }),
    shouldClose: true,
  };
}

export const postgresEngine: DatasourceEngine = {
  kind: "postgres",

  async testConnection(secretJson: string) {
    const secret = parseSecret(secretJson);
    const { pool, shouldClose } = createPool(secret);
    try {
      await pool.query("select 1 as ok");
    } finally {
      if (shouldClose) {
        await pool.end().catch(() => undefined);
      }
    }
  },

  async introspectSchema(secretJson: string): Promise<IntrospectedSchema[]> {
    const secret = parseSecret(secretJson);
    const { pool, shouldClose } = createPool(secret);
    try {
      return await introspectPostgresSchemas(pool);
    } finally {
      if (shouldClose) {
        await pool.end().catch(() => undefined);
      }
    }
  },

  async executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
  ): Promise<BindingRow[]> {
    const secret = parseSecret(secretJson);
    const compiled = compilePostgresSqlTemplate(query.sql_template, params);
    assertReadOnlySql(compiled.text);

    const { pool, shouldClose } = createPool(secret);
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
      if (shouldClose) {
        await pool.end().catch(() => undefined);
      }
    }
  },
};
