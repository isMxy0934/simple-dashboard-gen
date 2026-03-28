import type {
  Binding,
  BindingResults,
  DashboardDocument,
  DashboardFilter,
  DashboardSpec,
  JsonValue,
  QueryDef,
  RuntimeContext,
} from "../../contracts";
import { isLiveBinding, isMockBinding } from "../../domain/dashboard/bindings";
import { executeDatasourceQuery } from "../datasource/postgres-datasource";
import { resolveSingleSelectValue, resolveTimeRangePreset } from "../../domain/shared/filter-resolution";

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
  rows?: Record<string, string | number | boolean | null>[];
  code?: string;
  message?: string;
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
        typeof rawValue === "string" ? rawValue : filter.default_value ?? "last_12_weeks";
      const timezone = runtimeContext.timezone ?? "Asia/Shanghai";
      resolved[filter.id] = resolveTimeRangePreset(preset, timezone);
      return;
    }

    if (filter.kind === "single_select") {
      const raw =
        typeof rawValue === "string"
          ? rawValue
          : filter.default_value ?? filter.options[0]?.value;
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
    field_mapping: NonNullable<Binding["field_mapping"]>;
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

function validateQueryRowsAgainstSchema(
  rows: Record<string, string | number | boolean | null>[],
  query: QueryDef,
): { ok: true } | { ok: false; code: string; message: string } {
  const schema = query.result_schema;

  for (const [rowIndex, row] of rows.entries()) {
    for (const field of schema) {
      if (!(field.name in row)) {
        return {
          ok: false,
          code: "RESULT_SCHEMA_MISMATCH",
          message: `Row ${rowIndex} is missing field ${field.name}`,
        };
      }

      const value = row[field.name];
      if (value === null) {
        if (!field.nullable) {
          return {
            ok: false,
            code: "RESULT_SCHEMA_MISMATCH",
            message: `Field ${field.name} is null but not nullable`,
          };
        }
        continue;
      }

      const kind = typeof value;
      if (
        (field.type === "string" && kind !== "string") ||
        (field.type === "number" && kind !== "number") ||
        (field.type === "boolean" && kind !== "boolean") ||
        ((field.type === "date" || field.type === "datetime") && kind !== "string")
      ) {
        return {
          ok: false,
          code: "RESULT_SCHEMA_MISMATCH",
          message: `Field ${field.name} has an unexpected type`,
        };
      }
    }
  }

  return { ok: true };
}

function applyFieldMapping(
  rows: Record<string, string | number | boolean | null>[],
  binding: Binding & {
    field_mapping: NonNullable<Binding["field_mapping"]>;
  },
): Record<string, string | number | boolean | null>[] {
  const templateFields = Object.keys(binding.field_mapping ?? {});

  return rows.map((row) => {
    const mappedRow: Record<string, string | number | boolean | null> = {};

    templateFields.forEach((templateField) => {
      const sourceField = binding.field_mapping?.[templateField];
      if (!sourceField) {
        return;
      }
      mappedRow[templateField] = row[sourceField] ?? null;
    });

    return mappedRow;
  });
}

function normalizeResolvedParams(params: Record<string, JsonValue>): string {
  return stableStringify(params);
}

async function executeQueryOnce(
  query: QueryDef,
  params: Record<string, JsonValue>,
): Promise<QueryExecutionResult> {
  try {
    const rows = await executeDatasourceQuery(query, params);
    const validation = validateQueryRowsAgainstSchema(rows, query);
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
): Promise<BindingResults> {
  const runtimeContext: RuntimeContext = {
    timezone: "Asia/Shanghai",
    locale: "zh-CN",
    ...(runtimeContextInput ?? {}),
  };
  const resolvedFilters = resolveFilters(
    document.dashboard_spec,
    filterValues,
    runtimeContext,
  );

  const bindingByViewId = new Map(
    document.bindings.map((binding) => [binding.view_id, binding]),
  );
  const queryById = new Map(document.query_defs.map((query) => [query.id, query]));
  const uniqueVisibleViewIds = [...new Set(visibleViewIds)];
  const executionCache = new Map<string, Promise<QueryExecutionResult>>();
  const bindingResults: BindingResults = {};

  for (const viewId of uniqueVisibleViewIds) {
    const binding = bindingByViewId.get(viewId);
    if (!binding) {
      bindingResults[viewId] = {
        view_id: viewId,
        query_id: "",
        status: "error",
        code: "BINDING_NOT_FOUND",
        message: `No binding found for visible view ${viewId}`,
      };
      continue;
    }

    if (isMockBinding(binding)) {
      const mockRows = binding.mock_data.rows;
      bindingResults[binding.id] = {
        view_id: binding.view_id,
        query_id: "__mock__",
        status: mockRows.length === 0 ? "empty" : "ok",
        data: {
          rows: mockRows,
        },
      };
      continue;
    }

    if (!isLiveBinding(binding)) {
      bindingResults[binding.id] = {
        view_id: binding.view_id,
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
      executionPromise = executeQueryOnce(query, paramResolution.params);
      executionCache.set(cacheKey, executionPromise);
    }

    const execution = await executionPromise;
    if (execution.status === "error") {
      bindingResults[binding.id] = {
        view_id: binding.view_id,
        query_id: binding.query_id,
        status: "error",
        code: execution.code,
        message: execution.message,
      };
      continue;
    }

    const mappedRows = applyFieldMapping(execution.rows ?? [], binding);
    bindingResults[binding.id] = {
      view_id: binding.view_id,
      query_id: binding.query_id,
      status: mappedRows.length === 0 ? "empty" : "ok",
      data: {
        rows: mappedRows,
      },
    };
  }

  return bindingResults;
}
