import "server-only";

import { randomUUID } from "crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type {
  CloudPublishRequest,
  CloudSaveDraftRequest,
  DashboardDocument,
  DashboardListMode,
  DashboardSnapshot,
  DashboardSummary,
} from "@/contracts";
import {
  createInitialAuthoringDocument,
  type DashboardMobileLayoutMode,
  ensureLayoutMap,
  reconcileDashboardDocumentContract,
} from "@/domain/dashboard/document";
import {
  dashboardDocumentPersistenceFingerprint,
  normalizeDashboardDocumentForStorage,
} from "@/domain/dashboard/document-fingerprint";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

interface DashboardSnapshotRow extends QueryResultRow {
  dashboard_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  draft_version: number | null;
  draft_document: DashboardDocument | null;
  draft_saved_at: string | Date | null;
  draft_saved_by_user_id: string | null;
  published_version: number | null;
  published_document: DashboardDocument | null;
  published_at: string | Date | null;
}

export interface DatasourceDashboardReferenceSummary {
  datasource_id: string;
  reference_count: number;
  dashboard_ids: string[];
}

export class DraftVersionConflictError extends Error {
  readonly latestVersion: number;

  constructor(message: string, latestVersion: number) {
    super(message);
    this.name = "DraftVersionConflictError";
    this.latestVersion = latestVersion;
  }
}

export class PublishVersionConflictError extends Error {
  readonly latestVersion: number;

  constructor(message: string, latestVersion: number) {
    super(message);
    this.name = "PublishVersionConflictError";
    this.latestVersion = latestVersion;
  }
}

function nowIso(value?: string | Date | null) {
  return new Date(value ?? new Date()).toISOString();
}

function getDefaultDocument() {
  return ensureLayoutMap(createInitialAuthoringDocument());
}

function normalizeDocument(
  document: DashboardDocument,
  mobileLayoutMode: DashboardMobileLayoutMode = "custom",
) {
  return reconcileDashboardDocumentContract(document, {
    mobileLayoutMode,
  });
}

function resolveModeSource(mode: DashboardListMode) {
  return mode === "viewer" ? "published" : "draft";
}

function selectDashboardSnapshot(
  row: DashboardSnapshotRow,
  mode: DashboardListMode,
): DashboardSnapshot | null {
  const preferred = resolveModeSource(mode);
  const allowDraftFallback = mode !== "viewer";
  const draftAvailable = row.draft_version !== null && row.draft_document;
  const publishedAvailable =
    row.published_version !== null && row.published_document;

  if (preferred === "published" && publishedAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      workspace_id: row.workspace_id,
      version: row.published_version as number,
      source: "published",
      updated_at: nowIso(row.published_at),
      document: normalizeDocument(row.published_document as DashboardDocument),
    };
  }

  if (allowDraftFallback && draftAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      workspace_id: row.workspace_id,
      version: row.draft_version as number,
      source: "draft",
      updated_at: nowIso(row.draft_saved_at),
      document: normalizeDocument(row.draft_document as DashboardDocument),
    };
  }

  if (publishedAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      workspace_id: row.workspace_id,
      version: row.published_version as number,
      source: "published",
      updated_at: nowIso(row.published_at),
      document: normalizeDocument(row.published_document as DashboardDocument),
    };
  }

  return null;
}

async function fetchDashboardSnapshotRow(
  workspaceId: string,
  dashboardId: string,
): Promise<DashboardSnapshotRow | null> {
  const pool = getPgPool();
  const result = await pool.query<DashboardSnapshotRow>(
    `
      select
        d.id as dashboard_id,
        d.workspace_id,
        d.name,
        d.description,
        d.created_at,
        d.updated_at,
        ld.version as draft_version,
        ld.dashboard_document as draft_document,
        ld.saved_at as draft_saved_at,
        ld.saved_by_user_id as draft_saved_by_user_id,
        lp.version as published_version,
        lp.dashboard_document as published_document,
        lp.published_at as published_at
      from workspace_dashboards d
      left join lateral (
        select version, dashboard_document, saved_at, saved_by_user_id
        from workspace_dashboard_drafts
        where workspace_id = d.workspace_id and dashboard_id = d.id
        order by version desc
        limit 1
      ) ld on true
      left join lateral (
        select version, dashboard_document, published_at
        from workspace_dashboard_published
        where workspace_id = d.workspace_id and dashboard_id = d.id
        order by version desc
        limit 1
      ) lp on true
      where d.workspace_id = $1 and d.id = $2
      limit 1
    `,
    [workspaceId, dashboardId],
  );

  return result.rows[0] ?? null;
}

