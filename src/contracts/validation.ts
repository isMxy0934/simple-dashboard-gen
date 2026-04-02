import type {
  Binding,
  BindingParamMapping,
  DashboardDocument,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardSpec,
  DatasourceContext,
  ExecuteBatchRequest,
  JsonObject,
  JsonValue,
  PreviewRequest,
  QueryDef,
  QueryOutput,
  ResultSchemaField,
  RuntimeContext,
} from "./dashboard";
import { hasRendererSlotPath } from "./slot-path";

export const SUPPORTED_DIALECT = "postgres" as const;
export const ALLOWED_RUNTIME_CONTEXT_KEYS = ["timezone", "locale"] as const;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; issues: ValidationIssue[]; value: T }
  | { ok: false; issues: ValidationIssue[]; value?: undefined };

export type ValidationMode = "save" | "publish";

const QUERY_PARAM_TYPES = new Set(["string", "number", "boolean", "date", "datetime"]);
const QUERY_PARAM_CARDINALITIES = new Set(["scalar", "array"]);
const FILTER_KINDS = new Set(["time_range", "single_select"]);
const PARAM_SOURCES = new Set(["filter", "constant", "runtime_context"]);
const BINDING_MODES = new Set(["mock", "live"]);
const SCHEMA_VERSIONS = new Set(["0.2"]);
const SLOT_VALUE_KINDS = new Set(["rows", "array", "object", "scalar"]);
const SEMANTIC_TYPES = new Set(["time", "dimension", "metric"]);
const FORBIDDEN_SQL_PATTERN =
  /\b(insert|update|delete|merge|create|alter|drop|truncate|begin|commit|rollback)\b/i;

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, issues: [], value };
}

function fail<T>(issues: ValidationIssue[]): ValidationResult<T> {
  return { ok: false, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
  }

  return false;
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getSqlTemplateParams(sqlTemplate: string): string[] {
  const matches = sqlTemplate.matchAll(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g);
  return [...new Set(Array.from(matches, (match) => match[1]))];
}

function getViewOptionTemplate(view: Record<string, unknown>): JsonObject | undefined {
  if (isRecord(view.renderer) && isRecord(view.renderer.option_template)) {
    return view.renderer.option_template as JsonObject;
  }

  return undefined;
}

function getViewSlots(view: Record<string, unknown>): DashboardRendererSlot[] {
  if (
    isRecord(view.renderer) &&
    Array.isArray(view.renderer.slots)
  ) {
    return view.renderer.slots as DashboardRendererSlot[];
  }

  return [];
}

function getQueryOutput(query: Record<string, unknown>): QueryOutput | undefined {
  if (isRecord(query.output) && isNonEmptyString(query.output.kind)) {
    return query.output as unknown as QueryOutput;
  }

  return undefined;
}

function normalizeOptionTemplate(
  optionTemplate: JsonObject,
  renderer: DashboardRenderer,
): { renderer: DashboardRenderer; optionTemplate: JsonObject } {
  const nextRenderer: DashboardRenderer = {
    kind: "echarts",
    option_template: optionTemplate,
    slots: renderer.slots,
  };

  return {
    renderer: nextRenderer,
    optionTemplate: nextRenderer.option_template,
  };
}

function hasForbiddenSql(sqlTemplate: string): boolean {
  const trimmed = sqlTemplate.trim();
  if (trimmed.includes(";")) {
    return true;
  }

  if (FORBIDDEN_SQL_PATTERN.test(trimmed)) {
    return true;
  }

  return !(trimmed.toLowerCase().startsWith("select") || trimmed.toLowerCase().startsWith("with"));
}

function validateFilter(filter: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(filter)) {
    pushIssue(issues, path, "filter must be an object");
    return;
  }

  if (!isNonEmptyString(filter.id)) {
    pushIssue(issues, `${path}.id`, "filter id must be a non-empty string");
  }

  if (!FILTER_KINDS.has(String(filter.kind))) {
    pushIssue(issues, `${path}.kind`, "filter kind must be time_range or single_select");
  }

  if (!isNonEmptyString(filter.label)) {
    pushIssue(issues, `${path}.label`, "filter label must be a non-empty string");
  }

  if (filter.default_value !== undefined && !isNonEmptyString(filter.default_value)) {
    pushIssue(issues, `${path}.default_value`, "default_value must be a string when provided");
  }

  if (filter.kind === "time_range" && !isStringArray(filter.resolved_fields)) {
    pushIssue(
      issues,
      `${path}.resolved_fields`,
      "time_range filter must define resolved_fields as a string array",
    );
  }

  if (filter.kind === "single_select") {
    if (!Array.isArray(filter.options) || filter.options.length === 0) {
      pushIssue(issues, `${path}.options`, "single_select filter must define options");
      return;
    }

    filter.options.forEach((option, index) => {
      if (!isRecord(option)) {
        pushIssue(issues, `${path}.options[${index}]`, "filter option must be an object");
        return;
      }

      if (!isNonEmptyString(option.label)) {
        pushIssue(issues, `${path}.options[${index}].label`, "option label must be a string");
      }

      if (!isNonEmptyString(option.value)) {
        pushIssue(issues, `${path}.options[${index}].value`, "option value must be a string");
      }
    });
  }
}

