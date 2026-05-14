import "server-only";

import type {
  BindingResults,
  CloudPublishRequest,
  CloudSaveDraftRequest,
  DashboardListMode,
  DashboardDocument,
  DashboardSnapshot,
  DashboardSummary,
  JsonValue,
} from "@/contracts";
import { validateDashboardDocument } from "@/contracts/validation";
import { canonicalDashboardDocumentFingerprint } from "@/domain/dashboard/document-fingerprint";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  DraftVersionConflictError,
  PublishVersionConflictError,
  createWorkspaceDashboard,
  deleteWorkspaceDashboard,
  getWorkspaceDashboardSnapshot,
  listWorkspaceDashboards,
  publishWorkspaceDashboard,
  saveWorkspaceDashboardDraft,
  unpublishWorkspaceDashboard,
} from "@/server/cloud/dashboard-repository";
import { executePreview } from "@/server/execution/execute-batch";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";
import { markEditingSessionClean } from "@/server/cloud/editing-session-repository";
import {
  runEditingSessionCleanupBestEffort,
  type EditingSessionCleanupStatus,
} from "@/server/dashboards/session-cleanup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDashboardDocumentLike(value: unknown): value is CloudSaveDraftRequest["draft"] {
  return (
    isRecord(value) &&
    isRecord(value.dashboard_spec) &&
    Array.isArray(value.query_defs) &&
    Array.isArray(value.bindings)
  );
}

function isCloudSaveDraftRequest(value: unknown): value is CloudSaveDraftRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.dashboardId) &&
    isNonEmptyString(value.editingSessionId) &&
    !("sessionId" in value) &&
    typeof value.expectedDraftVersion === "number" &&
    Number.isInteger(value.expectedDraftVersion) &&
    value.expectedDraftVersion >= 0 &&
    isNonEmptyString(value.expectedDocumentHash) &&
    (value.baseVersion === undefined ||
      (typeof value.baseVersion === "number" &&
        Number.isInteger(value.baseVersion) &&
        value.baseVersion >= 0)) &&
    (value.force === undefined || typeof value.force === "boolean") &&
    isDashboardDocumentLike(value.draft)
  );
}

function isDashboardListMode(value: unknown): value is DashboardListMode {
  return value === "authoring" || value === "viewer";
}

function isListDashboardsRequest(value: unknown): value is {
  workspaceId: string;
  mode: DashboardListMode;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isDashboardListMode(value.mode)
  );
}

function isCreateDashboardRequest(value: unknown): value is {
  workspaceId: string;
  userId: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId)
  );
}

function isDashboardIdRequest(value: unknown): value is {
  workspaceId: string;
  dashboardId: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.dashboardId)
  );
}

function isGetDashboardRequest(value: unknown): value is {
  workspaceId: string;
  dashboardId: string;
  mode: DashboardListMode;
} {
  if (!isRecord(value)) {
    return false;
  }
  const mode = value.mode;
  return (
    isDashboardIdRequest(value) &&
    isDashboardListMode(mode)
  );
}

function isCloudPublishRequest(value: unknown): value is CloudPublishRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.dashboardId) &&
    isNonEmptyString(value.editingSessionId) &&
    !("sessionId" in value) &&
    typeof value.draftVersion === "number" &&
    Number.isInteger(value.draftVersion) &&
    value.draftVersion >= 0 &&
    isNonEmptyString(value.documentHash)
  );
}

function resolvePublishVisibleViewIds(document: DashboardDocument): string[] {
  return [
    ...new Set([
      ...(document.dashboard_spec.layout.desktop?.items.map((item) => item.view_id) ?? []),
      ...(document.dashboard_spec.layout.mobile?.items.map((item) => item.view_id) ?? []),
    ]),
  ];
}

function resolvePublishFilterValues(document: DashboardDocument): Record<string, JsonValue> {
  return Object.fromEntries(
    document.dashboard_spec.filters
      .filter((filter) => filter.default_value !== undefined)
      .map((filter) => [filter.id, filter.default_value as JsonValue]),
  );
}

function hasBindingErrors(bindingResults: BindingResults): boolean {
  return Object.values(bindingResults).some((result) => result.status === "error");
}

function hasRendererErrors(rendererChecks: RendererChecksByView): boolean {
  return Object.values(rendererChecks).some(
    (checks) => checks.server?.status === "error" || checks.browser?.status === "error",
  );
}

