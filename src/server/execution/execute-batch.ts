import type {
  ApiResponse,
  BindingResults,
  DashboardDocument,
  JsonValue,
  PreviewRequest,
} from "../../contracts";
import { ApiError } from "@/server/api-error";
import { assertQuota } from "@/server/guards/quotas";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  validateDashboardDocument,
  validateExecuteBatchRequest,
  validatePreviewRequest,
  type ValidationIssue,
} from "../../contracts/validation";
import { reconcileDashboardDocumentContract } from "../../domain/dashboard/document";
import { validateEChartsViewsOnServer } from "../../renderers/echarts/server/validate-option";
import { resolveExecuteBatchDocument } from "./document-source";
import { runDocumentPreview } from "./preview-engine";

export interface ExecuteBatchSuccessData {
  binding_results: BindingResults;
  renderer_checks: RendererChecksByView;
  publish_issues?: ValidationIssue[];
}

export interface ExecuteBatchErrorData {
  issues?: ValidationIssue[];
  message?: string;
  payload?: Record<string, unknown>;
}

export type ExecuteBatchBody = ApiResponse<ExecuteBatchSuccessData> & {
  details?: ExecuteBatchErrorData;
  message_i18n_key?: string;
};

export interface ExecuteBatchOutcome {
  httpStatus: number;
  body: ExecuteBatchBody;
}

export type PreviewOutcome = ExecuteBatchOutcome;

export interface ExecutionScope {
  workspaceId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
  }
  return false;
}

function validateFilterValuesShape(input: unknown): ValidationIssue[] {
  if (input === undefined) {
    return [];
  }

  if (!isRecord(input)) {
    return [{ path: "filter_values", message: "filter_values must be an object" }];
  }

  return Object.entries(input)
    .filter(([, value]) => !isJsonValue(value))
    .map(([key]) => ({
      path: `filter_values.${key}`,
      message: "filter_values entries must be JSON values",
    }));
}