export async function listWorkspaceDashboards(
  workspaceId: string,
  mode: DashboardListMode,
): Promise<DashboardSummary[]> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<DashboardSnapshotRow>(
    `
      select
        d.id as dashboard_id,
        d.workspace_id,
        d.name,
        d.description,
        d.created_at,
        d.updated_at,
        ld.version as draft_version,
        ld.dashboard_document as draft_document,
        ld.saved_at as draft_saved_at,
        ld.saved_by_user_id as draft_saved_by_user_id,
        lp.version as published_version,
        lp.dashboard_document as published_document,
        lp.published_at as published_at
      from workspace_dashboards d
      left join lateral (
        select version, dashboard_document, saved_at, saved_by_user_id
        from workspace_dashboard_drafts
        where workspace_id = d.workspace_id and dashboard_id = d.id
        order by version desc
        limit 1
      ) ld on true
      left join lateral (
        select version, dashboard_document, published_at
        from workspace_dashboard_published
        where workspace_id = d.workspace_id and dashboard_id = d.id
        order by version desc
        limit 1
      ) lp on true
      where d.workspace_id = $1
      order by coalesce(ld.saved_at, lp.published_at, d.updated_at) desc
    `,
    [workspaceId],
  );

  return result.rows
    .map((row) => selectDashboardSnapshot(row, mode))
    .filter((snapshot): snapshot is DashboardSnapshot => snapshot !== null)
    .map((snapshot) => ({
      dashboard_id: snapshot.dashboard_id,
      workspace_id: snapshot.workspace_id,
      name: snapshot.document.dashboard_spec.dashboard.name,
      description: snapshot.document.dashboard_spec.dashboard.description,
      updated_at: snapshot.updated_at,
      latest_version: snapshot.version,
      snapshot_source: snapshot.source,
      last_saved_by: result.rows.find(
        (row) => row.dashboard_id === snapshot.dashboard_id,
      )?.draft_saved_by_user_id ?? undefined,
    }));
}

export async function getWorkspaceDashboardSnapshot(input: {
  workspaceId: string;
  dashboardId: string;
  mode: DashboardListMode;
}): Promise<DashboardSnapshot | null> {
  await ensureCloudAuthoringSchema();
  const row = await fetchDashboardSnapshotRow(input.workspaceId, input.dashboardId);
  if (!row) {
    return null;
  }

  return selectDashboardSnapshot(row, input.mode);
}

export async function createWorkspaceDashboard(input: {
  workspaceId: string;
  userId: string;
}): Promise<DashboardSnapshot> {
  await ensureCloudAuthoringSchema();
  const dashboardId = `db_${randomUUID()}`;
  const draftId = `draft_${randomUUID()}`;
  const document = normalizeDashboardDocumentForStorage(getDefaultDocument());
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      `
        insert into workspace_dashboards (id, workspace_id, name, description, created_by_user_id)
        values ($1, $2, $3, $4, $5)
      `,
      [
        dashboardId,
        input.workspaceId,
        document.dashboard_spec.dashboard.name,
        document.dashboard_spec.dashboard.description ?? null,
        input.userId,
      ],
    );
    await client.query(
      `
        insert into workspace_dashboard_drafts (
          id,
          workspace_id,
          dashboard_id,
          version,
          dashboard_document,
          saved_by_user_id
        )
        values ($1, $2, $3, 1, $4::jsonb, $5)
      `,
      [draftId, input.workspaceId, dashboardId, JSON.stringify(document), input.userId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    dashboard_id: dashboardId,
    workspace_id: input.workspaceId,
    version: 1,
    source: "draft",
    updated_at: nowIso(),
    document,
  };
}

async function resolveNextDraftVersion(
  client: PoolClient,
  workspaceId: string,
  dashboardId: string,
) {
  const result = await client.query<{ next_version: number }>(
    `
      select coalesce(max(version), 0) + 1 as next_version
      from workspace_dashboard_drafts
      where workspace_id = $1 and dashboard_id = $2
    `,
    [workspaceId, dashboardId],
  );

  return result.rows[0]?.next_version ?? 1;
}

