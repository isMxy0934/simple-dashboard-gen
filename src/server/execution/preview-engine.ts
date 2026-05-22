import type {
  Binding,
  BindingData,
  BindingRow,
  BindingResults,
  DashboardDocument,
  DashboardFilter,
  DashboardSpec,
  JsonValue,
  QueryDef,
  QueryOutputKind,
  QueryParamType,
  ResultSchemaField,
  RuntimeContext,
} from "../../contracts";
import { ApiError } from "@/server/api-error";
import { assertQuota, getQuotaLimit } from "@/server/guards/quotas";
import { reconcileDashboardDocumentContract } from "../../domain/dashboard/document";
import { isLiveBinding, isMockBinding } from "../../domain/dashboard/bindings";
import {
  getQueryOutput,
  getViewSlotById,
} from "../../domain/dashboard/contract-kernel";
import { executeDatasourceQuery } from "../datasource/postgres-datasource";
import { resolveSingleSelectValue, resolveTimeRangePreset } from "../../domain/shared/filter-resolution";
import { estimateValueCount } from "../../renderers/core/slot-path";

interface ResolvedFilterContext {
  [filterId: string]: {
    value: string;
    label?: string;
    start?: string;
    end?: string;
    timezone?: string;
  };
}

interface QueryExecutionResult {
  status: "ok" | "empty" | "error";
  rows?: BindingRow[];
  code?: string;
  message?: string;
  message_i18n_key?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function getValueByPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, input);
}

function resolveFilters(
  dashboardSpec: DashboardSpec,
  rawFilterValues: Record<string, JsonValue> | undefined,
  runtimeContext: RuntimeContext,
): ResolvedFilterContext {
  const resolved: ResolvedFilterContext = {};

  dashboardSpec.filters.forEach((filter: DashboardFilter) => {
    const rawValue = rawFilterValues?.[filter.id] ?? filter.default_value;

    if (filter.kind === "time_range") {
      const preset =
        typeof rawValue === "string"
          ? rawValue
          : typeof filter.default_value === "string"
            ? filter.default_value
            : undefined;
      if (!preset) {
        throw new Error(`Missing default value for filter ${filter.id}`);
      }
      const timezone = runtimeContext.timezone ?? "Asia/Shanghai";
      resolved[filter.id] = resolveTimeRangePreset(preset, timezone);
      return;
    }

    if (filter.kind === "single_select") {
      const raw =
        typeof rawValue === "string"
          ? rawValue
          : typeof filter.default_value === "string"
            ? filter.default_value
            : undefined;
      if (typeof raw !== "string") {
        throw new Error(`Missing value for filter ${filter.id}`);
      }
      resolved[filter.id] = resolveSingleSelectValue(raw, filter.options);
      return;
    }

    throw new Error(`Unsupported filter kind: ${(filter as { kind: string }).kind}`);
  });

  return resolved;
}

function resolveParamValue(
  source: "filter" | "constant" | "runtime_context",
  value: JsonValue,
  resolvedFilters: ResolvedFilterContext,
  runtimeContext: RuntimeContext,
): JsonValue | undefined {
  if (source === "constant") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  if (source === "runtime_context") {
    return getValueByPath(runtimeContext, value) as JsonValue | undefined;
  }

  return getValueByPath(resolvedFilters, value) as JsonValue | undefined;
}

function resolveBindingParams(
  binding: Binding & {
    query_id: string;
    param_mapping: NonNullable<Binding["param_mapping"]>;
  },
  query: QueryDef,
  resolvedFilters: ResolvedFilterContext,
  runtimeContext: RuntimeContext,
): { ok: true; params: Record<string, JsonValue> } | { ok: false; code: string; message: string } {
  const params: Record<string, JsonValue> = {};

  for (const queryParam of query.params) {
    const mapping = binding.param_mapping[queryParam.name];

    if (!mapping) {
      if (queryParam.default_value !== undefined) {
        params[queryParam.name] = queryParam.default_value;
        continue;
      }

      return {
        ok: false,
        code: "PARAM_MAPPING_MISSING",
        message: `Missing param mapping for ${queryParam.name}`,
      };
    }

    const resolvedValue = resolveParamValue(
      mapping.source,
      mapping.value,
      resolvedFilters,
      runtimeContext,
    );

    if (resolvedValue === undefined) {
      if (queryParam.default_value !== undefined) {
        params[queryParam.name] = queryParam.default_value;
        continue;
      }

      return {
        ok: false,
        code: "PARAM_RESOLUTION_FAILED",
        message: `Unable to resolve param ${queryParam.name}`,
      };
    }

    params[queryParam.name] = resolvedValue;
  }

  return { ok: true, params };
}

type OutputValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