function validateLayoutItem(
  item: unknown,
  path: string,
  knownViewIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(item)) {
    pushIssue(issues, path, "layout item must be an object");
    return;
  }

  if (!isNonEmptyString(item.view_id)) {
    pushIssue(issues, `${path}.view_id`, "view_id must be a non-empty string");
  } else if (!knownViewIds.has(item.view_id)) {
    pushIssue(issues, `${path}.view_id`, "view_id must reference an existing view");
  }

  for (const key of ["x", "y", "w", "h"] as const) {
    if (!isNumber(item[key])) {
      pushIssue(issues, `${path}.${key}`, `${key} must be a finite number`);
    }
  }
}

function validateBreakpointLayout(
  layout: unknown,
  path: string,
  knownViewIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(layout)) {
    pushIssue(issues, path, "breakpoint layout must be an object");
    return;
  }

  if (!isNumber(layout.cols) || layout.cols <= 0) {
    pushIssue(issues, `${path}.cols`, "cols must be a positive number");
  }

  if (!isNumber(layout.row_height) || layout.row_height <= 0) {
    pushIssue(issues, `${path}.row_height`, "row_height must be a positive number");
  }

  if (!Array.isArray(layout.items)) {
    pushIssue(issues, `${path}.items`, "items must be an array");
    return;
  }

  const seenViewIds = new Set<string>();
  layout.items.forEach((item, index) => {
    validateLayoutItem(item, `${path}.items[${index}]`, knownViewIds, issues);
    if (isRecord(item) && isNonEmptyString(item.view_id)) {
      if (seenViewIds.has(item.view_id)) {
        pushIssue(issues, `${path}.items[${index}].view_id`, "view_id must be unique per breakpoint");
      }
      seenViewIds.add(item.view_id);
    }
  });
}

function validateRendererSlot(
  slot: unknown,
  path: string,
  optionTemplate: JsonObject,
  seenSlotIds: Set<string>,
  seenPaths: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(slot)) {
    pushIssue(issues, path, "slot must be an object");
    return;
  }

  if (!isNonEmptyString(slot.id)) {
    pushIssue(issues, `${path}.id`, "slot id must be a non-empty string");
  } else {
    if (seenSlotIds.has(slot.id)) {
      pushIssue(issues, `${path}.id`, "slot ids must be unique per view");
    }
    seenSlotIds.add(slot.id);
  }

  if (!isNonEmptyString(slot.path)) {
    pushIssue(issues, `${path}.path`, "slot path must be a non-empty string");
  } else {
    if (seenPaths.has(slot.path)) {
      pushIssue(issues, `${path}.path`, "slot paths must be unique per view");
    }
    seenPaths.add(slot.path);

    if (!hasRendererSlotPath(optionTemplate, slot.path)) {
      pushIssue(
        issues,
        `${path}.path`,
        "slot path must reference an existing node in option_template",
      );
    }
  }

  if (!SLOT_VALUE_KINDS.has(String(slot.value_kind))) {
    pushIssue(issues, `${path}.value_kind`, "slot value_kind must be rows, array, object or scalar");
  }

  if (slot.required !== undefined && typeof slot.required !== "boolean") {
    pushIssue(issues, `${path}.required`, "slot.required must be a boolean when provided");
  }
}

function validateOptionTemplate(
  optionTemplate: unknown,
  path: string,
  issues: ValidationIssue[],
  mode: ValidationMode,
): void {
  if (!isRecord(optionTemplate)) {
    pushIssue(issues, path, "option_template must be an object");
    return;
  }

  if (mode === "publish" && Object.keys(optionTemplate).length === 0) {
    pushIssue(issues, path, "option_template must not be empty when publish validation runs");
  }

  if (optionTemplate.series !== undefined && !Array.isArray(optionTemplate.series)) {
    pushIssue(issues, `${path}.series`, "series must be an array when provided");
    return;
  }

  (optionTemplate.series ?? []).forEach((series, index) => {
    if (!isRecord(series)) {
      pushIssue(issues, `${path}.series[${index}]`, "series entry must be an object");
      return;
    }

    if (series.encode === undefined) {
      return;
    }

    if (!isRecord(series.encode) || Object.keys(series.encode).length === 0) {
      pushIssue(issues, `${path}.series[${index}].encode`, "series.encode must be an object");
      return;
    }

    Object.entries(series.encode).forEach(([encodeKey, encodeValue]) => {
      const encodePath = `${path}.series[${index}].encode.${encodeKey}`;
      if (isNonEmptyString(encodeValue)) {
        return;
      }

      if (Array.isArray(encodeValue) && encodeValue.every(isNonEmptyString)) {
        return;
      }

      pushIssue(issues, encodePath, "encode values must be a string or string array");
    });
  });
}

