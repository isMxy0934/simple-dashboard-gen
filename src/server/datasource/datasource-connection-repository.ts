import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { getPgPool } from "./postgres";
import type { DatasourceEngineKind } from "./datasource-types";
import { decryptSecretPayload, encryptSecretPayload } from "./datasource-crypto";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

export interface DatasourceConnectionRow {
  id: string;
  workspace_id: string;
  kind: DatasourceEngineKind;
  label: string;
  description: string;
  secret_ciphertext: Buffer;
  created_at: Date;
  updated_at: Date;
}

interface ConnectionRowDb extends QueryResultRow {
  id: string;
  workspace_id: string;
  kind: string;
  label: string;
  description: string;
  secret_ciphertext: Buffer;
  created_at: Date;
  updated_at: Date;
}

function resolveWorkspaceId(workspaceId: string | undefined): string {
  return workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
}

function mapConnectionRow(row: ConnectionRowDb): DatasourceConnectionRow {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    kind: row.kind as DatasourceEngineKind,
    label: row.label,
    description: row.description,
    secret_ciphertext: row.secret_ciphertext,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function listDatasourceConnections(
  workspaceId?: string,
): Promise<DatasourceConnectionRow[]> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<ConnectionRowDb>(
    `
      select id, workspace_id, kind, label, description, secret_ciphertext, created_at, updated_at
      from datasource_connections
      where workspace_id = $1
      order by created_at asc
    `,
    [resolveWorkspaceId(workspaceId)],
  );
  return result.rows.map(mapConnectionRow);
}

export async function getDatasourceConnectionById(
  id: string,
  workspaceId?: string,
): Promise<DatasourceConnectionRow | undefined> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<ConnectionRowDb>(
    `
      select id, workspace_id, kind, label, description, secret_ciphertext, created_at, updated_at
      from datasource_connections
      where id = $1 and workspace_id = $2
      limit 1
    `,
    [id, resolveWorkspaceId(workspaceId)],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return mapConnectionRow(row);
}

export async function insertDatasourceConnection(input: {
  workspaceId?: string;
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
      insert into datasource_connections (id, workspace_id, kind, label, description, secret_ciphertext)
      values ($1, $2, $3, $4, $5, $6)
      returning id, workspace_id, kind, label, description, secret_ciphertext, created_at, updated_at
    `,
    [
      id,
      resolveWorkspaceId(input.workspaceId),
      input.kind,
      input.label.trim(),
      input.description.trim(),
      ciphertext,
    ],
  );
  const row = result.rows[0];
  return mapConnectionRow(row);
}

export async function deleteDatasourceConnection(
  id: string,
  workspaceId?: string,
): Promise<boolean> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query(
    `delete from datasource_connections where id = $1 and workspace_id = $2`,
    [id, resolveWorkspaceId(workspaceId)],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export function decryptConnectionSecretJson(row: DatasourceConnectionRow): string {
  return decryptSecretPayload(row.secret_ciphertext);
}
