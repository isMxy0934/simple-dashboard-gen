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
  DashboardTemplateRef,
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
  references: DatasourceDashboardReferenceDetail[];
}

export type DatasourceDashboardReferenceSource =
  | "draft"
  | "published"
  | "draft_and_published";

export interface DatasourceDashboardReferenceDetail {
  dashboard_id: string;
  workspace_id: string;
  name: string;
  description: string;
  source: DatasourceDashboardReferenceSource;
  updated_at: string;
  latest_version: number;
  query_count: number;
  binding_count: number;
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

function getDefaultDocument(templateRef?: DashboardTemplateRef) {
  return ensureLayoutMap(createInitialAuthoringDocument(templateRef));
}

function normalizeDocument(
  document: DashboardDocument,
  mobileLayoutMode: DashboardMobileLayoutMode = "custom",
) {
  return reconcileDashboardDocumentContract(document, {
    mobileLayoutMode,
  });
}

function normalizeDocumentForPersistence(
  document: DashboardDocument,
  mobileLayoutMode: DashboardMobileLayoutMode = "custom",
) {
  return normalizeDashboardDocumentForStorage(
    normalizeDocument(document, mobileLayoutMode),
  );
}

function documentPersistenceFingerprint(document: DashboardDocument) {
  return dashboardDocumentPersistenceFingerprint(
    normalizeDocumentForPersistence(document),
  );
}

function resolveModeSource(mode: DashboardListMode) {
  return mode === "viewer" ? "published" : "draft";
}

function tryNormalizeDocument(
  raw: DashboardDocument,
  mobileLayoutMode?: DashboardMobileLayoutMode,
): DashboardDocument {
  try {
    return normalizeDocument(raw, mobileLayoutMode);
  } catch {
    return raw;
  }
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
      document: tryNormalizeDocument(row.published_document as DashboardDocument),
    };
  }

  if (allowDraftFallback && draftAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      workspace_id: row.workspace_id,
      version: row.draft_version as number,
      source: "draft",
      updated_at: nowIso(row.draft_saved_at),
      document: tryNormalizeDocument(row.draft_document as DashboardDocument),
    };
  }

  if (publishedAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      workspace_id: row.workspace_id,
      version: row.published_version as number,
      source: "published",
      updated_at: nowIso(row.published_at),
      document: tryNormalizeDocument(row.published_document as DashboardDocument),
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
  templateRef?: DashboardTemplateRef;
}): Promise<DashboardSnapshot> {
  await ensureCloudAuthoringSchema();
  const dashboardId = `db_${randomUUID()}`;
  const draftId = `draft_${randomUUID()}`;
  const document = normalizeDashboardDocumentForStorage(
    getDefaultDocument(input.templateRef),
  );
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
  const storedBody = normalizeDocumentForPersistence(input.draft);
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

    const latestFingerprint = documentPersistenceFingerprint(
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

    const latestDraftForPersistence = normalizeDocumentForPersistence(
      latestDraft.dashboard_document,
    );
    const latestDraftFingerprint = dashboardDocumentPersistenceFingerprint(
      latestDraftForPersistence,
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
      documentPersistenceFingerprint(latestPublished.dashboard_document) ===
        latestDraftFingerprint
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
        JSON.stringify(latestDraftForPersistence),
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
  const result = await pool.query<DashboardSnapshotRow>(
    `
      with latest_drafts as (
        select distinct on (workspace_id, dashboard_id)
          workspace_id,
          dashboard_id,
          version,
          saved_at,
          saved_by_user_id,
          dashboard_document
        from workspace_dashboard_drafts
        order by workspace_id, dashboard_id, version desc
      ),
      latest_published as (
        select distinct on (workspace_id, dashboard_id)
          workspace_id,
          dashboard_id,
          version,
          published_at,
          dashboard_document
        from workspace_dashboard_published
        order by workspace_id, dashboard_id, version desc
      )
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
      left join latest_drafts ld
        on ld.workspace_id = d.workspace_id and ld.dashboard_id = d.id
      left join latest_published lp
        on lp.workspace_id = d.workspace_id and lp.dashboard_id = d.id
      where
        exists (
          select 1
          from jsonb_array_elements(
            coalesce(ld.dashboard_document -> 'query_defs', '[]'::jsonb)
          ) query_def
          where query_def ->> 'datasource_id' = $1
        )
        or exists (
          select 1
          from jsonb_array_elements(
            coalesce(lp.dashboard_document -> 'query_defs', '[]'::jsonb)
          ) query_def
          where query_def ->> 'datasource_id' = $1
        )
      order by d.updated_at desc, d.id asc
    `,
    [datasourceId],
  );
  const references = result.rows.map((row) =>
    buildDatasourceDashboardReference(row, datasourceId),
  );
  const dashboardIds = references.map((row) => row.dashboard_id);

  return {
    datasource_id: datasourceId,
    reference_count: references.length,
    dashboard_ids: dashboardIds.slice(0, sampleLimit),
    references: references.slice(0, sampleLimit),
  };
}

function buildDatasourceDashboardReference(
  row: DashboardSnapshotRow,
  datasourceId: string,
): DatasourceDashboardReferenceDetail {
  const draftUsage = countDatasourceDocumentUsage(row.draft_document, datasourceId);
  const publishedUsage = countDatasourceDocumentUsage(row.published_document, datasourceId);
  const hasDraftUsage = draftUsage.query_count > 0;
  const hasPublishedUsage = publishedUsage.query_count > 0;
  const source: DatasourceDashboardReferenceSource =
    hasDraftUsage && hasPublishedUsage
      ? "draft_and_published"
      : hasPublishedUsage
        ? "published"
        : "draft";
  const activeUsage = hasDraftUsage ? draftUsage : publishedUsage;
  const updatedAt =
    hasDraftUsage
      ? row.draft_saved_at ?? row.updated_at
      : row.published_at ?? row.updated_at;
  const latestVersion =
    hasDraftUsage
      ? row.draft_version ?? row.published_version ?? 0
      : row.published_version ?? row.draft_version ?? 0;

  return {
    dashboard_id: row.dashboard_id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description ?? "",
    source,
    updated_at: nowIso(updatedAt),
    latest_version: latestVersion,
    query_count: activeUsage.query_count,
    binding_count: activeUsage.binding_count,
  };
}

function countDatasourceDocumentUsage(
  document: DashboardDocument | null,
  datasourceId: string,
) {
  const queryIds = new Set(
    (document?.query_defs ?? [])
      .filter((query) => query.datasource_id === datasourceId)
      .map((query) => query.id),
  );

  return {
    query_count: queryIds.size,
    binding_count: (document?.bindings ?? []).filter(
      (binding) => binding.query_id !== undefined && queryIds.has(binding.query_id),
    ).length,
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