export function validateDatasourceContext(input: unknown): ValidationResult<DatasourceContext> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return fail([{ path: "datasource_context", message: "DatasourceContext must be an object" }]);
  }

  if (!isNonEmptyString(input.datasource_id)) {
    pushIssue(issues, "datasource_context.datasource_id", "datasource_id must be a non-empty string");
  }

  if (input.dialect !== SUPPORTED_DIALECT) {
    pushIssue(
      issues,
      "datasource_context.dialect",
      `dialect must be ${SUPPORTED_DIALECT} for the MVP runtime`,
    );
  }

  if (!Array.isArray(input.tables) || input.tables.length === 0) {
    pushIssue(issues, "datasource_context.tables", "tables must be a non-empty array");
  }

  const declaredTables = new Set<string>();
  const declaredFields = new Set<string>();

  if (Array.isArray(input.tables)) {
    input.tables.forEach((table, tableIndex) => {
      const tablePath = `datasource_context.tables[${tableIndex}]`;
      if (!isRecord(table)) {
        pushIssue(issues, tablePath, "table must be an object");
        return;
      }

      if (!isNonEmptyString(table.name)) {
        pushIssue(issues, `${tablePath}.name`, "table name must be a non-empty string");
      } else {
        declaredTables.add(table.name);
      }

      if (!Array.isArray(table.fields) || table.fields.length === 0) {
        pushIssue(issues, `${tablePath}.fields`, "fields must be a non-empty array");
        return;
      }

      table.fields.forEach((field, fieldIndex) => {
        const fieldPath = `${tablePath}.fields[${fieldIndex}]`;
        if (!isRecord(field)) {
          pushIssue(issues, fieldPath, "field must be an object");
          return;
        }

        if (!isNonEmptyString(field.name)) {
          pushIssue(issues, `${fieldPath}.name`, "field name must be a non-empty string");
        } else {
          declaredFields.add(field.name);
        }

        if (!isNonEmptyString(field.type)) {
          pushIssue(issues, `${fieldPath}.type`, "field type must be a non-empty string");
        }

        if (
          field.semantic_type !== undefined &&
          !SEMANTIC_TYPES.has(String(field.semantic_type))
        ) {
          pushIssue(
            issues,
            `${fieldPath}.semantic_type`,
            "semantic_type must be time, dimension or metric",
          );
        }
      });
    });
  }

  if (!isRecord(input.visibility_scope)) {
    pushIssue(
      issues,
      "datasource_context.visibility_scope",
      "visibility_scope must be an object",
    );
  } else {
    const allowedTables = input.visibility_scope.allowed_tables;
    const allowedFields = input.visibility_scope.allowed_fields;

    if (!isStringArray(allowedTables)) {
      pushIssue(
        issues,
        "datasource_context.visibility_scope.allowed_tables",
        "allowed_tables must be a string array",
      );
    } else {
      allowedTables.forEach((tableName, index) => {
        if (!declaredTables.has(tableName)) {
          pushIssue(
            issues,
            `datasource_context.visibility_scope.allowed_tables[${index}]`,
            "allowed table must be declared in tables",
          );
        }
      });
    }

    if (!isStringArray(allowedFields)) {
      pushIssue(
        issues,
        "datasource_context.visibility_scope.allowed_fields",
        "allowed_fields must be a string array",
      );
    } else {
      allowedFields.forEach((fieldName, index) => {
        if (!declaredFields.has(fieldName)) {
          pushIssue(
            issues,
            `datasource_context.visibility_scope.allowed_fields[${index}]`,
            "allowed field must be declared in tables.fields",
          );
        }
      });
    }
  }

  return issues.length === 0 ? ok(input as unknown as DatasourceContext) : fail(issues);
}

export function validateRuntimeContext(input: unknown): ValidationResult<RuntimeContext> {
  if (input === undefined) {
    return ok({});
  }

  if (!isRecord(input)) {
    return fail([{ path: "runtime_context", message: "runtime_context must be an object" }]);
  }

  const issues: ValidationIssue[] = [];
  Object.entries(input).forEach(([key, value]) => {
    if (!ALLOWED_RUNTIME_CONTEXT_KEYS.includes(key as (typeof ALLOWED_RUNTIME_CONTEXT_KEYS)[number])) {
      pushIssue(
        issues,
        `runtime_context.${key}`,
        "runtime_context key is not allowed in the MVP runtime",
      );
    } else if (!isNonEmptyString(value)) {
      pushIssue(issues, `runtime_context.${key}`, "runtime_context values must be strings");
    }
  });

  return issues.length === 0 ? ok(input as RuntimeContext) : fail(issues);
}

