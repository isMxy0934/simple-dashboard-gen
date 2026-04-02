import type {
  ApiResponse,
  BindingResults,
  DashboardDocument,
  JsonValue,
  PreviewRequest,
} from "../../contracts";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
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
}

export type ExecuteBatchBody = ApiResponse<ExecuteBatchSuccessData>;

export interface ExecuteBatchOutcome {
  httpStatus: number;
  body: ExecuteBatchBody;
}

export type PreviewOutcome = ExecuteBatchOutcome;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFilterValuesShape(input: unknown): ValidationIssue[] {
  if (input === undefined) {
    return [];
  }

  if (!isRecord(input)) {
    return [{ path: "filter_values", message: "filter_values must be an object" }];
  }

  return [];
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

  return issues;
}

function createError(statusCode: number, reason: string): ExecuteBatchOutcome {
  return {
    httpStatus: statusCode,
    body: {
      status_code: statusCode,
      reason,
      data: null,
    },
  };
}

function createSuccess(
  bindingResults: BindingResults,
  rendererChecks: RendererChecksByView,
): ExecuteBatchOutcome {
  return {
    httpStatus: 200,
    body: {
      status_code: 200,
      reason: "OK",
      data: {
        binding_results: bindingResults,
        renderer_checks: rendererChecks,
      },
    },
  };
}

export async function executeBatch(rawInput: unknown): Promise<ExecuteBatchOutcome> {
  const validationResult = validateExecuteBatchRequest(rawInput);
  const filterIssues = validateFilterValuesShape(
    isRecord(rawInput) ? rawInput.filter_values : undefined,
  );

  if (!validationResult.ok || filterIssues.length > 0) {
    const issues = [...validationResult.issues, ...filterIssues];
    return createError(
      400,
      issues.length > 0 ? "INVALID_PAYLOAD" : "Invalid request payload",
    );
  }

  const request = validationResult.value;
  const document = await resolveExecuteBatchDocument(request);
  if (!document) {
    return createError(404, "DASHBOARD_NOT_FOUND");
  }

  const requestIssues = validateRequestAgainstDocument({
    document,
    visibleViewIds: request.visible_view_ids,
    filterValues: request.filter_values,
  });
  if (requestIssues.length > 0) {
    return createError(400, "INVALID_PAYLOAD");
  }

  const bindingResults = await runDocumentPreview(
    document,
    request.visible_view_ids,
    request.filter_values,
    request.runtime_context,
  );
  const rendererChecks = await validateEChartsViewsOnServer({
    document,
    bindingResults,
    visibleViewIds: request.visible_view_ids,
  });

  return createSuccess(bindingResults, rendererChecks);
}

export async function executePreview(rawInput: unknown): Promise<PreviewOutcome> {
  const validationResult = validatePreviewRequest(rawInput);
  const filterIssues = validateFilterValuesShape(
    isRecord(rawInput) ? rawInput.filter_values : undefined,
  );

  if (!validationResult.ok || filterIssues.length > 0) {
    const issues = [...validationResult.issues, ...filterIssues];
    return createError(
      400,
      issues.length > 0 ? "INVALID_PAYLOAD" : "Invalid request payload",
    );
  }

  const request = validationResult.value;
  const visibleViewIds = resolvePreviewVisibleViewIds(request);
  const document = createPreviewDocument(request);
  const requestIssues = validateRequestAgainstDocument({
    document,
    visibleViewIds,
    filterValues: request.filter_values,
  });
  if (requestIssues.length > 0) {
    return createError(400, "INVALID_PAYLOAD");
  }

  const bindingResults = await runDocumentPreview(
    document,
    visibleViewIds,
    request.filter_values,
    request.runtime_context,
  );
  const rendererChecks = await validateEChartsViewsOnServer({
    document,
    bindingResults,
    visibleViewIds,
  });

  return createSuccess(bindingResults, rendererChecks);
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
    dashboard_spec: request.dashboard_spec,
    query_defs: request.query_defs,
    bindings: request.bindings,
    },
    { mobileLayoutMode: "auto" },
  );
}
