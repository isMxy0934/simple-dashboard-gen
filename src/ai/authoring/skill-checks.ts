import { z } from "zod";
import type {
  Binding,
  DashboardRendererSlot,
  DashboardView,
  QueryDef,
  QueryOutputKind,
  ResultSchemaField,
} from "@/contracts";

const FIELD_ROLE_VALUES = [
  "time",
  "metric",
  "category",
  "series",
  "detail",
] as const;

const queryParamTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
]);

const slotRoleSchema = z.enum(["time", "value", "category", "label"]);

const skillCheckBaseSchema = z.object({
  unsupported_message: z.string().optional(),
});

const echartsSkillCheckSchema = skillCheckBaseSchema.extend({
  kind: z.literal("echarts-view"),
  supported_view_type: z.string().min(1),
  required_renderer_kind: z.literal("echarts"),
  paired_data_formats: z.array(z.string().min(1)).default([]),
  series_type: z.string().min(1).optional(),
  option_keys: z.array(z.string().min(1)).default([]),
  requires_bounded_semantics: z.boolean().optional(),
  required_slots: z.array(z.object({
    role: slotRoleSchema,
    value_kind: z.enum(["rows", "array", "object", "scalar"]),
    path_includes: z.string().min(1).optional(),
  })).min(1),
  default_layout: z.object({
    desktop: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }).optional(),
    mobile: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }).optional(),
  }).optional(),
});

const dataFormatSkillCheckSchema = skillCheckBaseSchema.extend({
  kind: z.literal("data-format"),
  data_shape: z.string().min(1),
  view_support: z.enum(["supported", "data-only"]).default("supported"),
  query_output: z.object({
    kind: z.enum(["rows", "array", "object", "scalar"]),
    value_types: z.array(queryParamTypeSchema).optional(),
    required_fields: z.array(z.object({
      role: z.enum(FIELD_ROLE_VALUES),
      types: z.array(queryParamTypeSchema).min(1),
    })).default([]),
  }),
});

const skillCheckSchema = z.union([
  echartsSkillCheckSchema,
  dataFormatSkillCheckSchema,
]);

export type AuthoringSkillReferenceCheck = z.infer<typeof skillCheckSchema> & {
  skill_id: string;
  reference_name: string;
  reference_key: string;
};

type EChartsSkillReferenceCheck = Extract<
  AuthoringSkillReferenceCheck,
  { kind: "echarts-view" }
>;

type DataFormatSkillReferenceCheck = Extract<
  AuthoringSkillReferenceCheck,
  { kind: "data-format" }
>;

const SKILL_CHECK_FENCE_RE =
  /```json\s+skill-check\s*\r?\n([\s\S]*?)\r?\n```/i;

export function buildSkillReferenceKey(skillId: string, referenceName: string) {
  return `${skillId.trim()}/${referenceName.trim().replace(/\.md$/i, "")}`;
}

export function parseAuthoringSkillReferenceCheck(input: {
  skillId: string;
  referenceName: string;
  content: string;
}): AuthoringSkillReferenceCheck | null {
  const match = input.content.match(SKILL_CHECK_FENCE_RE);
  if (!match) {
    return null;
  }

  const parsed = skillCheckSchema.parse(JSON.parse(match[1]));
  const referenceName = input.referenceName.trim().replace(/\.md$/i, "");
  return {
    ...parsed,
    skill_id: input.skillId,
    reference_name: referenceName,
    reference_key: buildSkillReferenceKey(input.skillId, referenceName),
  };
}

export function sanitizeAuthoringSkillReferenceCheck(
  value: unknown,
): AuthoringSkillReferenceCheck | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.skill_id !== "string" ||
    typeof record.reference_name !== "string" ||
    typeof record.reference_key !== "string"
  ) {
    return null;
  }
  const parsed = skillCheckSchema.safeParse(record);
  if (!parsed.success) {
    return null;
  }
  return {
    ...parsed.data,
    skill_id: record.skill_id,
    reference_name: record.reference_name,
    reference_key: record.reference_key,
  };
}

export function isEChartsSkillCheck(
  check: AuthoringSkillReferenceCheck,
): check is EChartsSkillReferenceCheck {
  return check.kind === "echarts-view";
}

export function isDataFormatSkillCheck(
  check: AuthoringSkillReferenceCheck,
): check is DataFormatSkillReferenceCheck {
  return check.kind === "data-format";
}