export function validateDashboardSpec(
  input: unknown,
  mode: ValidationMode = "save",
): ValidationResult<DashboardSpec> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return fail([{ path: "dashboard_spec", message: "dashboard_spec must be an object" }]);
  }

  if (!SCHEMA_VERSIONS.has(String(input.schema_version))) {
    pushIssue(issues, "dashboard_spec.schema_version", "schema_version must be 0.2");
  }

  if (!isRecord(input.dashboard)) {
    pushIssue(issues, "dashboard_spec.dashboard", "dashboard must be an object");
  } else if (!isNonEmptyString(input.dashboard.name)) {
    pushIssue(issues, "dashboard_spec.dashboard.name", "dashboard.name must be a non-empty string");
  }

  if (!Array.isArray(input.views)) {
    pushIssue(issues, "dashboard_spec.views", "views must be an array");
  }

  const knownViewIds = new Set<string>();
  const normalizedViews: DashboardSpec["views"] = [];
  if (Array.isArray(input.views)) {
    input.views.forEach((view, index) => {
      const path = `dashboard_spec.views[${index}]`;
      if (!isRecord(view)) {
        pushIssue(issues, path, "view must be an object");
        return;
      }

      if (!isNonEmptyString(view.id)) {
        pushIssue(issues, `${path}.id`, "view id must be a non-empty string");
      } else {
        if (knownViewIds.has(view.id)) {
          pushIssue(issues, `${path}.id`, "view ids must be unique");
        }
        knownViewIds.add(view.id);
      }

      if (!isNonEmptyString(view.title)) {
        pushIssue(issues, `${path}.title`, "view title must be a non-empty string");
      }

      const optionTemplate = getViewOptionTemplate(view);
      if (!optionTemplate) {
        pushIssue(issues, `${path}.renderer.option_template`, "view must define renderer.option_template");
      } else {
        if (!isRecord(view.renderer)) {
          pushIssue(issues, `${path}.renderer`, "view must define renderer");
          return;
        }

        const renderer = view.renderer as unknown as DashboardRenderer;
        const normalizedRenderer = normalizeOptionTemplate(optionTemplate, renderer).renderer;

        if (renderer && renderer.kind !== "echarts") {
          pushIssue(issues, `${path}.renderer.kind`, "renderer.kind must be echarts");
        }

        if (mode === "publish" && normalizedRenderer.slots.length === 0) {
          pushIssue(issues, `${path}.renderer.slots`, "renderer.slots must be a non-empty array");
        }

        validateOptionTemplate(
          normalizedRenderer.option_template,
          `${path}.renderer.option_template`,
          issues,
          mode,
        );

        const seenSlotIds = new Set<string>();
        const seenPaths = new Set<string>();
        normalizedRenderer.slots.forEach((slot, slotIndex) => {
          validateRendererSlot(
            slot,
            `${path}.renderer.slots[${slotIndex}]`,
            normalizedRenderer.option_template,
            seenSlotIds,
            seenPaths,
            issues,
          );
        });

        normalizedViews.push({
          id: view.id as string,
          title: view.title as string,
          description: isNonEmptyString(view.description) ? view.description : undefined,
          renderer: normalizedRenderer,
        });
      }
    });
  }

  if (!Array.isArray(input.filters)) {
    pushIssue(issues, "dashboard_spec.filters", "filters must be an array");
  } else {
    const seenFilterIds = new Set<string>();
    input.filters.forEach((filter, index) => {
      validateFilter(filter, `dashboard_spec.filters[${index}]`, issues);
      if (isRecord(filter) && isNonEmptyString(filter.id)) {
        if (seenFilterIds.has(filter.id)) {
          pushIssue(issues, `dashboard_spec.filters[${index}].id`, "filter ids must be unique");
        }
        seenFilterIds.add(filter.id);
      }
    });
  }

  if (!isRecord(input.layout)) {
    pushIssue(issues, "dashboard_spec.layout", "layout must be an object");
  } else {
    for (const breakpoint of ["desktop", "mobile"] as const) {
      if (input.layout[breakpoint] !== undefined) {
        validateBreakpointLayout(
          input.layout[breakpoint],
          `dashboard_spec.layout.${breakpoint}`,
          knownViewIds,
          issues,
        );
      }
    }
  }

  if (issues.length > 0) {
    return fail(issues);
  }

  return ok({
    schema_version: "0.2",
    dashboard: {
      name: (input.dashboard as Record<string, unknown>).name as string,
      description: isNonEmptyString((input.dashboard as Record<string, unknown>).description)
        ? ((input.dashboard as Record<string, unknown>).description as string)
        : undefined,
    },
    layout: input.layout as DashboardSpec["layout"],
    views: normalizedViews,
    filters: input.filters as DashboardSpec["filters"],
  });
}