async function lockWorkspaceDashboard(
  client: PoolClient,
  workspaceId: string,
  dashboardId: string,
) {
  const result = await client.query<{ id: string }>(
    `
      select id
      from workspace_dashboards
      where workspace_id = $1 and id = $2
      for update
    `,
    [workspaceId, dashboardId],
  );

  if (result.rows.length === 0) {
    throw new Error("DASHBOARD_NOT_FOUND");
  }
}

async function fetchLatestDraftRecord(
  client: PoolClient,
  workspaceId: string,
  dashboardId: string,
) {
  const result = await client.query<{
    id: string;
    version: number;
    dashboard_document: DashboardDocument;
    saved_at: string | Date;
  }>(
    `
      select id, version, dashboard_document, saved_at
      from workspace_dashboard_drafts
      where workspace_id = $1 and dashboard_id = $2
      order by version desc
      limit 1
    `,
    [workspaceId, dashboardId],
  );

  return result.rows[0] ?? null;
}

export async function saveWorkspaceDashboardDraft(
  input: CloudSaveDraftRequest,
): Promise<{ version: number; saved_at: string; changed: boolean }> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const client = await pool.connect();
  const draftId = `draft_${randomUUID()}`;
  const storedBody = normalizeDashboardDocumentForStorage(input.draft);
  const incomingFingerprint = dashboardDocumentPersistenceFingerprint(storedBody);
  const serializedDocument = JSON.stringify(storedBody);

  try {
    await client.query("begin");
    await lockWorkspaceDashboard(client, input.workspaceId, input.dashboardId);
    const latestDraft = await fetchLatestDraftRecord(
      client,
      input.workspaceId,
      input.dashboardId,
    );

    if (!latestDraft) {
      throw new Error("DASHBOARD_DRAFT_NOT_FOUND");
    }

    const latestFingerprint = dashboardDocumentPersistenceFingerprint(
      latestDraft.dashboard_document,
    );

    if (!input.force && input.expectedDraftVersion !== latestDraft.version) {
      throw new DraftVersionConflictError(
        `Dashboard draft is not current. Latest version is ${latestDraft.version}.`,
        latestDraft.version,
      );
    }

    if (!input.force && input.expectedDocumentHash !== latestFingerprint) {
      throw new DraftVersionConflictError(
        `Dashboard draft hash is not current. Latest version is ${latestDraft.version}.`,
        latestDraft.version,
      );
    }

    if (latestFingerprint === incomingFingerprint) {
      await client.query("rollback");
      return {
        version: latestDraft.version,
        saved_at: nowIso(latestDraft.saved_at),
        changed: false,
      };
    }

    const nextVersion = await resolveNextDraftVersion(
      client,
      input.workspaceId,
      input.dashboardId,
    );

    await client.query(
      `
        insert into workspace_dashboard_drafts (
          id,
          workspace_id,
          dashboard_id,
          version,
          dashboard_document,
          saved_by_user_id
        )
        values ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        draftId,
        input.workspaceId,
        input.dashboardId,
        nextVersion,
        serializedDocument,
        input.userId,
      ],
    );
    await client.query(
      `
        update workspace_dashboards
        set
          name = $3,
          description = $4,
          updated_at = now()
        where workspace_id = $1 and id = $2
      `,
      [
        input.workspaceId,
        input.dashboardId,
        storedBody.dashboard_spec.dashboard.name,
        storedBody.dashboard_spec.dashboard.description ?? null,
      ],
    );
    await client.query(
      `
        update editing_presence
        set last_saved_at = now()
        where workspace_id = $1 and dashboard_id = $2 and user_id = $3
      `,
      [input.workspaceId, input.dashboardId, input.userId],
    );
    await client.query("commit");

    return {
      version: nextVersion,
      saved_at: nowIso(),
      changed: true,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function publishWorkspaceDashboard(
  input: CloudPublishRequest,
): Promise<{ version: number; published_at: string; changed: boolean }> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const client = await pool.connect();
  const publishId = `pub_${randomUUID()}`;

  try {
    await client.query("begin");
    await lockWorkspaceDashboard(client, input.workspaceId, input.dashboardId);
    const latestDraft = await fetchLatestDraftRecord(
      client,
      input.workspaceId,
      input.dashboardId,
    );
    if (!latestDraft) {
      throw new Error("DASHBOARD_DRAFT_NOT_FOUND");
    }

    if (latestDraft.version !== input.draftVersion) {
      throw new PublishVersionConflictError(
        `Dashboard publish expects head version ${latestDraft.version}.`,
        latestDraft.version,
      );
    }

    const latestDraftFingerprint = dashboardDocumentPersistenceFingerprint(
      latestDraft.dashboard_document,
    );
    if (latestDraftFingerprint !== input.documentHash) {
      throw new PublishVersionConflictError(
        `Dashboard publish expects document hash ${latestDraftFingerprint}.`,
        latestDraft.version,
      );
    }

    const publishedFingerprint = await client.query<{
      version: number;
      dashboard_document: DashboardDocument;
      published_at: string | Date;
    }>(
      `
        select version, dashboard_document, published_at
        from workspace_dashboard_published
        where workspace_id = $1 and dashboard_id = $2
        order by version desc
        limit 1
      `,
      [input.workspaceId, input.dashboardId],
    );

    const latestPublished = publishedFingerprint.rows[0] ?? null;
    if (
      latestPublished &&
      latestPublished.version === latestDraft.version &&
      dashboardDocumentPersistenceFingerprint(latestPublished.dashboard_document) ===
        dashboardDocumentPersistenceFingerprint(latestDraft.dashboard_document)
    ) {
      await client.query("rollback");
      return {
        version: latestPublished.version,
        published_at: nowIso(latestPublished.published_at),
        changed: false,
      };
    }

    await client.query(
      `
        insert into workspace_dashboard_published (
          id,
          workspace_id,
          dashboard_id,
          version,
          dashboard_document,
          published_by_user_id
        )
        values ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        publishId,
        input.workspaceId,
        input.dashboardId,
        latestDraft.version,
        JSON.stringify(latestDraft.dashboard_document),
        input.userId,
      ],
    );
    await client.query("commit");

    return {
      version: latestDraft.version,
      published_at: nowIso(),
      changed: true,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findDatasourceDashboardReferences(
  datasourceId: string,
  sampleLimit = 20,
): Promise<DatasourceDashboardReferenceSummary> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<{ dashboard_id: string }>(
    `
      with latest_drafts as (
        select distinct on (workspace_id, dashboard_id)
          workspace_id,
          dashboard_id,
          dashboard_document
        from workspace_dashboard_drafts
        order by workspace_id, dashboard_id, version desc
      ),
      latest_published as (
        select distinct on (workspace_id, dashboard_id)
          workspace_id,
          dashboard_id,
          dashboard_document
        from workspace_dashboard_published
        order by workspace_id, dashboard_id, version desc
      ),
      candidate_documents as (
        select dashboard_id, dashboard_document from latest_drafts
        union all
        select dashboard_id, dashboard_document from latest_published
      ),
      referenced_dashboards as (
        select distinct dashboard_id
        from candidate_documents
        where exists (
          select 1
          from jsonb_array_elements(
            coalesce(dashboard_document -> 'query_defs', '[]'::jsonb)
          ) query_def
          where query_def ->> 'datasource_id' = $1
        )
      )
      select dashboard_id
      from referenced_dashboards
      order by dashboard_id asc
    `,
    [datasourceId],
  );
  const dashboardIds = result.rows.map((row) => row.dashboard_id);

  return {
    datasource_id: datasourceId,
    reference_count: dashboardIds.length,
    dashboard_ids: dashboardIds.slice(0, sampleLimit),
  };
}

export async function deleteWorkspaceDashboard(input: {
  workspaceId: string;
  dashboardId: string;
}) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  await pool.query(
    `
      delete from workspace_dashboards
      where workspace_id = $1 and id = $2
    `,
    [input.workspaceId, input.dashboardId],
  );
}

export async function unpublishWorkspaceDashboard(input: {
  workspaceId: string;
  dashboardId: string;
}) {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  await pool.query(
    `
      delete from workspace_dashboard_published
      where workspace_id = $1 and dashboard_id = $2
    `,
    [input.workspaceId, input.dashboardId],
  );
}
