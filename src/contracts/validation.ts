import type {
  Binding,
  BindingParamMapping,
  DashboardDocument,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardRendererTransform,
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
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "./dashboard-chart-recipes";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "./schema-version";
import {
  DASHBOARD_COLOR_THEME_IDS,
  DASHBOARD_DESIGN_KIT_IDS,
  DASHBOARD_VIEW_STYLE_IDS,
} from "./dashboard-presentation";
import { hasRendererSlotPath } from "./slot-path";

export const SUPPORTED_DIALECTS = new Set(["postgres", "athena"] as const);
export const ALLOWED_RUNTIME_CONTEXT_KEYS = ["timezone", "locale"] as const;
const ALLOWED_RUNTIME_CONTEXT_KEY_SET = new Set<string>(ALLOWED_RUNTIME_CONTEXT_KEYS);

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
const TIME_RANGE_PRESETS = new Set(["today", "this_week", "last_12_weeks"]);
const PARAM_SOURCES = new Set(["filter", "constant", "runtime_context"]);
const BINDING_MODES = new Set(["mock", "live"]);
const SCHEMA_VERSIONS = new Set(["0.3"]);
const DASHBOARD_TEMPLATE_REFS = new Map([["operational_report", "1"]]);
const PRESENTATION_DESIGN_KIT_IDS = new Set<string>(DASHBOARD_DESIGN_KIT_IDS);
const PRESENTATION_COLOR_THEME_IDS = new Set<string>(DASHBOARD_COLOR_THEME_IDS);
const PRESENTATION_VIEW_STYLE_IDS = new Set<string>(DASHBOARD_VIEW_STYLE_IDS);
const ECHARTS_RECIPE_IDS = new Set<string>(ECHARTS_STAGE_CHART_RECIPE_IDS);
const SLOT_VALUE_KINDS = new Set(["rows", "array", "object", "scalar"]);
const SLOT_FORMATTERS = new Set(["integer", "usd_0", "usd_2"]);
const RENDERER_TRANSFORM_KINDS = new Set(["pivot_rows", "generate_series"]);
const REMOVED_SLOT_TRANSFORM_FIELDS = ["series_key_field", "time_field", "value_field"];
const SEMANTIC_TYPES = new Set(["time", "dimension", "metric"]);
const REMOVED_KPI_VALUE_SLOT_PATH = "graphic[0].style.text";
const HARDCODED_ECHARTS_COLOR_PATTERN =
  /(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\))/i;
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

function getViewTransforms(view: Record<string, unknown>): DashboardRendererTransform[] {
  if (
    isRecord(view.renderer) &&
    Array.isArray(view.renderer.transforms)
  ) {
    return view.renderer.transforms as DashboardRendererTransform[];
  }

  return [];
}

