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
  EditingPresenceEntry,
  MainAgentSessionPayload,
  OpenSessionRequest,
  OpenSessionResponse,
  SaveSessionRequest,
  WorkspaceContextPayload,
  WorkspaceMember,
  WorkspaceUserSettings,
} from "@/contracts";
import {
  createInitialAuthoringDocument,
  ensureLayoutMap,
  reconcileDashboardDocumentContract,
} from "@/domain/dashboard/document";
import {
  dashboardDocumentPersistenceFingerprint,
  normalizeDashboardDocumentForStorage,
} from "@/domain/dashboard/document-fingerprint";
import { getPgPool } from "@/server/datasource/postgres";

const DEFAULT_WORKSPACE_ID = "ws_default";
const DEFAULT_WORKSPACE_NAME = "Default Workspace";
const DEFAULT_WORKSPACE_USERS = [
  {
    user_id: "usr_alice",
    name: "Alice",
    email: "alice@example.com",
  },
  {
    user_id: "usr_bob",
    name: "Bob",
    email: "bob@example.com",
  },
  {
    user_id: "usr_chen",
    name: "Chen",
    email: "chen@example.com",
  },
] as const;
const ACTIVE_PRESENCE_WINDOW_MS = 60_000;

declare global {
  var __cloudAuthoringSchemaReady: Promise<void> | undefined;
}

interface WorkspaceUserRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string | null;
}

interface WorkspaceUserSettingsRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  verbose: boolean;
  updated_at: string | Date;
}

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

interface EditingSessionRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  dashboard_id: string;
  session_id: string;
  payload: MainAgentSessionPayload;
  dirty: boolean;
  base_version: number;
  focus_view_id: string | null;
  last_seen_at: string | Date;
  updated_at: string | Date;
}