export function validateQueryDefs(input: unknown): ValidationResult<QueryDef[]> {
  if (!Array.isArray(input)) {
    return fail([{ path: "query_defs", message: "query_defs must be an array" }]);
  }

  const issues: ValidationIssue[] = [];
  const seenQueryIds = new Set<string>();
  const normalizedQueries: QueryDef[] = [];

  input.forEach((query, index) => {
    const path = `query_defs[${index}]`;
    if (!isRecord(query)) {
      pushIssue(issues, path, "query def must be an object");
      return;
    }

    if (!isNonEmptyString(query.id)) {
      pushIssue(issues, `${path}.id`, "query id must be a non-empty string");
    } else {
      if (seenQueryIds.has(query.id)) {
        pushIssue(issues, `${path}.id`, "query ids must be unique");
      }
      seenQueryIds.add(query.id);
    }

    if (!isNonEmptyString(query.name)) {
      pushIssue(issues, `${path}.name`, "query name must be a non-empty string");
    }

    if (!isNonEmptyString(query.datasource_id)) {
      pushIssue(issues, `${path}.datasource_id`, "datasource_id must be a non-empty string");
    }

    if (!isNonEmptyString(query.sql_template)) {
      pushIssue(issues, `${path}.sql_template`, "sql_template must be a non-empty string");
    } else if (hasForbiddenSql(query.sql_template)) {
      pushIssue(
        issues,
        `${path}.sql_template`,
        "sql_template must be a single read-only SELECT or CTE + SELECT statement",
      );
    }

    const templateParams = isNonEmptyString(query.sql_template)
      ? getSqlTemplateParams(query.sql_template)
      : [];

    if (!Array.isArray(query.params)) {
      pushIssue(issues, `${path}.params`, "params must be an array");
    }

    const declaredParams = new Set<string>();
    if (Array.isArray(query.params)) {
      query.params.forEach((param, paramIndex) => {
        const paramPath = `${path}.params[${paramIndex}]`;
        if (!isRecord(param)) {
          pushIssue(issues, paramPath, "query param must be an object");
          return;
        }

        if (!isNonEmptyString(param.name)) {
          pushIssue(issues, `${paramPath}.name`, "param name must be a non-empty string");
        } else {
          declaredParams.add(param.name);
        }

        if (!QUERY_PARAM_TYPES.has(String(param.type))) {
          pushIssue(issues, `${paramPath}.type`, "param type is not supported");
        }

        if (
          param.cardinality !== undefined &&
          !QUERY_PARAM_CARDINALITIES.has(String(param.cardinality))
        ) {
          pushIssue(issues, `${paramPath}.cardinality`, "cardinality must be scalar or array");
        }

        if (param.default_value !== undefined && !isJsonValue(param.default_value)) {
          pushIssue(issues, `${paramPath}.default_value`, "default_value must be JSON-serializable");
        }
      });
    }

    templateParams.forEach((paramName) => {
      if (!declaredParams.has(paramName)) {
        pushIssue(
          issues,
          `${path}.sql_template`,
          `sql_template references undeclared param ${paramName}`,
        );
      }
    });

    const output = getQueryOutput(query);
    if (!output) {
      pushIssue(issues, `${path}.output`, "query must define output");
      return;
    }

    if (!SLOT_VALUE_KINDS.has(output.kind)) {
      pushIssue(issues, `${path}.output.kind`, "output.kind must be rows, array, object or scalar");
      return;
    }

    const resultFieldNames = new Set<string>();
    if (output.kind === "rows") {
      if (!Array.isArray(output.schema) || output.schema.length === 0) {
        pushIssue(issues, `${path}.output.schema`, "rows output must define a non-empty schema");
        return;
      }

      output.schema.forEach((field, fieldIndex) => {
        const fieldPath = `${path}.output.schema[${fieldIndex}]`;
        if (!isRecord(field)) {
          pushIssue(issues, fieldPath, "result schema field must be an object");
          return;
        }

        if (!isNonEmptyString(field.name)) {
          pushIssue(issues, `${fieldPath}.name`, "result field name must be a non-empty string");
        } else {
          if (resultFieldNames.has(field.name)) {
            pushIssue(issues, `${fieldPath}.name`, "result field names must be unique");
          }
          resultFieldNames.add(field.name);
        }

        if (!QUERY_PARAM_TYPES.has(String(field.type))) {
          pushIssue(issues, `${fieldPath}.type`, "result field type is not supported");
        }

        if (typeof field.nullable !== "boolean") {
          pushIssue(issues, `${fieldPath}.nullable`, "nullable must be a boolean");
        }
      });
    }

    if (output.kind === "scalar" && !QUERY_PARAM_TYPES.has(String(output.value_type))) {
      pushIssue(issues, `${path}.output.value_type`, "scalar output must declare a supported value_type");
    }

    normalizedQueries.push({
      id: query.id as string,
      name: query.name as string,
      datasource_id: query.datasource_id as string,
      sql_template: query.sql_template as string,
      params: Array.isArray(query.params) ? (query.params as QueryDef["params"]) : [],
      output,
    });
  });

  return issues.length === 0 ? ok(normalizedQueries) : fail(issues);
}