function validateRequestAgainstDocument(input: {
  document: DashboardDocument;
  visibleViewIds: string[];
  filterValues: Record<string, JsonValue> | undefined;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const viewIds = new Set(input.document.dashboard_spec.views.map((view) => view.id));
  const filterIds = new Set(
    input.document.dashboard_spec.filters.map((filter) => filter.id),
  );

  input.visibleViewIds.forEach((viewId, index) => {
    if (!viewIds.has(viewId)) {
      issues.push({
        path: `visible_view_ids[${index}]`,
        message: "visible_view_ids must reference an existing dashboard view",
      });
    }
  });

  Object.keys(input.filterValues ?? {}).forEach((filterId) => {
    if (!filterIds.has(filterId)) {
      issues.push({
        path: `filter_values.${filterId}`,
        message: "filter_values keys must reference declared dashboard filters",
      });
    }
  });

  input.document.dashboard_spec.filters.forEach((filter) => {
    if (
      filter.default_value === undefined &&
      input.filterValues?.[filter.id] === undefined
    ) {
      issues.push({
        path: `filter_values.${filter.id}`,
        message: "filter_values must provide a value when the filter has no default_value",
      });
    }
  });

  return issues;
}

function createError(
  statusCode: number,
  reason: string,
  details?: ExecuteBatchErrorData,
  messageI18nKey?: string,
): ExecuteBatchOutcome {
  return {
    httpStatus: statusCode,
    body: {
      status_code: statusCode,
      reason,
      data: null,
      ...(messageI18nKey ? { message_i18n_key: messageI18nKey } : {}),
      ...(details ? { details } : {}),
    },
  };
}

function createApiError(error: ApiError): ExecuteBatchOutcome {
  return createError(
    error.status,
    error.code,
    { message: error.message, ...(error.payload ? { payload: error.payload } : {}) },
    error.i18nKey,
  );
}

function createSuccess(
  bindingResults: BindingResults,
  rendererChecks: RendererChecksByView,
  options?: {
    publishIssues?: ValidationIssue[];
  },
): ExecuteBatchOutcome {
  return {
    httpStatus: 200,
    body: {
      status_code: 200,
      reason: "OK",
      data: {
        binding_results: bindingResults,
        renderer_checks: rendererChecks,
        ...(options?.publishIssues?.length
          ? { publish_issues: options.publishIssues }
          : {}),
      },
    },
  };
}

export async function executeBatch(
  rawInput: unknown,
  scope: ExecutionScope = {},
): Promise<ExecuteBatchOutcome> {
  const validationResult = validateExecuteBatchRequest(rawInput);
  const filterIssues = validateFilterValuesShape(
    isRecord(rawInput) ? rawInput.filter_values : undefined,
  );

  if (!validationResult.ok || filterIssues.length > 0) {
    const issues = [...validationResult.issues, ...filterIssues];
    return createError(400, "INVALID_PAYLOAD", { issues });
  }

  const request = validationResult.value;
  try {
    await assertQuota("batchSize", request.visible_view_ids.length);
  } catch (error) {
    if (error instanceof ApiError) {
      return createApiError(error);
    }
    throw error;
  }
  if (!scope.workspaceId) {
    return createError(401, "AUTH_REQUIRED");
  }
  const document = await resolveExecuteBatchDocument(request, scope.workspaceId);
  if (!document) {
    return createError(404, "DASHBOARD_NOT_FOUND");
  }

  const requestIssues = validateRequestAgainstDocument({
    document,
    visibleViewIds: request.visible_view_ids,
    filterValues: request.filter_values,
  });
  if (requestIssues.length > 0) {
    return createError(400, "INVALID_PAYLOAD", { issues: requestIssues });
  }

  let bindingResults: BindingResults;
  let rendererChecks: RendererChecksByView;
  try {
    bindingResults = await runDocumentPreview(
      document,
      request.visible_view_ids,
      request.filter_values,
      request.runtime_context,
      { workspaceId: scope.workspaceId },
    );
    rendererChecks = await validateEChartsViewsOnServer({
      document,
      bindingResults,
      visibleViewIds: request.visible_view_ids,
    });
  } catch (error) {
    return createError(422, "PREVIEW_EXECUTION_FAILED", {
      message: error instanceof Error ? error.message : "Preview execution failed",
    });
  }

  return createSuccess(bindingResults, rendererChecks);
}

export async function executePreview(
  rawInput: unknown,
  scope: ExecutionScope = {},
): Promise<PreviewOutcome> {
  const validationResult = validatePreviewRequest(rawInput);
  const filterIssues = validateFilterValuesShape(
    isRecord(rawInput) ? rawInput.filter_values : undefined,
  );

  if (!validationResult.ok || filterIssues.length > 0) {
    const issues = [...validationResult.issues, ...filterIssues];
    return createError(400, "INVALID_PAYLOAD", { issues });
  }

  const request = validationResult.value;
  const visibleViewIds = resolvePreviewVisibleViewIds(request);
  try {
    await assertQuota("batchSize", visibleViewIds.length);
  } catch (error) {
    if (error instanceof ApiError) {
      return createApiError(error);
    }
    throw error;
  }
  const document = createPreviewDocument(request);
  const publishValidation = validateDashboardDocument(document, "publish");
  const requestIssues = validateRequestAgainstDocument({
    document,
    visibleViewIds,
    filterValues: request.filter_values,
  });
  if (requestIssues.length > 0) {
    return createError(400, "INVALID_PAYLOAD", { issues: requestIssues });
  }

  let bindingResults: BindingResults;
  let rendererChecks: RendererChecksByView;
  try {
    bindingResults = await runDocumentPreview(
      document,
      visibleViewIds,
      request.filter_values,
      request.runtime_context,
      { workspaceId: scope.workspaceId },
    );
    rendererChecks = await validateEChartsViewsOnServer({
      document,
      bindingResults,
      visibleViewIds,
    });
  } catch (error) {
    return createError(422, "PREVIEW_EXECUTION_FAILED", {
      message: error instanceof Error ? error.message : "Preview execution failed",
    });
  }

  return createSuccess(bindingResults, rendererChecks, {
    publishIssues: publishValidation.ok ? [] : publishValidation.issues,
  });
}

function resolvePreviewVisibleViewIds(request: PreviewRequest) {
  if (request.visible_view_ids?.length) {
    return request.visible_view_ids;
  }

  return [
    ...new Set([
      ...(request.dashboard_spec.layout.desktop?.items.map((item) => item.view_id) ?? []),
      ...(request.dashboard_spec.layout.mobile?.items.map((item) => item.view_id) ?? []),
    ]),
  ];
}

function createPreviewDocument(request: PreviewRequest): DashboardDocument {
  return reconcileDashboardDocumentContract(
    {
      schema_version: request.schema_version,
      dashboard_spec: request.dashboard_spec,
      query_defs: request.query_defs,
      bindings: request.bindings,
    },
    { mobileLayoutMode: "custom" },
  );
}
