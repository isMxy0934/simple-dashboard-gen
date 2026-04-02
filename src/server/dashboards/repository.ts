import "server-only";

import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import {
  createInitialAuthoringDocument,
  ensureLayoutMap,
  reconcileDashboardDocumentContract,
} from "../../domain/dashboard/document";
import {
  dashboardDocumentPersistenceFingerprint,
  normalizeDashboardDocumentForStorage,
  type DashboardPersistPayload,
} from "../../domain/dashboard/document-fingerprint";
import type {
  DashboardDocument,
  DashboardListMode,
  DashboardSnapshot,
  DashboardSnapshotSource,
  DashboardSummary,
} from "../../contracts";
import { getPgPool } from "../datasource/postgres";

function nowIso(timestamp: string | Date) {
  return new Date(timestamp).toISOString();
}

function getDefaultDocument() {
  return ensureLayoutMap(createInitialAuthoringDocument());
}

function getPreferredSource(mode: DashboardListMode): DashboardSnapshotSource {
  return mode === "viewer" ? "published" : "draft";
}

function selectSnapshotRecord(
  row: {
    dashboard_id: string;
    draft_version: number | null;
    draft_document: DashboardDocument | null;
    draft_updated_at: string | Date | null;
    published_version: number | null;
    published_document: DashboardDocument | null;
    published_updated_at: string | Date | null;
  },
  mode: DashboardListMode,
): DashboardSnapshot | null {
  const preferred = getPreferredSource(mode);
  const allowDraftFallback = mode !== "viewer";
  const draftAvailable = row.draft_version !== null && row.draft_document;
  const publishedAvailable =
    row.published_version !== null && row.published_document;

  if (preferred === "published" && publishedAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      version: row.published_version as number,
      source: "published",
      updated_at: nowIso(row.published_updated_at as string | Date),
      document: normalizeSnapshotDocument(row.published_document as DashboardDocument),
    };
  }

  if (allowDraftFallback && draftAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      version: row.draft_version as number,
      source: "draft",
      updated_at: nowIso(row.draft_updated_at as string | Date),
      document: normalizeSnapshotDocument(row.draft_document as DashboardDocument),
    };
  }

  if (publishedAvailable) {
    return {
      dashboard_id: row.dashboard_id,
      version: row.published_version as number,
      source: "published",
      updated_at: nowIso(row.published_updated_at as string | Date),
      document: normalizeSnapshotDocument(row.published_document as DashboardDocument),
    };
  }

  return null;
}

function normalizeSnapshotDocument(document: DashboardDocument): DashboardDocument {
  return reconcileDashboardDocumentContract(document, {
    mobileLayoutMode: "auto",
  });
}

async function fetchDashboardSnapshotRow(dashboardId: string) {
  const pool = getPgPool();
  const result = await pool.query<{
    dashboard_id: string;
    draft_version: number | null;
    draft_document: DashboardDocument | null;
    draft_updated_at: string | Date | null;
    published_version: number | null;
    published_document: DashboardDocument | null;
    published_updated_at: string | Date | null;
  }>(
    `
      select
        d.id as dashboard_id,
        ld.version as draft_version,
        ld.dashboard_document as draft_document,
        ld.saved_at as draft_updated_at,
        lp.version as published_version,
        lp.dashboard_document as published_document,
        lp.published_at as published_updated_at
      from dashboards d
      left join lateral (
        select version, dashboard_document, saved_at
        from dashboard_drafts
        where dashboard_id = d.id
        order by version desc
        limit 1
      ) ld on true
      left join lateral (
        select version, dashboard_document, published_at
        from dashboard_published
        where dashboard_id = d.id
        order by version desc
        limit 1
      ) lp on true
      where d.id = $1
      limit 1
    `,
    [dashboardId],
  );

  return result.rows[0] ?? null;
}