function validateParamMappingEntry(
  entry: unknown,
  path: string,
  issues: ValidationIssue[],
): entry is BindingParamMapping {
  if (!isRecord(entry)) {
    pushIssue(issues, path, "param mapping entry must be an object");
    return false;
  }

  if (!PARAM_SOURCES.has(String(entry.source))) {
    pushIssue(issues, `${path}.source`, "source must be filter, constant or runtime_context");
    return false;
  }

  if (!hasOwn(entry, "value") || !isJsonValue(entry.value)) {
    pushIssue(issues, `${path}.value`, "value must be JSON-serializable");
    return false;
  }

  if ((entry.source === "filter" || entry.source === "runtime_context") && !isNonEmptyString(entry.value)) {
    pushIssue(issues, `${path}.value`, "filter and runtime_context mappings must point to a string path");
    return false;
  }

  return true;
}

function getSelectorOutputKind(selector: string | null | undefined) {
  if (!isNonEmptyString(selector)) {
    return null;
  }

  if (selector === "rows") {
    return "rows";
  }

  if (selector === "rows[0]") {
    return "object";
  }

  if (/^rows\[\]\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(selector)) {
    return "array";
  }

  if (/^rows\[0\]\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(selector)) {
    return "scalar";
  }

  return null;
}

export function validateBindings(
  input: unknown,
  dashboardSpec: DashboardSpec,
  queryDefs: QueryDef[],
  mode: ValidationMode = "save",
): ValidationResult<Binding[]> {
  if (!Array.isArray(input)) {
    return fail([{ path: "bindings", message: "bindings must be an array" }]);
  }

  const issues: ValidationIssue[] = [];
  const seenBindingIds = new Set<string>();
  const seenViewSlotBindings = new Set<string>();
  const viewIds = new Set(dashboardSpec.views.map((view) => view.id));
  const viewById = new Map(dashboardSpec.views.map((view) => [view.id, view]));
  const queryById = new Map(queryDefs.map((query) => [query.id, query]));
  const normalizedBindings: Binding[] = [];

  input.forEach((binding, index) => {
    const path = `bindings[${index}]`;
    if (!isRecord(binding)) {
      pushIssue(issues, path, "binding must be an object");
      return;
    }

    if (!isNonEmptyString(binding.id)) {
      pushIssue(issues, `${path}.id`, "binding id must be a non-empty string");
    } else {
      if (seenBindingIds.has(binding.id)) {
        pushIssue(issues, `${path}.id`, "binding ids must be unique");
      }
      seenBindingIds.add(binding.id);
    }

    const view = isNonEmptyString(binding.view_id) ? viewById.get(binding.view_id) : undefined;
    const slots = view ? getViewSlots(view as unknown as Record<string, unknown>) : [];
    const slotId = isNonEmptyString(binding.slot_id) ? binding.slot_id : undefined;
    const slot = slotId ? slots.find((candidate) => candidate.id === slotId) : undefined;

    if (!isNonEmptyString(binding.view_id)) {
      pushIssue(issues, `${path}.view_id`, "view_id must be a non-empty string");
    } else if (!viewIds.has(binding.view_id)) {
      pushIssue(issues, `${path}.view_id`, "view_id must reference an existing view");
    }

    if (!isNonEmptyString(slotId)) {
      pushIssue(issues, `${path}.slot_id`, "slot_id must be a non-empty string");
    } else if (!slot) {
      pushIssue(issues, `${path}.slot_id`, "slot_id must reference an existing renderer slot");
    } else {
      const bindingKey = `${binding.view_id}:${slotId}`;
      if (seenViewSlotBindings.has(bindingKey)) {
        pushIssue(issues, `${path}.slot_id`, "view_id + slot_id must be unique");
      }
      seenViewSlotBindings.add(bindingKey);
    }

    const bindingMode = binding.mode ?? "live";

    if (!BINDING_MODES.has(String(bindingMode))) {
      pushIssue(issues, `${path}.mode`, "binding mode must be mock or live");
      return;
    }

    if (bindingMode === "mock") {
      if (!isRecord(binding.mock_data) || !Array.isArray(binding.mock_data.rows)) {
        pushIssue(issues, `${path}.mock_data.rows`, "mock bindings must define mock_data.rows");
      } else if (
        binding.mock_data.rows.some(
          (row) =>
            !isRecord(row) ||
            Object.values(row).some((value) => !isJsonValue(value)),
        )
      ) {
        pushIssue(issues, `${path}.mock_data.rows`, "mock_data.rows must contain JSON row objects");
      }

      if (binding.query_id !== undefined) {
        pushIssue(issues, `${path}.query_id`, "mock bindings must not define query_id");
      }

      if (binding.param_mapping !== undefined) {
        pushIssue(
          issues,
          `${path}.param_mapping`,
          "mock bindings must not define live param_mapping",
        );
      }

      if (binding.field_mapping !== undefined) {
        pushIssue(
          issues,
          `${path}.field_mapping`,
          "field_mapping is no longer supported; use SQL aliases, output.schema, and result_selector instead",
        );
      }

      normalizedBindings.push({
        id: binding.id as string,
        view_id: binding.view_id as string,
        slot_id: slotId as string,
        mode: "mock",
        result_selector: null,
        mock_data: isRecord(binding.mock_data)
          ? (binding.mock_data as unknown as Binding["mock_data"])
          : undefined,
        mock_value: isJsonValue(binding.mock_value)
          ? binding.mock_value
          : isRecord(binding.mock_data) && Array.isArray(binding.mock_data.rows)
            ? (binding.mock_data.rows as JsonValue[])
            : undefined,
      });

      return;
    }

    if (binding.mock_data !== undefined) {
      pushIssue(issues, `${path}.mock_data`, "live bindings must not define mock_data");
    }

    if (!isNonEmptyString(binding.query_id)) {
      pushIssue(issues, `${path}.query_id`, "live bindings must define query_id");
    } else if (!queryById.has(binding.query_id)) {
      pushIssue(issues, `${path}.query_id`, "query_id must reference an existing query");
    }

    const query = isNonEmptyString(binding.query_id) ? queryById.get(binding.query_id) : undefined;
    const output = query?.output ?? (query ? getQueryOutput(query as unknown as Record<string, unknown>) : undefined);
    const selectorKind = getSelectorOutputKind(
      isNonEmptyString(binding.result_selector) ? binding.result_selector : null,
    );
    if (binding.result_selector !== undefined && binding.result_selector !== null) {
      if (!isNonEmptyString(binding.result_selector)) {
        pushIssue(
          issues,
          `${path}.result_selector`,
          "result_selector must be a non-empty string when provided",
        );
      } else if (!selectorKind) {
        pushIssue(
          issues,
          `${path}.result_selector`,
          "result_selector must be one of rows, rows[0], rows[].field or rows[0].field",
        );
      }
    }
    const effectiveOutputKind = selectorKind ?? output?.kind;
    if (slot && output && effectiveOutputKind !== slot.value_kind) {
      pushIssue(
        issues,
        `${path}.query_id`,
        `query output kind ${effectiveOutputKind} is not compatible with slot value_kind ${slot.value_kind}`,
      );
    }

    if (!isRecord(binding.param_mapping)) {
      pushIssue(issues, `${path}.param_mapping`, "param_mapping must be an object");
    } else {
      Object.entries(binding.param_mapping).forEach(([paramName, entry]) => {
        const entryPath = `${path}.param_mapping.${paramName}`;
        if (query && !query.params.some((param) => param.name === paramName)) {
          pushIssue(issues, entryPath, "param_mapping key must exist in QueryDef.params");
        }

        validateParamMappingEntry(entry, entryPath, issues);
      });

      if (query) {
        query.params.forEach((param) => {
          if (
            param.required === true &&
            param.default_value === undefined &&
            !hasOwn(binding.param_mapping as Record<string, unknown>, param.name)
          ) {
            pushIssue(
              issues,
              `${path}.param_mapping.${param.name}`,
              "param_mapping must cover required query params",
            );
          }
        });
      }
    }

    if (binding.field_mapping !== undefined) {
      pushIssue(
        issues,
        `${path}.field_mapping`,
        "field_mapping is no longer supported; use SQL aliases, output.schema, and result_selector instead",
      );
    }

    normalizedBindings.push({
      id: binding.id as string,
      view_id: binding.view_id as string,
      slot_id: slotId as string,
      mode: "live",
      query_id: binding.query_id as string,
      param_mapping: binding.param_mapping as Binding["param_mapping"],
      result_selector: isNonEmptyString(binding.result_selector)
        ? binding.result_selector
        : null,
    });
  });

  if (mode === "publish") {
    const layoutViewIds = new Set<string>();

    for (const breakpoint of ["desktop", "mobile"] as const) {
      const layout = dashboardSpec.layout[breakpoint];
      layout?.items.forEach((item) => layoutViewIds.add(item.view_id));
    }

    layoutViewIds.forEach((viewId) => {
      const view = viewById.get(viewId);
      if (!view) {
        return;
      }

      getViewSlots(view as unknown as Record<string, unknown>)
        .filter((slot) => slot.required !== false)
        .forEach((slot) => {
          const bindingExists = normalizedBindings.some(
            (binding) => binding.view_id === viewId && binding.slot_id === slot.id,
          );

          if (!bindingExists) {
            pushIssue(
              issues,
              "bindings",
              `layout view ${viewId} must bind required slot ${slot.id} before publish`,
            );
          }
        });
    });
  }

  return issues.length === 0 ? ok(normalizedBindings) : fail(issues);
}

