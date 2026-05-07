import { createHash } from "node:crypto";
import type {
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRendererSlot,
  DatasourceField,
  DatasourceTable,
  QueryDef,
} from "@/contracts";
import type {
  StageChartFieldInput,
  StageChartFieldRole,
  StageChartToolInput,
} from "@/ai/authoring/contracts/tool-io";
import type { StageChartSlotBindingTemplate } from "@/ai/authoring/skills/contract";
import {
  buildMissingFieldMessage,
  findDatasourceField,
  shortName,
  standardQueryType,
} from "@/ai/authoring/tools/datasource-schema-utils";

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return ascii || "chart";
}

export function buildStableStem(input: StageChartToolInput): string {
  const seed = [
    input.goal_id,
    input.skill_id,
    input.title,
    input.datasource_id,
    input.table,
    JSON.stringify(input.fields),
    input.time_grain,
    JSON.stringify(input.sort),
    JSON.stringify(input.filters),
    input.target_view_id,
  ]
    .filter(Boolean)
    .join("|");
  return `${slugify(input.title)}_${stableHash(seed)}`;
}

export function cloneDocument(document: DashboardDocument): DashboardDocument {
  return JSON.parse(JSON.stringify(document)) as DashboardDocument;
}

export function buildLayoutItem(input: {
  document: DashboardDocument;
  breakpoint: "desktop" | "mobile";
  viewId: string;
  defaults: Pick<DashboardLayoutItem, "w" | "h">;
  override?: Partial<DashboardLayoutItem>;
}): DashboardLayoutItem {
  const layout = input.document.dashboard_spec.layout[input.breakpoint];
  const cols = layout?.cols ?? (input.breakpoint === "mobile" ? 4 : 12);
  const nextY = (layout?.items ?? []).reduce(
    (maxY, item) => Math.max(maxY, item.y + item.h),
    0,
  );
  return {
    view_id: input.viewId,
    x: input.override?.x ?? 0,
    y: input.override?.y ?? nextY,
    w: input.override?.w ?? Math.min(input.defaults.w, cols),
    h: input.override?.h ?? input.defaults.h,
  };
}

export function pathExists(value: unknown, path: string): boolean {
  const parts = path.match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let current = value;
  for (const rawPart of parts) {
    const indexMatch = rawPart.match(/^\[(\d+)\]$/);
    const key: string | number = indexMatch ? Number(indexMatch[1]) : rawPart;
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) {
        return false;
      }
      current = current[key];
      continue;
    }
    if (typeof current !== "object" || current === null || !(key in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

export function assertRendererContract(slots: DashboardRendererSlot[], optionTemplate: unknown) {
  if (typeof optionTemplate !== "object" || optionTemplate === null || Array.isArray(optionTemplate)) {
    throw new Error("Skill builder produced invalid renderer: option_template must be a non-null object.");
  }
  if (slots.length === 0) {
    throw new Error("Skill builder produced invalid renderer: slots must be non-empty.");
  }
  for (const slot of slots) {
    if (!pathExists(optionTemplate, slot.path)) {
      throw new Error(
        `Skill builder produced invalid renderer slot "${slot.id}": path "${slot.path}" does not exist in option_template.`,
      );
    }
  }
}

export type ResolvedStageChartField = StageChartFieldInput & {
  result_field: string;
  source_field: string;
  source: DatasourceField;
};

export type ResolvedStageChartFields = Partial<
  Record<StageChartFieldRole, ResolvedStageChartField>
>;

export function resolveField(
  fields: ResolvedStageChartFields,
  role: StageChartFieldRole,
): ResolvedStageChartField | null {
  const direct = fields[role];
  if (direct) {
    return direct;
  }
  if (role === "metric") {
    return fields.value ?? null;
  }
  if (role === "value") {
    return fields.metric ?? null;
  }
  return null;
}

export function requiredRole(input: {
  fields: ResolvedStageChartFields;
  role: StageChartFieldRole;
  label: string;
}): ResolvedStageChartField {
  const field = resolveField(input.fields, input.role);
  if (!field) {
    throw new Error(`stageChart requires fields.${input.label}.source_field.`);
  }
  return field;
}

export function defaultAggregation(field: DatasourceField): string {
  if (field.aggregations?.includes("avg")) {
    return field.name.toLowerCase().includes("rate") ? "avg" : field.aggregations[0] ?? "sum";
  }
  return field.aggregations?.[0] ?? "sum";
}

export function normalizeAggregation(field: DatasourceField, requested?: string): string {
  const aggregation = (requested ?? defaultAggregation(field)).toLowerCase();
  if (!["sum", "avg", "count", "min", "max"].includes(aggregation)) {
    throw new Error(`Unsupported aggregation "${aggregation}". Use sum, avg, count, min, or max.`);
  }
  if (aggregation !== "count" && field.type !== "number") {
    throw new Error(`Aggregation "${aggregation}" requires a numeric field; "${shortName(field.name)}" is ${field.type}.`);
  }
  return aggregation;
}

export function resolveSourceFields(input: {
  table: DatasourceTable;
  fields: StageChartToolInput["fields"];
}): ResolvedStageChartFields {
  const out: ResolvedStageChartFields = {};
  const setField = (role: StageChartFieldRole, alias: string) => {
    const fieldInput = input.fields[role];
    if (!fieldInput) {
      return;
    }
    const source = findDatasourceField(input.table, fieldInput.source_field);
    if (!source) {
      throw new Error(buildMissingFieldMessage(input.table, fieldInput.source_field));
    }
    out[role] = {
      ...fieldInput,
      source_field: source.name,
      result_field: alias,
      type: fieldInput.type ?? standardQueryType(source),
      aggregation: fieldInput.aggregation,
      source,
    };
  };
  setField("time", "time_value");
  setField("category", "category_name");
  setField("metric", "metric_value");
  setField("value", "metric_value");
  if (!out.value && out.metric) {
    out.value = { ...out.metric };
  }
  if (!out.metric && out.value) {
    out.metric = { ...out.value };
  }
  return out;
}

export function buildResultSelector(input: {
  query: QueryDef;
  bindingTemplate: StageChartSlotBindingTemplate;
  field: ResolvedStageChartField;
}): string | null {
  if (input.query.output.kind !== "rows") {
    return null;
  }
  if (input.bindingTemplate.value_kind === "array") {
    return `rows[].${input.field.result_field}`;
  }
  return `rows[0].${input.field.result_field}`;
}

export function assertFieldExistsInQueryOutput(input: {
  query: QueryDef | null;
  bindingTemplate: StageChartSlotBindingTemplate;
  field: ResolvedStageChartField;
}) {
  const output = input.query?.output;
  if (!output || (output.kind !== "rows" && output.kind !== "object")) {
    return;
  }
  if (output.schema.some((f) => f.name === input.field.result_field)) {
    return;
  }
  throw new Error(
    `stageChart field "${input.field.result_field}" for slot "${input.bindingTemplate.slot_id}" was not found in query.output.schema.`,
  );
}
