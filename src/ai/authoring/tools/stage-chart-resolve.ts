import { createHash } from "node:crypto";
import type {
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRendererSlot,
  DashboardRendererTransform,
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
  const existingItem = layout?.items.find((item) => item.view_id === input.viewId);
  const nextY = (layout?.items ?? []).reduce(
    (maxY, item) => Math.max(maxY, item.y + item.h),
    0,
  );
  const width = clampInteger(
    input.override?.w ?? existingItem?.w ?? input.defaults.w,
    1,
    cols,
  );
  const x = clampInteger(
    input.override?.x ?? existingItem?.x ?? 0,
    0,
    cols - width,
  );
  const y = Math.max(
    0,
    Math.floor(input.override?.y ?? existingItem?.y ?? nextY),
  );

  return {
    view_id: input.viewId,
    x,
    y,
    w: width,
    h: Math.max(1, Math.floor(input.override?.h ?? existingItem?.h ?? input.defaults.h)),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, next));
}

function pathExists(value: unknown, path: string): boolean {
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

export function assertRendererContract(
  slots: DashboardRendererSlot[],
  optionTemplate: unknown,
  transforms: DashboardRendererTransform[] = [],
) {
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

  const slotIds = new Set(slots.map((slot) => slot.id));
  const transformIds = new Set<string>();
  for (const transform of transforms) {
    const transformRecord = transform as DashboardRendererTransform & Record<string, unknown>;
    const transformKind = transformRecord.kind;
    const transformId = String(transformRecord.id ?? "<unknown>");
    if (transformKind !== "pivot_rows" && transformKind !== "generate_series") {
      throw new Error(
        `Skill builder produced invalid renderer transform "${transformId}": kind must be pivot_rows or generate_series.`,
      );
    }
    if (!pathExists(optionTemplate, transform.target_path)) {
      throw new Error(
        `Skill builder produced invalid renderer transform "${transform.id}": target_path "${transform.target_path}" does not exist in option_template.`,
      );
    }
    if (transform.kind === "pivot_rows" && !slotIds.has(transform.source_slot)) {
      throw new Error(
        `Skill builder produced invalid renderer transform "${transform.id}": source_slot "${transform.source_slot}" does not exist in renderer.slots.`,
      );
    }
    if (transform.kind === "generate_series" && !transformIds.has(transform.source_transform)) {
      throw new Error(
        `Skill builder produced invalid renderer transform "${transform.id}": source_transform "${transform.source_transform}" must reference an earlier transform.`,
      );
    }
    transformIds.add(transform.id);
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
  setField("series", "series_value");
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
  if (input.bindingTemplate.value_kind === "rows") {
    return "rows";
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
    `compiled chart field "${input.field.result_field}" for slot "${input.bindingTemplate.slot_id}" was not found in query.output.schema.`,
  );
}