export function validateDashboardDocument(
  input: unknown,
  mode: ValidationMode = "save",
): ValidationResult<DashboardDocument> {
  if (!isRecord(input)) {
    return fail([{ path: "document", message: "dashboard document must be an object" }]);
  }

  const specResult = validateDashboardSpec(input.dashboard_spec, mode);
  const queryResult = validateQueryDefs(input.query_defs);
  const issues = [...specResult.issues, ...queryResult.issues];

  if (!specResult.ok || !queryResult.ok) {
    return fail(issues);
  }

  const bindingsResult = validateBindings(input.bindings, specResult.value, queryResult.value, mode);
  issues.push(...bindingsResult.issues);

  if (!bindingsResult.ok) {
    return fail(issues);
  }

  return ok({
    dashboard_spec: specResult.value,
    query_defs: queryResult.value,
    bindings: bindingsResult.value,
  });
}

export function validatePreviewRequest(input: unknown): ValidationResult<PreviewRequest> {
  if (!isRecord(input)) {
    return fail([{ path: "preview_request", message: "preview request must be an object" }]);
  }

  const previewIssues: ValidationIssue[] = [];
  if (
    input.visible_view_ids !== undefined &&
    (!Array.isArray(input.visible_view_ids) || !input.visible_view_ids.every(isNonEmptyString))
  ) {
    pushIssue(
      previewIssues,
      "preview_request.visible_view_ids",
      "visible_view_ids must be a string array when provided",
    );
  }

  const documentResult = validateDashboardDocument(input, "save");
  const runtimeResult = validateRuntimeContext(input.runtime_context);
  const issues = [...previewIssues, ...documentResult.issues, ...runtimeResult.issues];

  if (previewIssues.length > 0 || !documentResult.ok || !runtimeResult.ok) {
    return fail(issues);
  }

  return ok({
    ...documentResult.value,
    visible_view_ids: Array.isArray(input.visible_view_ids)
      ? (input.visible_view_ids as string[])
      : undefined,
    filter_values: isRecord(input.filter_values)
      ? (input.filter_values as Record<string, JsonValue>)
      : undefined,
    runtime_context: runtimeResult.value,
  });
}