export async function listDashboards(
  mode: DashboardListMode,
): Promise<DashboardSummary[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    dashboard_id: string;
    draft_version: number | null;
    draft_document: DashboardDocument | null;
    draft_updated_at: string | Date | null;
    published_version: number | null;
    published_document: DashboardDocument | null;
    published_updated_at: string | Date | null;
  }>(
    `
      select
        d.id as dashboard_id,
        ld.version as draft_version,
        ld.dashboard_document as draft_document,
        ld.saved_at as draft_updated_at,
        lp.version as published_version,
        lp.dashboard_document as published_document,
        lp.published_at as published_updated_at
      from dashboards d
      left join lateral (
        select version, dashboard_document, saved_at
        from dashboard_drafts
        where dashboard_id = d.id
        order by version desc
        limit 1
      ) ld on true
      left join lateral (
        select version, dashboard_document, published_at
        from dashboard_published
        where dashboard_id = d.id
        order by version desc
        limit 1
      ) lp on true
      order by coalesce(ld.saved_at, lp.published_at, d.updated_at) desc
    `,
  );

  return result.rows
    .map((row) => selectSnapshotRecord(row, mode))
    .filter((snapshot): snapshot is DashboardSnapshot => snapshot !== null)
    .map((snapshot) => ({
      dashboard_id: snapshot.dashboard_id,
      name: snapshot.document.dashboard_spec.dashboard.name,
      description: snapshot.document.dashboard_spec.dashboard.description,
      updated_at: snapshot.updated_at,
      latest_version: snapshot.version,
      snapshot_source: snapshot.source,
    }));
}

export async function getDashboardSnapshot(
  dashboardId: string,
  mode: DashboardListMode,
): Promise<DashboardSnapshot | null> {
  const row = await fetchDashboardSnapshotRow(dashboardId);
  if (!row) {
    return null;
  }

  return selectSnapshotRecord(row, mode);
}

