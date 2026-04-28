import type {
  BindingResults,
  CloudPublishRequest,
  DashboardDocument,
  JsonValue,
} from "../../../../contracts";
import { validateDashboardDocument } from "../../../../contracts/validation";
import type { RendererChecksByView } from "../../../../renderers/core/validation-result";
import { dashboardDocumentPersistenceFingerprint } from "../../../../domain/dashboard/document-fingerprint";
import {
  PublishVersionConflictError,
  getWorkspaceDashboardSnapshot,
  publishWorkspaceDashboard,
} from "../../../../server/cloud/repository";
import { executePreview } from "../../../../server/execution/execute-batch";

function isCloudPublishRequest(value: unknown): value is CloudPublishRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    "userId" in value &&
    "dashboardId" in value &&
    "draftVersion" in value &&
    "documentHash" in value
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

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  if (!isCloudPublishRequest(payload)) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PUBLISH_REQUEST",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId: payload.workspaceId,
      dashboardId: payload.dashboardId,
      mode: "authoring",
    });
    if (!existing) {
      return Response.json(
        {
          status_code: 404,
          reason: "DASHBOARD_NOT_FOUND",
          data: null,
        },
        { status: 404 },
      );
    }

    if (existing.version !== payload.draftVersion) {
      return Response.json(
        {
          status_code: 409,
          reason: `Dashboard publish expects head version ${existing.version}.`,
          data: {
            latestVersion: existing.version,
          },
        },
        { status: 409 },
      );
    }

    const existingDocumentHash = dashboardDocumentPersistenceFingerprint(
      existing.document,
    );
    if (existingDocumentHash !== payload.documentHash) {
      return Response.json(
        {
          status_code: 409,
          reason: `Dashboard publish expects document hash ${existingDocumentHash}.`,
          data: {
            latestVersion: existing.version,
            latestDocumentHash: existingDocumentHash,
          },
        },
        { status: 409 },
      );
    }

    const documentValidation = validateDashboardDocument(existing.document, "publish");
    if (!documentValidation.ok) {
      return Response.json(
        {
          status_code: 400,
          reason: "INVALID_DASHBOARD_DOCUMENT",
          data: {
            issues: documentValidation.issues,
          },
        },
        { status: 400 },
      );
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
      return Response.json(
        {
          status_code: 422,
          reason: "PUBLISH_CHECK_FAILED",
          data: publishCheckData,
        },
        { status: 422 },
      );
    }

    const published = await publishWorkspaceDashboard(payload);

    return Response.json({
      status_code: 200,
      reason: published.changed ? "OK" : "NO_CHANGES",
      data: {
        dashboard_id: payload.dashboardId,
        version: published.version,
        published_at: published.published_at,
        changed: published.changed,
      },
    });
  } catch (error) {
    if (error instanceof PublishVersionConflictError) {
      return Response.json(
        {
          status_code: 409,
          reason: error.message,
          data: {
            latestVersion: error.latestVersion,
          },
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_PUBLISH_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