export function validateExecuteBatchRequest(input: unknown): ValidationResult<ExecuteBatchRequest> {
  if (!isRecord(input)) {
    return fail([
      { path: "execute_batch_request", message: "execute-batch request must be an object" },
    ]);
  }

  const issues: ValidationIssue[] = [];

  if (!isNonEmptyString(input.dashboard_id)) {
    pushIssue(issues, "execute_batch_request.dashboard_id", "dashboard_id must be a string");
  }

  if (!isNumber(input.version) || input.version < 1) {
    pushIssue(issues, "execute_batch_request.version", "version must be a positive number");
  }

  if (!Array.isArray(input.visible_view_ids) || !input.visible_view_ids.every(isNonEmptyString)) {
    pushIssue(
      issues,
      "execute_batch_request.visible_view_ids",
      "visible_view_ids must be a string array",
    );
  }

  const runtimeResult = validateRuntimeContext(input.runtime_context);
  issues.push(...runtimeResult.issues);

  if (issues.length > 0) {
    return fail(issues);
  }

  const dashboardId = input.dashboard_id as string;
  const version = input.version as number;
  const visibleViewIds = input.visible_view_ids as string[];

  return ok({
    dashboard_id: dashboardId,
    version,
    visible_view_ids: visibleViewIds,
    filter_values: isRecord(input.filter_values)
      ? (input.filter_values as Record<string, JsonValue>)
      : undefined,
    runtime_context: runtimeResult.value,
  });
}