interface PresenceRow extends QueryResultRow {
  workspace_id: string;
  dashboard_id: string;
  user_id: string;
  session_id: string;
  last_seen_at: string | Date;
  last_saved_at: string | Date | null;
  name: string;
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

function normalizeDocument(document: DashboardDocument) {
  return reconcileDashboardDocumentContract(document, {
    mobileLayoutMode: "auto",
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyDashboardWorkerState() {
  return {
    memorySummary: "",
    recentTurns: [],
    lastRunAt: null,
  };
}

function sanitizeFocusViewId(
  dashboard: DashboardDocument,
  focusViewId: string | null | undefined,
) {
  if (
    focusViewId &&
    dashboard.dashboard_spec.views.some((view) => view.id === focusViewId)
  ) {
    return focusViewId;
  }

  return dashboard.dashboard_spec.views[0]?.id ?? null;
}

function buildDefaultSessionPayload(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  baseVersion: number;
  dashboard: DashboardDocument;
}): MainAgentSessionPayload {
  const canonicalDraft = normalizeDocument(input.dashboard);
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    dashboardId: input.dashboardId,
    sessionId: input.sessionId,
    focusViewId: sanitizeFocusViewId(canonicalDraft, null),
    baseVersion: input.baseVersion,
    dirty: false,
    stale: false,
    canonicalDraft,
    dashboardWorkerState: emptyDashboardWorkerState(),
    viewWorkerStatesByViewId: {},
    approvalState: {
      pending: false,
      lastSuggestionId: null,
    },
    updatedAt: nowIso(),
  };
}

function normalizeSessionPayload(
  payload: MainAgentSessionPayload,
  latestDashboard: DashboardDocument,
  headVersion: number,
): MainAgentSessionPayload {
  const canonicalDraft = normalizeDocument(payload.canonicalDraft);
  const focusViewId = sanitizeFocusViewId(canonicalDraft, payload.focusViewId);
  const stale = payload.baseVersion < headVersion;
  const latest = normalizeDocument(latestDashboard);

  return {
    ...payload,
    focusViewId,
    stale,
    canonicalDraft: payload.dirty ? canonicalDraft : latest,
    baseVersion: payload.dirty ? payload.baseVersion : headVersion,
    updatedAt: nowIso(payload.updatedAt),
  };
}

async function ensureCloudAuthoringSchema() {
  if (!globalThis.__cloudAuthoringSchemaReady) {
    globalThis.__cloudAuthoringSchemaReady = createCloudAuthoringSchema();
  }

  await globalThis.__cloudAuthoringSchemaReady;
}

async function createCloudAuthoringSchema() {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(`
      create table if not exists workspaces (
        id text primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table if not exists workspace_users (
        workspace_id text not null references workspaces(id) on delete cascade,
        user_id text not null,
        name text not null,
        email text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (workspace_id, user_id)
      )
    `);

    await client.query(`
      create table if not exists workspace_user_settings (
        workspace_id text not null references workspaces(id) on delete cascade,
        user_id text not null,
        verbose_enabled boolean not null default false,
        updated_at timestamptz not null default now(),
        primary key (workspace_id, user_id)
      )
    `);

    await client.query(`
      create table if not exists workspace_dashboards (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        name text not null,
        description text,
        created_by_user_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table if not exists workspace_dashboard_drafts (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        version integer not null,
        dashboard_document jsonb not null,
        saved_by_user_id text,
        saved_at timestamptz not null default now(),
        unique (workspace_id, dashboard_id, version)
      )
    `);

    await client.query(`
      create table if not exists workspace_dashboard_published (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        version integer not null,
        dashboard_document jsonb not null,
        published_by_user_id text,
        published_at timestamptz not null default now(),
        unique (workspace_id, dashboard_id, version)
      )
    `);

    await client.query(`
      create table if not exists editing_sessions (
        workspace_id text not null references workspaces(id) on delete cascade,
        user_id text not null,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        session_id text not null,
        payload jsonb not null,
        dirty boolean not null default false,
        base_version integer not null,
        focus_view_id text,
        last_seen_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (workspace_id, user_id, dashboard_id, session_id)
      )
    `);

    await client.query(`
      create table if not exists editing_presence (
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        user_id text not null,
        session_id text not null,
        last_seen_at timestamptz not null default now(),
        last_saved_at timestamptz,
        primary key (workspace_id, dashboard_id, user_id, session_id)
      )
    `);

    await client.query(`
      create table if not exists worker_checks (
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        view_id text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (workspace_id, dashboard_id, view_id)
      )
    `);

    await client.query(
      `
        insert into workspaces (id, name)
        values ($1, $2)
        on conflict (id)
        do update set name = excluded.name, updated_at = now()
      `,
      [DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME],
    );

    for (const user of DEFAULT_WORKSPACE_USERS) {
      await client.query(
        `
          insert into workspace_users (workspace_id, user_id, name, email)
          values ($1, $2, $3, $4)
          on conflict (workspace_id, user_id)
          do update set
            name = excluded.name,
            email = excluded.email,
            updated_at = now()
        `,
        [DEFAULT_WORKSPACE_ID, user.user_id, user.name, user.email],
      );
    }

    for (const user of DEFAULT_WORKSPACE_USERS) {
      await client.query(
        `
          insert into workspace_user_settings (workspace_id, user_id, verbose_enabled)
          values ($1, $2, false)
          on conflict (workspace_id, user_id)
          do nothing
        `,
        [DEFAULT_WORKSPACE_ID, user.user_id],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function selectWorkspaceUserSettings(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceUserSettings> {
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      select workspace_id, user_id, verbose_enabled as verbose, updated_at
      from workspace_user_settings
      where workspace_id = $1 and user_id = $2
      limit 1
    `,
    [workspaceId, userId],
  );

  const row = result.rows[0];
  return {
    workspace_id: row?.workspace_id ?? workspaceId,
    user_id: row?.user_id ?? userId,
    verbose: row?.verbose ?? false,
    updated_at: nowIso(row?.updated_at),
  };
}

export async function getWorkspaceContext(
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<WorkspaceContextPayload> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const usersResult = await pool.query<WorkspaceUserRow>(
    `
      select workspace_id, user_id, name, email
      from workspace_users
      where workspace_id = $1
      order by name asc
    `,
    [workspaceId],
  );
  return {
    workspace_id: workspaceId,
    workspace_name: DEFAULT_WORKSPACE_NAME,
    users: usersResult.rows.map((row) => ({
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      name: row.name,
      email: row.email ?? undefined,
    })),
  };
}

export async function getWorkspaceUserSettings(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceUserSettings> {
  await ensureCloudAuthoringSchema();
  return selectWorkspaceUserSettings(input.workspaceId, input.userId);
}

export async function updateWorkspaceUserVerboseSetting(input: {
  workspaceId: string;
  userId: string;
  verbose: boolean;
}): Promise<WorkspaceUserSettings> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      insert into workspace_user_settings (workspace_id, user_id, verbose_enabled)
      values ($1, $2, $3)
      on conflict (workspace_id, user_id)
      do update set verbose_enabled = excluded.verbose_enabled, updated_at = now()
      returning workspace_id, user_id, verbose_enabled as verbose, updated_at
    `,
    [input.workspaceId, input.userId, input.verbose],
  );

  const row = result.rows[0];
  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    verbose: row.verbose,
    updated_at: nowIso(row.updated_at),
  };
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

export async function createWorkspaceDashboard(input?: {
  workspaceId?: string;
  userId?: string;
}): Promise<DashboardSnapshot> {
  await ensureCloudAuthoringSchema();
  const workspaceId = input?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const userId = input?.userId ?? DEFAULT_WORKSPACE_USERS[0].user_id;
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
        workspaceId,
        document.dashboard_spec.dashboard.name,
        document.dashboard_spec.dashboard.description ?? null,
        userId,
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
      [draftId, workspaceId, dashboardId, JSON.stringify(document), userId],
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
    workspace_id: workspaceId,
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
    const latestDraft = await fetchLatestDraftRecord(
      client,
      input.workspaceId,
      input.dashboardId,
    );

    if (!latestDraft) {
      throw new Error("DASHBOARD_DRAFT_NOT_FOUND");
    }

    if (!input.force && input.baseVersion < latestDraft.version) {
      throw new DraftVersionConflictError(
        `Dashboard draft is not current. Latest version is ${latestDraft.version}.`,
        latestDraft.version,
      );
    }

    if (
      dashboardDocumentPersistenceFingerprint(latestDraft.dashboard_document) ===
      incomingFingerprint
    ) {
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
        delete from workspace_dashboard_published
        where workspace_id = $1 and dashboard_id = $2
      `,
      [input.workspaceId, input.dashboardId],
    );
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

async function upsertEditingPresence(input: {
  workspaceId: string;
  dashboardId: string;
  userId: string;
  sessionId: string;
}) {
  const pool = getPgPool();
  await pool.query(
    `
      insert into editing_presence (
        workspace_id,
        dashboard_id,
        user_id,
        session_id,
        last_seen_at
      )
      values ($1, $2, $3, $4, now())
      on conflict (workspace_id, dashboard_id, user_id, session_id)
      do update set last_seen_at = now()
    `,
    [input.workspaceId, input.dashboardId, input.userId, input.sessionId],
  );
}

export async function listEditingPresence(input: {
  workspaceId: string;
  dashboardId: string;
}): Promise<EditingPresenceEntry[]> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<PresenceRow>(
    `
      select
        p.workspace_id,
        p.dashboard_id,
        p.user_id,
        p.session_id,
        p.last_seen_at,
        p.last_saved_at,
        u.name
      from editing_presence p
      join workspace_users u
        on u.workspace_id = p.workspace_id and u.user_id = p.user_id
      where p.workspace_id = $1 and p.dashboard_id = $2
      order by p.last_seen_at desc
    `,
    [input.workspaceId, input.dashboardId],
  );

  return result.rows.map((row) => ({
    workspace_id: row.workspace_id,
    dashboard_id: row.dashboard_id,
    user_id: row.user_id,
    user_name: row.name,
    session_id: row.session_id,
    last_seen_at: nowIso(row.last_seen_at),
    last_saved_at: row.last_saved_at ? nowIso(row.last_saved_at) : null,
    is_active:
      Date.now() - new Date(row.last_seen_at).getTime() <=
      ACTIVE_PRESENCE_WINDOW_MS,
  }));
}

async function fetchEditingSession(
  input: OpenSessionRequest,
): Promise<EditingSessionRow | null> {
  const pool = getPgPool();
  const result = await pool.query<EditingSessionRow>(
    `
      select
        workspace_id,
        user_id,
        dashboard_id,
        session_id,
        payload,
        dirty,
        base_version,
        focus_view_id,
        last_seen_at,
        updated_at
      from editing_sessions
      where
        workspace_id = $1 and
        user_id = $2 and
        dashboard_id = $3 and
        session_id = $4
      limit 1
    `,
    [input.workspaceId, input.userId, input.dashboardId, input.sessionId],
  );

  return result.rows[0] ?? null;
}

export async function openEditingSession(
  input: OpenSessionRequest,
): Promise<OpenSessionResponse> {
  await ensureCloudAuthoringSchema();
  const snapshot = await getWorkspaceDashboardSnapshot({
    workspaceId: input.workspaceId,
    dashboardId: input.dashboardId,
    mode: "authoring",
  });

  if (!snapshot) {
    throw new Error("DASHBOARD_NOT_FOUND");
  }

  await upsertEditingPresence(input);
  const existing = await fetchEditingSession(input);

  if (!existing) {
    return {
      headVersion: snapshot.version,
      restoredFromSession: false,
      stale: false,
      presence: await listEditingPresence({
        workspaceId: input.workspaceId,
        dashboardId: input.dashboardId,
      }),
      sessionPayload: buildDefaultSessionPayload({
        workspaceId: input.workspaceId,
        userId: input.userId,
        dashboardId: input.dashboardId,
        sessionId: input.sessionId,
        baseVersion: snapshot.version,
        dashboard: snapshot.document,
      }),
    };
  }

  const sessionPayload = normalizeSessionPayload(
    existing.payload,
    snapshot.document,
    snapshot.version,
  );
  const restoredFromSession = existing.payload.dirty;

  return {
    headVersion: snapshot.version,
    restoredFromSession,
    stale: sessionPayload.stale,
    presence: await listEditingPresence({
      workspaceId: input.workspaceId,
      dashboardId: input.dashboardId,
    }),
    sessionPayload,
  };
}

export async function saveEditingSession(
  input: SaveSessionRequest,
): Promise<MainAgentSessionPayload> {
  await ensureCloudAuthoringSchema();
  const payload = {
    ...input.payload,
    canonicalDraft: normalizeDocument(input.payload.canonicalDraft),
    focusViewId: sanitizeFocusViewId(
      input.payload.canonicalDraft,
      input.payload.focusViewId,
    ),
    updatedAt: nowIso(),
  };
  const pool = getPgPool();

  await pool.query(
    `
      insert into editing_sessions (
        workspace_id,
        user_id,
        dashboard_id,
        session_id,
        payload,
        dirty,
        base_version,
        focus_view_id,
        last_seen_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now(), now())
      on conflict (workspace_id, user_id, dashboard_id, session_id)
      do update set
        payload = excluded.payload,
        dirty = excluded.dirty,
        base_version = excluded.base_version,
        focus_view_id = excluded.focus_view_id,
        last_seen_at = now(),
        updated_at = now()
    `,
    [
      payload.workspaceId,
      payload.userId,
      payload.dashboardId,
      payload.sessionId,
      JSON.stringify(payload),
      payload.dirty,
      payload.baseVersion,
      payload.focusViewId,
    ],
  );

  await upsertEditingPresence({
    workspaceId: payload.workspaceId,
    dashboardId: payload.dashboardId,
    userId: payload.userId,
    sessionId: payload.sessionId,
  });

  return payload;
}