export async function createDashboard(): Promise<DashboardSnapshot> {
  const pool = getPgPool();
  const client = await pool.connect();
  const dashboardId = `db_${randomUUID()}`;
  const draftId = `draft_${randomUUID()}`;
  const document = getDefaultDocument();
  const storedDocument = normalizeDashboardDocumentForStorage(document);

  try {
    await client.query("begin");
    await client.query(
      `
        insert into dashboards (id, name, description)
        values ($1, $2, $3)
      `,
      [
        dashboardId,
        storedDocument.dashboard_spec.dashboard.name,
        storedDocument.dashboard_spec.dashboard.description ?? null,
      ],
    );
    await client.query(
      `
        insert into dashboard_drafts (id, dashboard_id, version, dashboard_document)
        values ($1, $2, 1, $3::jsonb)
      `,
      [draftId, dashboardId, JSON.stringify(storedDocument)],
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
    version: 1,
    source: "draft",
    updated_at: new Date().toISOString(),
    document: storedDocument,
  };
}

export async function saveDashboardDraft(input: {
  dashboardId: string;
  document: DashboardPersistPayload;
}) {
  const pool = getPgPool();
  const client = await pool.connect();
  const draftId = `draft_${randomUUID()}`;
  const incomingFingerprint = dashboardDocumentPersistenceFingerprint(input.document);
  const storedBody = normalizeDashboardDocumentForStorage(input.document);
  const serializedDocument = JSON.stringify(storedBody);

  try {
    await client.query("begin");
    const latestDraft = await fetchLatestDraftRecord(client, input.dashboardId);
    if (
      latestDraft?.dashboard_document &&
      dashboardDocumentPersistenceFingerprint(latestDraft.dashboard_document) ===
        incomingFingerprint
    ) {
      await client.query("rollback");
      return {
        draft_id: latestDraft.id,
        version: latestDraft.version,
        saved_at: nowIso(latestDraft.saved_at),
        changed: false,
      };
    }

    const nextVersion = await resolveNextDraftVersion(client, input.dashboardId);
    await client.query(
      `
        insert into dashboard_drafts (id, dashboard_id, version, dashboard_document)
        values ($1, $2, $3, $4::jsonb)
      `,
      [draftId, input.dashboardId, nextVersion, serializedDocument],
    );
    await client.query(
      `
        update dashboards
        set
          name = $2,
          description = $3,
          updated_at = now()
        where id = $1
      `,
      [
        input.dashboardId,
        storedBody.dashboard_spec.dashboard.name,
        storedBody.dashboard_spec.dashboard.description ?? null,
      ],
    );
    await client.query("commit");

    return {
      draft_id: draftId,
      version: nextVersion,
      saved_at: new Date().toISOString(),
      changed: true,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function publishDashboard(input: {
  dashboardId: string;
  document: DashboardPersistPayload;
}) {
  const pool = getPgPool();
  const client = await pool.connect();
  const publishId = `pub_${randomUUID()}`;
  const incomingFingerprint = dashboardDocumentPersistenceFingerprint(input.document);
  const storedBody = normalizeDashboardDocumentForStorage(input.document);
  const serializedDocument = JSON.stringify(storedBody);

  try {
    await client.query("begin");
    const latestDraft = await fetchLatestDraftRecord(client, input.dashboardId);
    let effectiveVersion = latestDraft?.version ?? 0;

    if (
      !latestDraft?.dashboard_document ||
      dashboardDocumentPersistenceFingerprint(latestDraft.dashboard_document) !==
        incomingFingerprint
    ) {
      effectiveVersion = await resolveNextDraftVersion(client, input.dashboardId);
      await client.query(
        `
          insert into dashboard_drafts (id, dashboard_id, version, dashboard_document)
          values ($1, $2, $3, $4::jsonb)
        `,
        [`draft_${randomUUID()}`, input.dashboardId, effectiveVersion, serializedDocument],
      );
      await client.query(
        `
          update dashboards
          set
            name = $2,
            description = $3,
            updated_at = now()
          where id = $1
        `,
        [
          input.dashboardId,
          storedBody.dashboard_spec.dashboard.name,
          storedBody.dashboard_spec.dashboard.description ?? null,
        ],
      );
    }

    const latestPublished = await fetchLatestPublishedRecord(client, input.dashboardId);
    if (
      latestPublished?.dashboard_document &&
      dashboardDocumentPersistenceFingerprint(latestPublished.dashboard_document) ===
        incomingFingerprint &&
      latestPublished.version === effectiveVersion
    ) {
      await client.query("rollback");
      return {
        published_id: latestPublished.id,
        version: latestPublished.version,
        published_at: nowIso(latestPublished.published_at),
        changed: false,
      };
    }

    await client.query(
      `
        delete from dashboard_published
        where dashboard_id = $1
      `,
      [input.dashboardId],
    );
    await client.query(
      `
        insert into dashboard_published (id, dashboard_id, version, dashboard_document)
        values ($1, $2, $3, $4::jsonb)
      `,
      [publishId, input.dashboardId, effectiveVersion, serializedDocument],
    );
    await client.query(
      `
        update dashboards
        set
          name = $2,
          description = $3,
          updated_at = now()
        where id = $1
      `,
      [
        input.dashboardId,
        storedBody.dashboard_spec.dashboard.name,
        storedBody.dashboard_spec.dashboard.description ?? null,
      ],
    );
    await client.query("commit");

    return {
      published_id: publishId,
      version: effectiveVersion,
      published_at: new Date().toISOString(),
      changed: true,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveNextDraftVersion(client: PoolClient, dashboardId: string) {
  const result = await client.query<{ next_version: number }>(
    `
      select coalesce(max(version), 0) + 1 as next_version
      from dashboard_drafts
      where dashboard_id = $1
    `,
    [dashboardId],
  );

  return result.rows[0]?.next_version ?? 1;
}

async function fetchLatestDraftRecord(client: PoolClient, dashboardId: string) {
  const result = await client.query<{
    id: string;
    version: number;
    dashboard_document: DashboardDocument;
    saved_at: string | Date;
  }>(
    `
      select id, version, dashboard_document, saved_at
      from dashboard_drafts
      where dashboard_id = $1
      order by version desc
      limit 1
    `,
    [dashboardId],
  );

  return result.rows[0] ?? null;
}

async function fetchLatestPublishedRecord(client: PoolClient, dashboardId: string) {
  const result = await client.query<{
    id: string;
    version: number;
    dashboard_document: DashboardDocument;
    published_at: string | Date;
  }>(
    `
      select id, version, dashboard_document, published_at
      from dashboard_published
      where dashboard_id = $1
      order by version desc
      limit 1
    `,
    [dashboardId],
  );

  return result.rows[0] ?? null;
}

export async function deleteDashboard(dashboardId: string) {
  const pool = getPgPool();
  await pool.query("delete from dashboards where id = $1", [dashboardId]);
}

export async function unpublishDashboard(dashboardId: string) {
  const pool = getPgPool();
  await pool.query(
    `
      delete from dashboard_published
      where dashboard_id = $1
    `,
    [dashboardId],
  );
}