type MaterializedOutputExpectation =
  | { kind: "rows"; schema: ResultSchemaField[] }
  | { kind: "object"; schema: ResultSchemaField[] }
  | { kind: "array"; itemType: QueryParamType; nullable: boolean }
  | { kind: "scalar"; valueType: QueryParamType; nullable: boolean };

type MaterializedOutputExpectationResult =
  | { ok: true; expectation: MaterializedOutputExpectation }
  | { ok: false; code: string; message: string };

function validationError(
  code: string,
  message: string,
): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function valueMatchesQueryParamType(value: unknown, type: QueryParamType): boolean {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  if (type === "boolean") {
    return typeof value === "boolean";
  }

  return typeof value === "string";
}

function validateValueAgainstType(
  value: unknown,
  type: QueryParamType,
  nullable: boolean,
  label: string,
): OutputValidationResult {
  if (value === null) {
    return nullable
      ? { ok: true }
      : validationError("RESULT_SCHEMA_MISMATCH", `${label} is null but not nullable`);
  }

  if (valueMatchesQueryParamType(value, type)) {
    return { ok: true };
  }

  return validationError(
    "RESULT_SCHEMA_MISMATCH",
    `${label} has an unexpected type`,
  );
}

function validateObjectAgainstSchema(
  value: unknown,
  schema: ResultSchemaField[],
  label: string,
): OutputValidationResult {
  if (!isRecord(value)) {
    return validationError("RESULT_SCHEMA_MISMATCH", `${label} must be an object`);
  }

  for (const field of schema) {
    if (!(field.name in value)) {
      return validationError(
        "RESULT_SCHEMA_MISMATCH",
        `${label} is missing field ${field.name}`,
      );
    }

    const fieldValidation = validateValueAgainstType(
      value[field.name],
      field.type,
      field.nullable,
      `${label}.${field.name}`,
    );
    if (!fieldValidation.ok) {
      return fieldValidation;
    }
  }

  return { ok: true };
}

function validateRowsAgainstSchema(
  rows: unknown[],
  schema: ResultSchemaField[],
): OutputValidationResult {
  for (const [rowIndex, row] of rows.entries()) {
    const rowValidation = validateObjectAgainstSchema(row, schema, `Row ${rowIndex}`);
    if (!rowValidation.ok) {
      return rowValidation;
    }
  }

  return { ok: true };
}

function validateExecutedRowsAgainstQueryOutput(
  rows: BindingRow[],
  query: QueryDef,
): OutputValidationResult {
  const output = getQueryOutput(query);

  if (output.kind === "rows" || output.kind === "object") {
    return validateRowsAgainstSchema(rows, output.schema);
  }

  return { ok: true };
}

