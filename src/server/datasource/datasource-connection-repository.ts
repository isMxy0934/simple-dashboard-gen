import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { getPgPool } from "./postgres";
import type { DatasourceEngineKind } from "./datasource-types";
import { decryptSecretPayload, encryptSecretPayload } from "./datasource-crypto";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

export interface DatasourceConnectionRow {
  id: string;
  kind: DatasourceEngineKind;
  label: string;
  description: string;
  secret_ciphertext: Buffer;
  created_at: Date;
  updated_at: Date;
}

interface ConnectionRowDb extends QueryResultRow {
  id: string;
  kind: string;
  label: string;
  description: string;
  secret_ciphertext: Buffer;
  created_at: Date;
  updated_at: Date;
}

export async function listDatasourceConnections(): Promise<DatasourceConnectionRow[]> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<ConnectionRowDb>(
    `
      select id, kind, label, description, secret_ciphertext, created_at, updated_at
      from datasource_connections
      order by created_at asc
    `,
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind as DatasourceEngineKind,
    label: row.label,
    description: row.description,
    secret_ciphertext: row.secret_ciphertext,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  }));
}

export async function getDatasourceConnectionById(
  id: string,
): Promise<DatasourceConnectionRow | undefined> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<ConnectionRowDb>(
    `
      select id, kind, label, description, secret_ciphertext, created_at, updated_at
      from datasource_connections
      where id = $1
      limit 1
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    kind: row.kind as DatasourceEngineKind,
    label: row.label,
    description: row.description,
    secret_ciphertext: row.secret_ciphertext,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function insertDatasourceConnection(input: {
  kind: DatasourceEngineKind;
  label: string;
  description: string;
  secretJson: string;
}): Promise<DatasourceConnectionRow> {
  await ensureCloudAuthoringSchema();
  const id = `ds_${randomUUID().replace(/-/g, "")}`;
  const ciphertext = encryptSecretPayload(input.secretJson);
  const pool = getPgPool();
  const result = await pool.query<ConnectionRowDb>(
    `
      insert into datasource_connections (id, kind, label, description, secret_ciphertext)
      values ($1, $2, $3, $4, $5)
      returning id, kind, label, description, secret_ciphertext, created_at, updated_at
    `,
    [id, input.kind, input.label.trim(), input.description.trim(), ciphertext],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    kind: row.kind as DatasourceEngineKind,
    label: row.label,
    description: row.description,
    secret_ciphertext: row.secret_ciphertext,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function deleteDatasourceConnection(id: string): Promise<boolean> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query(`delete from datasource_connections where id = $1`, [id]);
  return result.rowCount !== null && result.rowCount > 0;
}

export function decryptConnectionSecretJson(row: DatasourceConnectionRow): string {
  return decryptSecretPayload(row.secret_ciphertext);
}