export async function listDashboardsService(
  payload: unknown,
): Promise<ServiceResult<{ dashboards: DashboardSummary[] }>> {
  if (!isListDashboardsRequest(payload)) {
    return serviceError({
      code: "INVALID_DASHBOARD_LIST_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  try {
    return serviceOk({
      dashboards: await listWorkspaceDashboards(workspaceId, payload.mode),
    });
  } catch (error) {
    return serviceError({
      code: "DASHBOARD_LIST_UNAVAILABLE",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_LIST_UNAVAILABLE",
    });
  }
}

export async function createDashboardService(
  payload: unknown,
): Promise<ServiceResult<DashboardSnapshot>> {
  if (!isCreateDashboardRequest(payload)) {
    return serviceError({
      code: "INVALID_DASHBOARD_CREATE_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const userId = payload.userId.trim();
  try {
    return serviceOk(await createWorkspaceDashboard({ workspaceId, userId }));
  } catch (error) {
    return serviceError({
      code: "DASHBOARD_CREATE_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_CREATE_FAILED",
    });
  }
}

export async function getDashboardService(
  payload: unknown,
): Promise<ServiceResult<DashboardSnapshot>> {
  if (!isGetDashboardRequest(payload)) {
    return serviceError({
      code: "INVALID_DASHBOARD_GET_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const dashboardId = payload.dashboardId.trim();
  try {
    const snapshot = await getWorkspaceDashboardSnapshot({
      workspaceId,
      dashboardId,
      mode: payload.mode,
    });
    if (!snapshot) {
      return serviceError({
        code: "DASHBOARD_NOT_FOUND",
        status: 404,
      });
    }
    return serviceOk(snapshot);
  } catch (error) {
    return serviceError({
      code: "DASHBOARD_LOAD_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_LOAD_FAILED",
    });
  }
}

export async function deleteDashboardService(
  payload: unknown,
): Promise<ServiceResult<{ dashboard_id: string }>> {
  if (!isDashboardIdRequest(payload)) {
    return serviceError({
      code: "INVALID_DASHBOARD_DELETE_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const dashboardId = payload.dashboardId.trim();
  try {
    await deleteWorkspaceDashboard({ workspaceId, dashboardId });
    return serviceOk({ dashboard_id: dashboardId });
  } catch (error) {
    return serviceError({
      code: "DASHBOARD_DELETE_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_DELETE_FAILED",
    });
  }
}

export async function unpublishDashboardService(
  payload: unknown,
): Promise<ServiceResult<{ dashboard_id: string }>> {
  if (!isDashboardIdRequest(payload)) {
    return serviceError({
      code: "INVALID_DASHBOARD_UNPUBLISH_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const dashboardId = payload.dashboardId.trim();
  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId,
      dashboardId,
      mode: "viewer",
    });
    if (!existing) {
      return serviceError({
        code: "PUBLISHED_DASHBOARD_NOT_FOUND",
        status: 404,
      });
    }

    await unpublishWorkspaceDashboard({ workspaceId, dashboardId });
    return serviceOk({ dashboard_id: dashboardId });
  } catch (error) {
    return serviceError({
      code: "DASHBOARD_UNPUBLISH_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_UNPUBLISH_FAILED",
    });
  }
}

export async function saveDashboardDraftService(
  payload: unknown,
): Promise<ServiceResult<{
  dashboard_id: string;
  version: number;
  saved_at: string;
  changed: boolean;
} & EditingSessionCleanupStatus>> {
  if (!isCloudSaveDraftRequest(payload)) {
    return serviceError({
      code: "INVALID_SAVE_REQUEST",
      status: 400,
    });
  }

  const validation = validateDashboardDocument(payload.draft, "save");
  if (!validation.ok) {
    return serviceError({
      code: "INVALID_DASHBOARD_DOCUMENT",
      status: 400,
      details: {
        issues: validation.issues,
      },
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const userId = payload.userId.trim();
  const dashboardId = payload.dashboardId.trim();
  const sessionId = payload.editingSessionId.trim();
  const expectedDocumentHash = payload.expectedDocumentHash.trim();

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId,
      dashboardId,
      mode: "authoring",
    });
    if (!existing) {
      return serviceError({
        code: "DASHBOARD_NOT_FOUND",
        status: 404,
      });
    }
    const latestDocumentHash = canonicalDashboardDocumentFingerprint(existing.document);
    if (
      !payload.force &&
      (existing.version !== payload.expectedDraftVersion ||
        latestDocumentHash !== expectedDocumentHash)
    ) {
      return serviceError({
        code: "DRAFT_VERSION_CONFLICT",
        status: 409,
        reason: `Dashboard draft is not current. Latest version is ${existing.version}.`,
        details: {
          latestVersion: existing.version,
          latestDocumentHash,
        },
      });
    }

    const saved = await saveWorkspaceDashboardDraft({
      ...payload,
      workspaceId,
      userId,
      dashboardId,
      editingSessionId: sessionId,
      expectedDocumentHash,
      draft: validation.value,
    });
    const cleanupStatus = await runEditingSessionCleanupBestEffort({
      operation: "save",
      cleanup: () =>
        markEditingSessionClean({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
          baseVersion: saved.version,
          canonicalDraft: validation.value,
        }),
    });

    return serviceOk({
      dashboard_id: dashboardId,
      version: saved.version,
      saved_at: saved.saved_at,
      changed: saved.changed,
      ...cleanupStatus,
    });
  } catch (error) {
    if (error instanceof DraftVersionConflictError) {
      return serviceError({
        code: "DRAFT_VERSION_CONFLICT",
        status: 409,
        reason: error.message,
        details: {
          latestVersion: error.latestVersion,
        },
      });
    }

    return serviceError({
      code: "DASHBOARD_SAVE_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_SAVE_FAILED",
    });
  }
}

export async function publishDashboardService(
  payload: unknown,
): Promise<ServiceResult<{
  dashboard_id: string;
  version: number;
  published_at: string;
  changed: boolean;
} & EditingSessionCleanupStatus>> {
  if (!isCloudPublishRequest(payload)) {
    return serviceError({
      code: "INVALID_PUBLISH_REQUEST",
      status: 400,
    });
  }

  const workspaceId = payload.workspaceId.trim();
  const userId = payload.userId.trim();
  const dashboardId = payload.dashboardId.trim();
  const sessionId = payload.editingSessionId.trim();
  const documentHash = payload.documentHash.trim();

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId,
      dashboardId,
      mode: "authoring",
    });
    if (!existing) {
      return serviceError({
        code: "DASHBOARD_NOT_FOUND",
        status: 404,
      });
    }

    if (existing.version !== payload.draftVersion) {
      return serviceError({
        code: "PUBLISH_VERSION_CONFLICT",
        status: 409,
        reason: `Dashboard publish expects head version ${existing.version}.`,
        details: {
          latestVersion: existing.version,
        },
      });
    }

    const existingDocumentHash = canonicalDashboardDocumentFingerprint(existing.document);
    if (existingDocumentHash !== documentHash) {
      return serviceError({
        code: "PUBLISH_HASH_CONFLICT",
        status: 409,
        reason: `Dashboard publish expects document hash ${existingDocumentHash}.`,
        details: {
          latestVersion: existing.version,
          latestDocumentHash: existingDocumentHash,
        },
      });
    }

    const documentValidation = validateDashboardDocument(existing.document, "publish");
    if (!documentValidation.ok) {
      return serviceError({
        code: "INVALID_DASHBOARD_DOCUMENT",
        status: 400,
        details: {
          issues: documentValidation.issues,
        },
      });
    }

    const publishCheck = await executePreview({
      ...documentValidation.value,
      visible_view_ids: resolvePublishVisibleViewIds(documentValidation.value),
      filter_values: resolvePublishFilterValues(documentValidation.value),
      runtime_context: {
        timezone: "Asia/Shanghai",
        locale: "zh-CN",
      },
    });
    const publishCheckData = publishCheck.body.data ?? {
      binding_results: {},
      renderer_checks: {},
    };
    if (
      publishCheck.httpStatus !== 200 ||
      hasBindingErrors(publishCheckData.binding_results) ||
      hasRendererErrors(publishCheckData.renderer_checks)
    ) {
      return serviceError({
        code: "PUBLISH_CHECK_FAILED",
        status: 422,
        details: publishCheckData,
      });
    }

    const published = await publishWorkspaceDashboard({
      ...payload,
      workspaceId,
      userId,
      dashboardId,
      editingSessionId: sessionId,
      documentHash,
    });
    const cleanupStatus = await runEditingSessionCleanupBestEffort({
      operation: "publish",
      cleanup: () =>
        markEditingSessionClean({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
          baseVersion: published.version,
          canonicalDraft: documentValidation.value,
        }),
    });

    return serviceOk({
      dashboard_id: dashboardId,
      version: published.version,
      published_at: published.published_at,
      changed: published.changed,
      ...cleanupStatus,
    });
  } catch (error) {
    if (error instanceof PublishVersionConflictError) {
      return serviceError({
        code: "PUBLISH_VERSION_CONFLICT",
        status: 409,
        reason: error.message,
        details: {
          latestVersion: error.latestVersion,
        },
      });
    }

    return serviceError({
      code: "DASHBOARD_PUBLISH_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "DASHBOARD_PUBLISH_FAILED",
    });
  }
}
