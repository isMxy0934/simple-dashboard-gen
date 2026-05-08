import "server-only";

import type { QueryResultRow } from "pg";
import type {
  AuthoringSessionPayload,
  DashboardDocument,
  EditingPresenceEntry,
  OpenSessionRequest,
  OpenSessionResponse,
  SaveSessionRequest,
} from "@/contracts";
import {
  type DashboardMobileLayoutMode,
  reconcileDashboardDocumentContract,
} from "@/domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getWorkspaceDashboardSnapshot } from "@/server/cloud/dashboard-repository";

const ACTIVE_PRESENCE_WINDOW_MS = 60_000;

interface EditingSessionRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  dashboard_id: string;
  session_id: string;
  payload: AuthoringSessionPayload;
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

export class EditingSessionRevisionConflictError extends Error {
  readonly latestRevision: number;

  constructor(message: string, latestRevision: number) {
    super(message);
    this.name = "EditingSessionRevisionConflictError";
    this.latestRevision = latestRevision;
  }
}

function nowIso(value?: string | Date | null) {
  return new Date(value ?? new Date()).toISOString();
}

function normalizeDocument(
  document: DashboardDocument,
  mobileLayoutMode: DashboardMobileLayoutMode = "custom",
) {
  return reconcileDashboardDocumentContract(document, {
    mobileLayoutMode,
  });
}

function normalizeMobileLayoutMode(
  value: unknown,
): DashboardMobileLayoutMode {
  return value === "auto" ? "auto" : "custom";
}

function emptyAuthoringRuntimeState() {
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

  return null;
}

function buildDefaultSessionPayload(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  baseVersion: number;
  dashboard: DashboardDocument;
}): AuthoringSessionPayload {
  const mobileLayoutMode: DashboardMobileLayoutMode = "auto";
  const canonicalDraft = normalizeDocument(input.dashboard, mobileLayoutMode);
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    dashboardId: input.dashboardId,
    sessionId: input.sessionId,
    focusViewId: sanitizeFocusViewId(canonicalDraft, null),
    baseVersion: input.baseVersion,
    dirty: false,
    stale: false,
    mobileLayoutMode,
    canonicalDraft,
    authoringState: emptyAuthoringRuntimeState(),
    viewStatesByViewId: {},
    approvalState: {
      pending: false,
      lastSuggestionId: null,
    },
    updatedAt: nowIso(),
  };
}

function normalizeSessionPayload(
  payload: AuthoringSessionPayload,
  latestDashboard: DashboardDocument,
  headVersion: number,
): AuthoringSessionPayload {
  const mobileLayoutMode = normalizeMobileLayoutMode(
    (payload as { mobileLayoutMode?: unknown }).mobileLayoutMode,
  );
  const canonicalDraft = normalizeDocument(payload.canonicalDraft, mobileLayoutMode);
  const focusViewId = sanitizeFocusViewId(canonicalDraft, payload.focusViewId);
  const stale = payload.baseVersion < headVersion;
  const latest = normalizeDocument(latestDashboard);

  return {
    ...payload,
    focusViewId,
    stale,
    mobileLayoutMode,
    canonicalDraft: payload.dirty ? canonicalDraft : latest,
    baseVersion: payload.dirty ? payload.baseVersion : headVersion,
    updatedAt: nowIso(payload.updatedAt),
  };
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
    const sessionPayload = buildDefaultSessionPayload({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      baseVersion: snapshot.version,
      dashboard: snapshot.document,
    });
    return {
      headVersion: snapshot.version,
      draftVersion: snapshot.version,
      documentHash: dashboardDocumentPersistenceFingerprint(snapshot.document),
      sessionRevision: 0,
      dirty: sessionPayload.dirty,
      restoredFromSession: false,
      stale: false,
      presence: await listEditingPresence({
        workspaceId: input.workspaceId,
        dashboardId: input.dashboardId,
      }),
      sessionPayload,
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
    draftVersion: snapshot.version,
    documentHash: dashboardDocumentPersistenceFingerprint(snapshot.document),
    sessionRevision: Date.parse(nowIso(existing.updated_at)) || 0,
    dirty: sessionPayload.dirty,
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
): Promise<AuthoringSessionPayload> {
  await ensureCloudAuthoringSchema();
  const mobileLayoutMode = normalizeMobileLayoutMode(
    (input.payload as { mobileLayoutMode?: unknown }).mobileLayoutMode,
  );
  const payload = {
    ...input.payload,
    mobileLayoutMode,
    canonicalDraft: normalizeDocument(
      input.payload.canonicalDraft,
      mobileLayoutMode,
    ),
    focusViewId: sanitizeFocusViewId(
      input.payload.canonicalDraft,
      input.payload.focusViewId,
    ),
    updatedAt: nowIso(),
  };
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const current = await client.query<{
      updated_at: string | Date;
      payload: AuthoringSessionPayload;
    }>(
      `
        select updated_at, payload
        from editing_sessions
        where workspace_id = $1 and user_id = $2 and dashboard_id = $3 and session_id = $4
        for update
      `,
      [
        payload.workspaceId,
        payload.userId,
        payload.dashboardId,
        payload.sessionId,
      ],
    );
    const existing = current.rows[0] ?? null;
    const latestRevision = existing
      ? Date.parse(nowIso(existing.updated_at)) || 0
      : 0;

    if (
      typeof input.expectedSessionRevision === "number" &&
      input.expectedSessionRevision !== latestRevision
    ) {
      throw new EditingSessionRevisionConflictError(
        "Authoring session revision is stale.",
        latestRevision,
      );
    }

    if (
      input.expectedDocumentHash &&
      existing &&
      dashboardDocumentPersistenceFingerprint(existing.payload.canonicalDraft) !==
        input.expectedDocumentHash
    ) {
      throw new EditingSessionRevisionConflictError(
        "Authoring session document hash is stale.",
        latestRevision,
      );
    }

    await client.query(
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

    await client.query(
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
      [
        payload.workspaceId,
        payload.dashboardId,
        payload.userId,
        payload.sessionId,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return payload;
}

export async function saveAppliedEditingSession(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  baseVersion: number;
  canonicalDraft: DashboardDocument;
  focusViewId?: string | null;
  previousPayload?: AuthoringSessionPayload | null;
  lastSuggestionId?: string | null;
}): Promise<AuthoringSessionPayload> {
  const mobileLayoutMode = normalizeMobileLayoutMode(
    input.previousPayload?.mobileLayoutMode,
  );
  const canonicalDraft = normalizeDocument(input.canonicalDraft, mobileLayoutMode);
  return saveEditingSession({
    payload: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      focusViewId: sanitizeFocusViewId(canonicalDraft, input.focusViewId),
      baseVersion: input.baseVersion,
      dirty: true,
      stale: false,
      mobileLayoutMode,
      canonicalDraft,
      authoringState:
        input.previousPayload?.authoringState ?? emptyAuthoringRuntimeState(),
      viewStatesByViewId: input.previousPayload?.viewStatesByViewId ?? {},
      approvalState: {
        pending: false,
        lastSuggestionId: input.lastSuggestionId ?? null,
      },
      updatedAt: nowIso(),
    },
  });
}