function getSelectorFieldName(selector: string) {
  const match = selector.match(/^rows(?:\[\]|\[0\])\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  return match?.[1] ?? null;
}

function resolveMaterializedOutputExpectation(
  query: QueryDef,
  binding: Binding,
): MaterializedOutputExpectationResult {
  const output = getQueryOutput(query);
  const selector = binding.result_selector;

  if (!selector) {
    if (output.kind === "rows") {
      return { ok: true, expectation: { kind: "rows", schema: output.schema } };
    }

    if (output.kind === "object") {
      return { ok: true, expectation: { kind: "object", schema: output.schema } };
    }

    if (output.kind === "array") {
      return {
        ok: true,
        expectation: { kind: "array", itemType: output.item_type, nullable: false },
      };
    }

    return {
      ok: true,
      expectation: { kind: "scalar", valueType: output.value_type, nullable: false },
    };
  }

  if (output.kind !== "rows") {
    return validationError(
      "RESULT_SELECTOR_INVALID",
      "result_selector can only select from rows output",
    );
  }

  if (selector === "rows") {
    return { ok: true, expectation: { kind: "rows", schema: output.schema } };
  }

  if (selector === "rows[0]") {
    return { ok: true, expectation: { kind: "object", schema: output.schema } };
  }

  const fieldName = getSelectorFieldName(selector);
  const field = fieldName
    ? output.schema.find((candidate) => candidate.name === fieldName)
    : undefined;
  if (!field) {
    return validationError(
      "RESULT_SELECTOR_INVALID",
      `result_selector references unknown result field ${fieldName ?? selector}`,
    );
  }

  if (selector.startsWith("rows[]")) {
    return {
      ok: true,
      expectation: { kind: "array", itemType: field.type, nullable: field.nullable },
    };
  }

  return {
    ok: true,
    expectation: { kind: "scalar", valueType: field.type, nullable: field.nullable },
  };
}

function validateMaterializedBindingData(input: {
  query: QueryDef;
  binding: Binding;
  slotValueKind: QueryOutputKind;
  data: BindingData;
}): OutputValidationResult {
  const expectationResult = resolveMaterializedOutputExpectation(input.query, input.binding);
  if (!expectationResult.ok) {
    return expectationResult;
  }

  const { expectation } = expectationResult;
  if (expectation.kind !== input.slotValueKind) {
    return validationError(
      "RESULT_KIND_MISMATCH",
      `Materialized output kind ${expectation.kind} is not compatible with slot value_kind ${input.slotValueKind}`,
    );
  }

  if (expectation.kind === "rows") {
    if (!Array.isArray(input.data.value)) {
      return validationError("RESULT_SCHEMA_MISMATCH", "Rows output must be an array");
    }

    return validateRowsAgainstSchema(input.data.value, expectation.schema);
  }

  if (expectation.kind === "object") {
    if (input.data.value === null && (input.data.rows?.length ?? 0) === 0) {
      return { ok: true };
    }

    return validateObjectAgainstSchema(input.data.value, expectation.schema, "Object output");
  }

  if (expectation.kind === "array") {
    if (!Array.isArray(input.data.value)) {
      return validationError("RESULT_SCHEMA_MISMATCH", "Array output must be an array");
    }

    for (const [itemIndex, item] of input.data.value.entries()) {
      const itemValidation = validateValueAgainstType(
        item,
        expectation.itemType,
        expectation.nullable,
        `Array item ${itemIndex}`,
      );
      if (!itemValidation.ok) {
        return itemValidation;
      }
    }

    return { ok: true };
  }

  if (input.data.value === null && (input.data.rows?.length ?? 0) === 0) {
    return { ok: true };
  }

  return validateValueAgainstType(
    input.data.value,
    expectation.valueType,
    expectation.nullable,
    "Scalar output",
  );
}

function resolveSelector(
  input: { rows: BindingRow[] },
  selector: string | null | undefined,
): JsonValue | undefined {
  if (!selector) {
    return undefined;
  }

  if (selector === "rows") {
    return input.rows;
  }

  const rowFieldMatch = selector.match(/^rows\[\]\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (rowFieldMatch) {
    return input.rows.map((row) => row[rowFieldMatch[1]] ?? null);
  }

  const firstRowFieldMatch = selector.match(/^rows\[0\]\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (firstRowFieldMatch) {
    return (input.rows[0]?.[firstRowFieldMatch[1]] ?? null) as JsonValue;
  }

  if (selector === "rows[0]") {
    return (input.rows[0] ?? null) as JsonValue;
  }

  return undefined;
}

function getFirstRowValue(row: BindingRow | undefined) {
  if (!row) {
    return null;
  }

  return Object.values(row)[0] ?? null;
}

function materializeBindingData(
  query: QueryDef,
  binding: Binding,
  rows: BindingRow[],
): BindingData {
  const output = getQueryOutput(query);
  const selectedValue = resolveSelector({ rows }, binding.result_selector);

  if (selectedValue !== undefined) {
    return {
      value: selectedValue,
      rows,
    };
  }

  if (output.kind === "scalar") {
    return {
      value: getFirstRowValue(rows[0]),
      rows,
    };
  }

  if (output.kind === "object") {
    return {
      value: (rows[0] ?? null) as JsonValue,
      rows,
    };
  }

  if (output.kind === "array") {
    return {
      value: rows.map((row) => getFirstRowValue(row)),
      rows,
    };
  }

  return {
    value: rows as JsonValue,
    rows,
  };
}

function normalizeResolvedParams(params: Record<string, JsonValue>): string {
  return stableStringify(params);
}

async function executeQueryOnce(
  query: QueryDef,
  params: Record<string, JsonValue>,
  workspaceId: string | undefined,
): Promise<QueryExecutionResult> {
  try {
    const queryRowLimit = getQuotaLimit("queryRows");
    const rows = await executeDatasourceQuery(query, params, workspaceId, {
      rowLimit: queryRowLimit,
    });
    await assertQuota("queryRows", rows.length);
    await assertQuota(
      "queryBytes",
      Buffer.byteLength(JSON.stringify(rows), "utf8"),
    );
    const validation = validateExecutedRowsAgainstQueryOutput(rows, query);
    if (!validation.ok) {
      return {
        status: "error",
        code: validation.code,
        message: validation.message,
      };
    }

    return {
      status: rows.length === 0 ? "empty" : "ok",
      rows,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        status: "error",
        code: error.code,
        message: error.i18nKey,
        message_i18n_key: error.i18nKey,
      };
    }
    return {
      status: "error",
      code: "QUERY_EXECUTION_ERROR",
      message: error instanceof Error ? error.message : "Unknown execution error",
    };
  }
}

export async function runDocumentPreview(
  document: DashboardDocument,
  visibleViewIds: string[],
  filterValues: Record<string, JsonValue> | undefined,
  runtimeContextInput: RuntimeContext | undefined,
  options: { workspaceId?: string } = {},
): Promise<BindingResults> {
  const normalizedDocument = reconcileDashboardDocumentContract(document, {
    mobileLayoutMode: "custom",
  });
  const runtimeContext: RuntimeContext = {
    timezone: "Asia/Shanghai",
    locale: "zh-CN",
    ...(runtimeContextInput ?? {}),
  };
  const resolvedFilters = resolveFilters(
    normalizedDocument.dashboard_spec,
    filterValues,
    runtimeContext,
  );

  const bindingByViewId = new Map(
    normalizedDocument.dashboard_spec.views.map((view) => [
      view.id,
      normalizedDocument.bindings.filter((binding) => binding.view_id === view.id),
    ]),
  );
  const queryById = new Map(normalizedDocument.query_defs.map((query) => [query.id, query]));
  const viewIds = new Set(normalizedDocument.dashboard_spec.views.map((view) => view.id));
  const uniqueVisibleViewIds = [...new Set(visibleViewIds)];
  const executionCache = new Map<string, Promise<QueryExecutionResult>>();
  const bindingResults: BindingResults = {};

  for (const viewId of uniqueVisibleViewIds) {
    if (!viewIds.has(viewId)) {
      bindingResults[viewId] = {
        view_id: viewId,
        slot_id: "",
        query_id: "",
        status: "error",
        code: "VIEW_NOT_FOUND",
        message: `Visible view ${viewId} does not exist in the dashboard contract`,
      };
      continue;
    }

    const view = normalizedDocument.dashboard_spec.views.find((candidate) => candidate.id === viewId);
    const bindings = bindingByViewId.get(viewId) ?? [];
    if (!view) {
      bindingResults[viewId] = {
        view_id: viewId,
        slot_id: "",
        query_id: "",
        status: "error",
        code: "VIEW_NOT_FOUND",
        message: `Visible view ${viewId} does not exist in the dashboard contract`,
      };
      continue;
    }

    if (bindings.length === 0) {
      bindingResults[viewId] = {
        view_id: viewId,
        slot_id: "",
        query_id: "",
        status: "error",
        code: "BINDING_NOT_FOUND",
        message: `No binding found for visible view ${viewId}`,
      };
      continue;
    }

    for (const binding of bindings) {
      const slotId = binding.slot_id;
      const slot = getViewSlotById(view, slotId);

      if (!slot) {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slotId,
          query_id: binding.query_id ?? "",
          status: "error",
          code: "SLOT_NOT_FOUND",
          message: `Binding ${binding.id} references missing slot ${slotId}`,
        };
        continue;
      }

      if (isMockBinding(binding)) {
        const mockRows = binding.mock_data.rows;
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: "__mock__",
          status: mockRows.length === 0 ? "empty" : "ok",
          data: {
            value: (binding.mock_value ?? { rows: mockRows }) as JsonValue,
            rows: mockRows,
          },
        };
        continue;
      }

      if (!isLiveBinding(binding)) {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: "",
          status: "error",
          code: "BINDING_INVALID",
          message: `Binding ${binding.id} is incomplete`,
        };
        continue;
      }

      const query = queryById.get(binding.query_id);
      if (!query) {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: binding.query_id,
          status: "error",
          code: "QUERY_NOT_FOUND",
          message: `Query ${binding.query_id} was not found`,
        };
        continue;
      }

      const paramResolution = resolveBindingParams(
        binding,
        query,
        resolvedFilters,
        runtimeContext,
      );
      if (!paramResolution.ok) {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: binding.query_id,
          status: "error",
          code: paramResolution.code,
          message: paramResolution.message,
        };
        continue;
      }

      const cacheKey = `${query.id}::${normalizeResolvedParams(paramResolution.params)}`;
      let executionPromise = executionCache.get(cacheKey);
      if (!executionPromise) {
        executionPromise = executeQueryOnce(
          query,
          paramResolution.params,
          options.workspaceId,
        );
        executionCache.set(cacheKey, executionPromise);
      }

      const execution = await executionPromise;
      if (execution.status === "error") {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: binding.query_id,
          status: "error",
          code: execution.code,
          message: execution.message,
          message_i18n_key: execution.message_i18n_key,
        };
        continue;
      }

      const data = materializeBindingData(query, binding, execution.rows ?? []);
      const outputValidation = validateMaterializedBindingData({
        query,
        binding,
        slotValueKind: slot.value_kind,
        data,
      });
      if (!outputValidation.ok) {
        bindingResults[binding.id] = {
          view_id: binding.view_id,
          slot_id: slot.id,
          query_id: binding.query_id,
          status: "error",
          code: outputValidation.code,
          message: outputValidation.message,
        };
        continue;
      }

      bindingResults[binding.id] = {
        view_id: binding.view_id,
        slot_id: slot.id,
        query_id: binding.query_id,
        status: estimateValueCount(data.value) === 0 ? "empty" : "ok",
        data,
      };
    }
  }

  return bindingResults;
}