export function resolveSkillCheck(input: {
  checks: AuthoringSkillReferenceCheck[];
  kind: AuthoringSkillReferenceCheck["kind"];
  requestedKey?: string | null;
}): AuthoringSkillReferenceCheck | null {
  const candidates = input.checks.filter((check) => check.kind === input.kind);
  const requestedKey = input.requestedKey?.trim();
  if (requestedKey) {
    return candidates.find((check) => check.reference_key === requestedKey) ?? null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function getSeriesTypes(view: DashboardView): string[] {
  const series = view.renderer.option_template.series;
  if (!Array.isArray(series)) {
    return [];
  }
  return series
    .map((entry) =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? String((entry as { type?: unknown }).type ?? "")
        : "",
    )
    .filter(Boolean);
}

function findSlotForRequirement(
  slots: DashboardRendererSlot[],
  requirement: EChartsSkillReferenceCheck["required_slots"][number],
) {
  return slots.find((slot) => {
    if (slot.value_kind !== requirement.value_kind) {
      return false;
    }
    if (
      requirement.path_includes &&
      !slot.path.toLowerCase().includes(requirement.path_includes.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

export function validateViewAgainstSkillCheck(input: {
  view: DashboardView;
  check: EChartsSkillReferenceCheck;
}): string[] {
  const issues: string[] = [];
  if (input.view.renderer.kind !== input.check.required_renderer_kind) {
    issues.push(`renderer.kind must be ${input.check.required_renderer_kind}.`);
  }

  for (const key of input.check.option_keys) {
    if (input.view.renderer.option_template[key] === undefined) {
      issues.push(`option_template must include ${key}.`);
    }
  }

  if (input.check.series_type) {
    const seriesTypes = getSeriesTypes(input.view);
    if (!seriesTypes.includes(input.check.series_type)) {
      issues.push(`ECharts series.type must include ${input.check.series_type}.`);
    }
  }

  for (const requirement of input.check.required_slots) {
    if (!findSlotForRequirement(input.view.renderer.slots, requirement)) {
      issues.push(
        `renderer.slots must include a ${requirement.role} slot with value_kind=${requirement.value_kind}` +
          (requirement.path_includes
            ? ` and path containing "${requirement.path_includes}"`
            : "") +
          ".",
      );
    }
  }

  return issues;
}

function fieldMatchesRole(
  field: ResultSchemaField,
  role: DataFormatSkillReferenceCheck["query_output"]["required_fields"][number],
) {
  return role.types.includes(field.type);
}

export function findQueryFieldForRole(
  query: QueryDef,
  check: DataFormatSkillReferenceCheck,
  roleName: (typeof FIELD_ROLE_VALUES)[number],
): ResultSchemaField | null {
  if (query.output.kind !== "rows") {
    return null;
  }
  const requirement = check.query_output.required_fields.find(
    (field) => field.role === roleName,
  );
  if (!requirement) {
    return null;
  }
  return query.output.schema.find((field) => fieldMatchesRole(field, requirement)) ?? null;
}

export function validateQueryAgainstSkillCheck(input: {
  query: QueryDef;
  check: DataFormatSkillReferenceCheck;
}): string[] {
  const issues: string[] = [];
  const expected = input.check.query_output;
  if (input.query.output.kind !== expected.kind) {
    issues.push(`query.output.kind must be ${expected.kind} for ${input.check.reference_key}.`);
    return issues;
  }

  if (
    expected.kind === "scalar" &&
    input.query.output.kind === "scalar" &&
    expected.value_types?.length &&
    !expected.value_types.includes(input.query.output.value_type)
  ) {
    issues.push(
      `scalar value_type must be one of ${expected.value_types.join(", ")}.`,
    );
  }

  if (expected.kind === "rows" && input.query.output.kind === "rows") {
    for (const requirement of expected.required_fields) {
      if (!input.query.output.schema.some((field) => fieldMatchesRole(field, requirement))) {
        issues.push(
          `rows output must include a ${requirement.role} field with type ${requirement.types.join(" or ")}.`,
        );
      }
    }
  }

  return issues;
}

function selectorField(selector: string | null | undefined) {
  return selector?.match(/^rows(?:\[\]|\[0\])\.([a-zA-Z_][a-zA-Z0-9_]*)$/)?.[1] ?? null;
}

function selectorKind(selector: string | null | undefined): QueryOutputKind | null {
  if (!selector) {
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

function effectiveBindingKind(binding: Binding, query: QueryDef): QueryOutputKind {
  const selectedKind = selectorKind(binding.result_selector);
  return selectedKind && query.output.kind === "rows" ? selectedKind : query.output.kind;
}

function expectedRoleForSlot(
  slot: DashboardRendererSlot | undefined,
  check: DataFormatSkillReferenceCheck,
): (typeof FIELD_ROLE_VALUES)[number] | null {
  const path = slot?.path.toLowerCase() ?? "";
  if (path.includes("xaxis") || path.includes("category")) {
    return check.data_shape === "category-series" ? "category" : "time";
  }
  if (path.includes("series")) {
    return "metric";
  }
  if (path.includes("graphic")) {
    return "metric";
  }
  return null;
}

export function validateBindingAgainstSkillCheck(input: {
  binding: Binding;
  view: DashboardView;
  query: QueryDef;
  check: DataFormatSkillReferenceCheck;
}): string[] {
  const issues: string[] = [];
  const slot = input.view.renderer.slots.find(
    (candidate) => candidate.id === input.binding.slot_id,
  );
  if (!slot) {
    return [`slot_id ${input.binding.slot_id} must reference an existing renderer slot.`];
  }

  const effectiveKind = effectiveBindingKind(input.binding, input.query);
  if (effectiveKind !== slot.value_kind) {
    issues.push(
      `binding selector produces ${effectiveKind}, but slot ${slot.id} requires ${slot.value_kind}.`,
    );
  }

  if (input.check.query_output.kind === "scalar") {
    if (input.query.output.kind !== "scalar") {
      issues.push("scalar data-format bindings must use a scalar query output.");
    }
    if (input.binding.result_selector) {
      issues.push("scalar query bindings must not use result_selector.");
    }
    return issues;
  }

  if (input.check.query_output.kind !== "rows" || input.query.output.kind !== "rows") {
    return issues;
  }

  if (slot.value_kind === "array" && !/^rows\[\]\./.test(input.binding.result_selector ?? "")) {
    issues.push(`array slot ${slot.id} must bind with rows[].field.`);
  }

  const role = expectedRoleForSlot(slot, input.check);
  if (role) {
    const field = input.query.output.schema.find(
      (candidate) => candidate.name === selectorField(input.binding.result_selector),
    );
    const roleRequirement = input.check.query_output.required_fields.find(
      (candidate) => candidate.role === role,
    );
    if (roleRequirement && field && !roleRequirement.types.includes(field.type)) {
      issues.push(
        `slot ${slot.id} expects a ${role} field, but ${field.name} is ${field.type}.`,
      );
    }
  }

  return issues;
}
