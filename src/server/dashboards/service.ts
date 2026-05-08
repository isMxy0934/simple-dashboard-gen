import "server-only";

import type {
  BindingResults,
  CloudPublishRequest,
  CloudSaveDraftRequest,
  DashboardDocument,
  JsonValue,
} from "@/contracts";
import { validateDashboardDocument } from "@/contracts/validation";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  DraftVersionConflictError,
  PublishVersionConflictError,
  getWorkspaceDashboardSnapshot,
  publishWorkspaceDashboard,
  saveWorkspaceDashboardDraft,
} from "@/server/cloud/dashboard-repository";
import { executePreview } from "@/server/execution/execute-batch";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    typeof value.workspaceId === "string" &&
    typeof value.userId === "string" &&
    typeof value.dashboardId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.expectedDraftVersion === "number" &&
    Number.isInteger(value.expectedDraftVersion) &&
    value.expectedDraftVersion >= 0 &&
    typeof value.expectedDocumentHash === "string" &&
    (value.baseVersion === undefined ||
      (typeof value.baseVersion === "number" &&
        Number.isInteger(value.baseVersion) &&
        value.baseVersion >= 0)) &&
    (value.force === undefined || typeof value.force === "boolean") &&
    isDashboardDocumentLike(value.draft)
  );
}

function isCloudPublishRequest(value: unknown): value is CloudPublishRequest {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.userId === "string" &&
    typeof value.dashboardId === "string" &&
    typeof value.draftVersion === "number" &&
    Number.isInteger(value.draftVersion) &&
    value.draftVersion >= 0 &&
    typeof value.documentHash === "string"
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

export async function saveDashboardDraftService(
  payload: unknown,
): Promise<ServiceResult<{
  dashboard_id: string;
  version: number;
  saved_at: string;
  changed: boolean;
}>> {
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

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId: payload.workspaceId,
      dashboardId: payload.dashboardId,
      mode: "authoring",
    });
    if (!existing) {
      return serviceError({
        code: "DASHBOARD_NOT_FOUND",
        status: 404,
      });
    }
    const latestDocumentHash = dashboardDocumentPersistenceFingerprint(existing.document);
    if (
      !payload.force &&
      (existing.version !== payload.expectedDraftVersion ||
        latestDocumentHash !== payload.expectedDocumentHash)
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
      draft: validation.value,
    });

    return serviceOk({
      dashboard_id: payload.dashboardId,
      version: saved.version,
      saved_at: saved.saved_at,
      changed: saved.changed,
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
}>> {
  if (!isCloudPublishRequest(payload)) {
    return serviceError({
      code: "INVALID_PUBLISH_REQUEST",
      status: 400,
    });
  }

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId: payload.workspaceId,
      dashboardId: payload.dashboardId,
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

    const existingDocumentHash = dashboardDocumentPersistenceFingerprint(
      existing.document,
    );
    if (existingDocumentHash !== payload.documentHash) {
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

    const published = await publishWorkspaceDashboard(payload);

    return serviceOk({
      dashboard_id: payload.dashboardId,
      version: published.version,
      published_at: published.published_at,
      changed: published.changed,
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