function isPivotRowsTransform(
  transform: DashboardRendererTransform,
): transform is Extract<DashboardRendererTransform, { kind: "pivot_rows" }> {
  return transform.kind === "pivot_rows";
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
    recipe_id: renderer.recipe_id,
    option_template: optionTemplate,
    slots: renderer.slots,
    ...(Array.isArray(renderer.transforms)
      ? { transforms: renderer.transforms }
      : {}),
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

function validateFilter(
  filter: unknown,
  path: string,
  issues: ValidationIssue[],
  mode: ValidationMode,
): void {
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

  if (mode === "publish" && filter.default_value === undefined) {
    pushIssue(issues, `${path}.default_value`, "default_value is required before publish");
  }

  if (filter.kind === "time_range") {
    if (!isStringArray(filter.resolved_fields)) {
      pushIssue(
        issues,
        `${path}.resolved_fields`,
        "time_range filter must define resolved_fields as a string array",
      );
    }

    if (
      isNonEmptyString(filter.default_value) &&
      !TIME_RANGE_PRESETS.has(filter.default_value)
    ) {
      pushIssue(
        issues,
        `${path}.default_value`,
        "time_range default_value must be today, this_week or last_12_weeks",
      );
    }
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

function validateTemplateRef(
  template: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (template === undefined) {
    return;
  }

  if (!isRecord(template)) {
    pushIssue(issues, path, "template must be an object when provided");
    return;
  }

  if (!isNonEmptyString(template.id)) {
    pushIssue(issues, `${path}.id`, "template id must be a non-empty string");
  }

  if (!isNonEmptyString(template.version)) {
    pushIssue(issues, `${path}.version`, "template version must be a non-empty string");
  }

  if (
    isNonEmptyString(template.id) &&
    isNonEmptyString(template.version) &&
    DASHBOARD_TEMPLATE_REFS.get(template.id) !== template.version
  ) {
    pushIssue(issues, path, "template must reference a registered dashboard template");
  }
}

function validatePresentation(
  presentation: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (presentation === undefined) {
    pushIssue(issues, path, "presentation is required for schema_version 0.3");
    return;
  }

  if (!isRecord(presentation)) {
    pushIssue(issues, path, "presentation must be an object when provided");
    return;
  }

  const designKitId =
    typeof presentation.design_kit_id === "string" ? presentation.design_kit_id.trim() : "";
  const colorThemeId =
    typeof presentation.color_theme_id === "string" ? presentation.color_theme_id.trim() : "";
  const defaultViewStyleId =
    typeof presentation.default_view_style_id === "string"
      ? presentation.default_view_style_id.trim()
      : "";

  for (const removedKey of ["theme_id", "density", "card_chrome"]) {
    if (presentation[removedKey] !== undefined) {
      pushIssue(
        issues,
        `${path}.${removedKey}`,
        "removed presentation fields are not supported in schema_version 0.3",
      );
    }
  }

  if (!isNonEmptyString(presentation.design_kit_id)) {
    pushIssue(issues, `${path}.design_kit_id`, "design_kit_id must be a non-empty string");
  } else if (!PRESENTATION_DESIGN_KIT_IDS.has(designKitId)) {
    pushIssue(issues, `${path}.design_kit_id`, "design_kit_id must be a registered dashboard design kit");
  }

  if (!isNonEmptyString(presentation.color_theme_id)) {
    pushIssue(issues, `${path}.color_theme_id`, "color_theme_id must be a non-empty string");
  } else if (!PRESENTATION_COLOR_THEME_IDS.has(colorThemeId)) {
    pushIssue(issues, `${path}.color_theme_id`, "color_theme_id must be a registered dashboard color theme");
  }

  if (!isNonEmptyString(presentation.default_view_style_id)) {
    pushIssue(
      issues,
      `${path}.default_view_style_id`,
      "default_view_style_id must be a non-empty string",
    );
  } else if (!PRESENTATION_VIEW_STYLE_IDS.has(defaultViewStyleId)) {
    pushIssue(
      issues,
      `${path}.default_view_style_id`,
      "default_view_style_id must be a registered dashboard view style",
    );
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
    } else if (!Number.isInteger(item[key])) {
      pushIssue(issues, `${path}.${key}`, `${key} must be an integer`);
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
    if (slot.id === "value" && slot.path === REMOVED_KPI_VALUE_SLOT_PATH) {
      pushIssue(
        issues,
        `${path}.path`,
        "removed KPI value slot path is not supported in schema_version 0.3",
      );
    }
  }

  if (!SLOT_VALUE_KINDS.has(String(slot.value_kind))) {
    pushIssue(issues, `${path}.value_kind`, "slot value_kind must be rows, array, object or scalar");
  }

  if (slot.required !== undefined && typeof slot.required !== "boolean") {
    pushIssue(issues, `${path}.required`, "slot.required must be a boolean when provided");
  }

  if (slot.formatter !== undefined && !SLOT_FORMATTERS.has(String(slot.formatter))) {
    pushIssue(
      issues,
      `${path}.formatter`,
      "slot formatter must be integer, usd_0, or usd_2",
    );
  }

  REMOVED_SLOT_TRANSFORM_FIELDS.forEach((fieldName) => {
    if (hasOwn(slot, fieldName)) {
      pushIssue(
        issues,
        `${path}.${fieldName}`,
        "slot-level renderer transforms are not supported; use renderer.transforms",
      );
    }
  });
}

function requiredTransformString(
  transform: Record<string, unknown>,
  propertyName: string,
  path: string,
  issues: ValidationIssue[],
): string | null {
  if (!isNonEmptyString(transform[propertyName])) {
    pushIssue(issues, `${path}.${propertyName}`, `${propertyName} must be a non-empty string`);
    return null;
  }

  return transform[propertyName] as string;
}

function validateRendererTransforms(
  transforms: unknown,
  path: string,
  optionTemplate: JsonObject,
  slots: DashboardRendererSlot[],
  issues: ValidationIssue[],
): void {
  if (transforms === undefined) {
    return;
  }

  if (!Array.isArray(transforms)) {
    pushIssue(issues, path, "renderer.transforms must be an array when provided");
    return;
  }

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const seenTransformIds = new Set<string>();

  transforms.forEach((transform, index) => {
    const transformPath = `${path}[${index}]`;
    if (!isRecord(transform)) {
      pushIssue(issues, transformPath, "renderer transform must be an object");
      return;
    }

    const transformId = requiredTransformString(transform, "id", transformPath, issues);
    if (transformId && seenTransformIds.has(transformId)) {
      pushIssue(issues, `${transformPath}.id`, "renderer transform ids must be unique per view");
    }

    const hasKnownKind = RENDERER_TRANSFORM_KINDS.has(String(transform.kind));
    if (!hasKnownKind) {
      pushIssue(
        issues,
        `${transformPath}.kind`,
        "renderer transform kind must be pivot_rows or generate_series",
      );
    }

    if (transform.kind === "pivot_rows") {
      const sourceSlotId = requiredTransformString(transform, "source_slot", transformPath, issues);
      requiredTransformString(transform, "row_key", transformPath, issues);
      requiredTransformString(transform, "column_key", transformPath, issues);
      requiredTransformString(transform, "value_field", transformPath, issues);
      const targetPath = requiredTransformString(transform, "target_path", transformPath, issues);

      if (sourceSlotId) {
        const sourceSlot = slotById.get(sourceSlotId);
        if (!sourceSlot) {
          pushIssue(
            issues,
            `${transformPath}.source_slot`,
            "pivot_rows source_slot must reference an existing renderer slot",
          );
        } else if (sourceSlot.value_kind !== "rows") {
          pushIssue(
            issues,
            `${transformPath}.source_slot`,
            "pivot_rows source_slot must reference a rows slot",
          );
        }
      }

      if (targetPath && !hasRendererSlotPath(optionTemplate, targetPath)) {
        pushIssue(
          issues,
          `${transformPath}.target_path`,
          "transform target_path must reference an existing node in option_template",
        );
      }
    }

    if (transform.kind === "generate_series") {
      const sourceTransformId = requiredTransformString(
        transform,
        "source_transform",
        transformPath,
        issues,
      );
      const targetPath = requiredTransformString(transform, "target_path", transformPath, issues);
      requiredTransformString(transform, "series_type", transformPath, issues);
      requiredTransformString(transform, "encode_x", transformPath, issues);

      if (sourceTransformId && !seenTransformIds.has(sourceTransformId)) {
        pushIssue(
          issues,
          `${transformPath}.source_transform`,
          "generate_series source_transform must reference an earlier renderer transform",
        );
      }

      if (targetPath && !hasRendererSlotPath(optionTemplate, targetPath)) {
        pushIssue(
          issues,
          `${transformPath}.target_path`,
          "transform target_path must reference an existing node in option_template",
        );
      }

      if (
        transform.defaults !== undefined &&
        (!isRecord(transform.defaults) || !isJsonValue(transform.defaults))
      ) {
        pushIssue(
          issues,
          `${transformPath}.defaults`,
          "generate_series defaults must be a JSON object when provided",
        );
      }
    }

    if (transformId && hasKnownKind && !seenTransformIds.has(transformId)) {
      seenTransformIds.add(transformId);
    }
  });
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

  const hardcodedColorPaths = findHardcodedEChartsColorPaths(optionTemplate);
  if (hardcodedColorPaths.length > 0) {
    pushIssue(
      issues,
      path,
      `option_template must use dashboard theme tokens instead of hardcoded ECharts colors: ${hardcodedColorPaths
        .slice(0, 5)
        .join(", ")}`,
    );
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

function findHardcodedEChartsColorPaths(value: unknown): string[] {
  const paths: string[] = [];
  visitJsonValue(value, "", (entry, path) => {
    if (typeof entry === "string" && HARDCODED_ECHARTS_COLOR_PATTERN.test(entry)) {
      paths.push(path || "$");
    }
  });
  return paths;
}

function visitJsonValue(
  value: unknown,
  path: string,
  visitor: (value: unknown, path: string) => void,
): void {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitJsonValue(entry, `${path}[${index}]`, visitor));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    visitJsonValue(entry, path ? `${path}.${key}` : key, visitor);
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

  if (typeof input.dialect !== "string" || !SUPPORTED_DIALECTS.has(input.dialect as "postgres" | "athena")) {
    pushIssue(
      issues,
      "datasource_context.dialect",
      "dialect must be postgres or athena",
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
    pushIssue(issues, "dashboard_spec.schema_version", "schema_version must be 0.3");
  }

  validateTemplateRef(input.template, "dashboard_spec.template", issues);
  validatePresentation(input.presentation, "dashboard_spec.presentation", issues);

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

      if (
        view.view_style_id !== undefined &&
        (!isNonEmptyString(view.view_style_id) ||
          !PRESENTATION_VIEW_STYLE_IDS.has(String(view.view_style_id).trim()))
      ) {
        pushIssue(
          issues,
          `${path}.view_style_id`,
          "view_style_id must be a registered dashboard view style when provided",
        );
      }

      const optionTemplate = getViewOptionTemplate(view);
      if (!optionTemplate) {
        pushIssue(issues, `${path}.renderer.option_template`, "view must define renderer.option_template");
      } else {
        if (!isRecord(view.renderer)) {
          pushIssue(issues, `${path}.renderer`, "view must define renderer");
          return;
        }

        if (!Array.isArray(view.renderer.slots)) {
          pushIssue(issues, `${path}.renderer.slots`, "renderer.slots must be an array");
          return;
        }

        const renderer = view.renderer as unknown as DashboardRenderer;
        const normalizedRenderer = normalizeOptionTemplate(optionTemplate, renderer).renderer;

        if (renderer && renderer.kind !== "echarts") {
          pushIssue(issues, `${path}.renderer.kind`, "renderer.kind must be echarts");
        }

        if (!isNonEmptyString(renderer.recipe_id)) {
          pushIssue(issues, `${path}.renderer.recipe_id`, "renderer.recipe_id must be a non-empty string");
        } else if (!ECHARTS_RECIPE_IDS.has(String(renderer.recipe_id))) {
          pushIssue(issues, `${path}.renderer.recipe_id`, "renderer.recipe_id must be a registered ECharts recipe");
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
        validateRendererTransforms(
          (view.renderer as Record<string, unknown>).transforms,
          `${path}.renderer.transforms`,
          normalizedRenderer.option_template,
          normalizedRenderer.slots,
          issues,
        );

        normalizedViews.push({
          id: view.id as string,
          title: view.title as string,
          description: isNonEmptyString(view.description) ? view.description : undefined,
          view_style_id: isNonEmptyString(view.view_style_id)
            ? String(view.view_style_id)
            : undefined,
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
      validateFilter(filter, `dashboard_spec.filters[${index}]`, issues, mode);
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

    if (mode === "publish") {
      const layoutViewIds = new Set<string>();
      for (const breakpoint of ["desktop", "mobile"] as const) {
        const layout = input.layout[breakpoint];
        if (isRecord(layout) && Array.isArray(layout.items)) {
          layout.items.forEach((item) => {
            if (isRecord(item) && isNonEmptyString(item.view_id)) {
              layoutViewIds.add(item.view_id);
            }
          });
        }
      }
      if (normalizedViews.length === 0) {
        pushIssue(
          issues,
          "dashboard_spec.views",
          "at least one view is required before publish",
        );
      }
      if (layoutViewIds.size === 0) {
        pushIssue(
          issues,
          "dashboard_spec.layout",
          "at least one visible layout item is required before publish",
        );
      }
    }
  }

  if (issues.length > 0) {
    return fail(issues);
  }

  return ok({
    schema_version: "0.3",
    ...(isRecord(input.template)
      ? {
          template: {
            id: input.template.id as string,
            version: input.template.version as string,
          },
        }
      : {}),
    presentation: {
      design_kit_id: (input.presentation as Record<string, unknown>).design_kit_id as string,
      color_theme_id: (input.presentation as Record<string, unknown>).color_theme_id as string,
      default_view_style_id: (input.presentation as Record<string, unknown>).default_view_style_id as string,
    },
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

function validateResultSchemaFields(
  schema: unknown,
  path: string,
  outputKind: "rows" | "object",
  issues: ValidationIssue[],
): schema is ResultSchemaField[] {
  if (!Array.isArray(schema) || schema.length === 0) {
    pushIssue(issues, path, `${outputKind} output must define a non-empty schema`);
    return false;
  }

  const resultFieldNames = new Set<string>();
  schema.forEach((field, fieldIndex) => {
    const fieldPath = `${path}[${fieldIndex}]`;
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

  return true;
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

    if (output.kind === "rows") {
      validateResultSchemaFields(output.schema, `${path}.output.schema`, "rows", issues);
    }

    if (output.kind === "array" && !QUERY_PARAM_TYPES.has(String(output.item_type))) {
      pushIssue(issues, `${path}.output.item_type`, "array output must declare a supported item_type");
    }

    if (output.kind === "object") {
      validateResultSchemaFields(output.schema, `${path}.output.schema`, "object", issues);
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

function validateParamMappingReference(input: {
  entry: BindingParamMapping;
  path: string;
  filterById: Map<string, DashboardSpec["filters"][number]>;
  issues: ValidationIssue[];
}): void {
  const { entry, path, filterById, issues } = input;
  if (entry.source === "constant") {
    return;
  }

  if (!isNonEmptyString(entry.value)) {
    return;
  }

  if (entry.source === "runtime_context") {
    if (!ALLOWED_RUNTIME_CONTEXT_KEY_SET.has(entry.value)) {
      pushIssue(
        issues,
        `${path}.value`,
        "runtime_context mapping must point to timezone or locale",
      );
    }
    return;
  }

  const segments = entry.value.split(".");
  if (segments.length !== 2 || !segments.every(isNonEmptyString)) {
    pushIssue(
      issues,
      `${path}.value`,
      "filter mapping must use filter_id.field",
    );
    return;
  }

  const [filterId, fieldName] = segments;
  const filter = filterById.get(filterId);
  if (!filter) {
    pushIssue(
      issues,
      `${path}.value`,
      "filter mapping must reference a declared dashboard filter",
    );
    return;
  }

  const allowedFields =
    filter.kind === "time_range"
      ? new Set(["value", ...filter.resolved_fields])
      : new Set(["value", "label"]);

  if (!allowedFields.has(fieldName)) {
    pushIssue(
      issues,
      `${path}.value`,
      `filter mapping field ${fieldName} is not available on ${filterId}`,
    );
  }
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

function getSelectorFieldName(selector: string | null | undefined) {
  if (!isNonEmptyString(selector)) {
    return null;
  }

  const match = selector.match(/^rows(?:\[\]|\[0\])\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  return match?.[1] ?? null;
}

function validateRendererTransformBindingFields(input: {
  view: DashboardSpec["views"][number] | undefined;
  slot: DashboardRendererSlot | undefined;
  output: QueryOutput | undefined;
  effectiveOutputKind: QueryOutput["kind"] | undefined;
  path: string;
  issues: ValidationIssue[];
}): void {
  if (
    !input.view ||
    !input.slot ||
    input.output?.kind !== "rows" ||
    input.effectiveOutputKind !== "rows"
  ) {
    return;
  }

  const schemaByName = new Map(input.output.schema.map((field) => [field.name, field]));
  getViewTransforms(input.view as unknown as Record<string, unknown>)
    .filter(isPivotRowsTransform)
    .filter((transform) => transform.source_slot === input.slot?.id)
    .forEach((transform) => {
      const validateField = (
        propertyName: "row_key" | "column_key" | "value_field",
        expectedType?: ResultSchemaField["type"],
      ) => {
        const fieldName = transform[propertyName];
        const field = schemaByName.get(fieldName);
        if (!field) {
          pushIssue(
            input.issues,
            `${input.path}.query_id`,
            `renderer transform ${transform.id} references unknown result field ${fieldName}`,
          );
          return;
        }
        if (expectedType && field.type !== expectedType) {
          pushIssue(
            input.issues,
            `${input.path}.query_id`,
            `renderer transform ${transform.id} ${propertyName} must reference a ${expectedType} result field`,
          );
        }
      };

      validateField("row_key");
      validateField("column_key");
      validateField("value_field", "number");
    });
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
  const filterById = new Map(dashboardSpec.filters.map((filter) => [filter.id, filter]));
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
      if (mode === "publish") {
        pushIssue(issues, `${path}.mode`, "mock bindings cannot be published");
      }
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
      } else if (output && output.kind !== "rows") {
        pushIssue(
          issues,
          `${path}.result_selector`,
          "result_selector can only select from rows output",
        );
      } else if (output?.kind === "rows") {
        const selectorField = getSelectorFieldName(binding.result_selector);
        if (
          selectorField &&
          !output.schema.some((field) => field.name === selectorField)
        ) {
          pushIssue(
            issues,
            `${path}.result_selector`,
            `result_selector references unknown result field ${selectorField}`,
          );
        }
      }
    }
    const effectiveOutputKind =
      selectorKind && output?.kind === "rows" ? selectorKind : output?.kind;
    if (slot && output && effectiveOutputKind !== slot.value_kind) {
      pushIssue(
        issues,
        `${path}.query_id`,
        `query output kind ${effectiveOutputKind} is not compatible with slot value_kind ${slot.value_kind}`,
      );
    }
    validateRendererTransformBindingFields({
      view,
      slot,
      output,
      effectiveOutputKind,
      path,
      issues,
    });

    if (!isRecord(binding.param_mapping)) {
      pushIssue(issues, `${path}.param_mapping`, "param_mapping must be an object");
    } else {
      Object.entries(binding.param_mapping).forEach(([paramName, entry]) => {
        const entryPath = `${path}.param_mapping.${paramName}`;
        if (query && !query.params.some((param) => param.name === paramName)) {
          pushIssue(issues, entryPath, "param_mapping key must exist in QueryDef.params");
        }

        if (validateParamMappingEntry(entry, entryPath, issues)) {
          validateParamMappingReference({
            entry,
            path: entryPath,
            filterById,
            issues,
          });
        }
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

  if (input.schema_version !== CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION) {
    pushIssue(
      issues,
      "dashboard_document.schema_version",
      "schema_version must be 1.0",
    );
  }

  if (!specResult.ok || !queryResult.ok || issues.length > specResult.issues.length + queryResult.issues.length) {
    return fail(issues);
  }

  const bindingsResult = validateBindings(input.bindings, specResult.value, queryResult.value, mode);
  issues.push(...bindingsResult.issues);

  if (!bindingsResult.ok) {
    return fail(issues);
  }

  return ok({
    schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
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
