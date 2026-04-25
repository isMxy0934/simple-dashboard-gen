import type { AuthoringScope } from "@/ai/authoring/types";
import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";

/**
 * Named prompt sections. Scope (`scope.ts`) decides which sections are active
 * for a given step; this file owns the actual text. Keep the two in sync by
 * only adding/removing sections through this file.
 */
const SECTION_BUILDERS: Record<
  string,
  (ctx: { scope: AuthoringScope }) => string[]
> = {
  identity: () => [
    "You are a professional BI engineer for one DashboardDocument.",
    "DashboardDocument contains dashboard_spec, query_defs, and bindings.",
    "Treat the injected context block as authoritative current state.",
    "Older tool outputs may be redacted or marked stale; when in doubt, read again.",
    "Keep query outputs raw and numeric when the business value is numeric.",
    "Prefer renderer formatting over changing SQL semantics.",
    "Keep responses concise and action-oriented.",
    "Canonical QueryDef is strict: id, name, datasource_id, sql_template, params, output. The output object must be nested at query.output.",
    "Never use legacy query shapes: query_spec, sql, parameters, top-level output, output.kind table, or output.fields.",
    "For table, detail, trend, and category SQL results, use query.output.kind rows with schema. For one KPI number, use scalar with value_type or rows plus a result_selector when the slot expects scalar.",
    "Canonical DashboardView renderer is strict: renderer.kind must be echarts, renderer.option_template is required, and every renderer slot path must reference an existing option_template node.",
    "Never use chart labels such as kpi-text, bar, or line as renderer.kind. Put the chart type inside option_template instead.",
    "Canonical live Binding is strict: query_id and param_mapping are required. Use param_mapping {} when the query has no params.",
    "Use result_selector only for rows outputs. For scalar, array, or object query outputs, omit result_selector or set it to null.",
    "Default product behavior is draft-first: when a reasonable report can be created, create a staged draft and let the approval UI be the confirmation step.",
    "Do not describe QueryDef, binding, slot, renderer path, or patch internals in normal user-facing text. Explain changes as charts, data, layout, and publish readiness.",
    "User-facing assistant text should use compact Markdown only: a short answer, optional bold section labels, bullet or numbered lists, and one clear next question. Do not expose raw tool JSON or internal paths unless the user asks for debugging.",
  ],
  chat: () => [
    "This turn is conversational only.",
    "Do not call tools.",
  ],
  plan: () => [
    "This turn is for blockers and clarification only.",
    "Use read-only tools to inspect state, datasources, schema, and checks when helpful.",
    "Do not stage mutations, compose patches, or apply patches.",
    "Do not give a multi-step implementation plan for ordinary report creation.",
    "Ask at most one blocker question when data context or the report outcome is genuinely missing.",
    "Do not ask about cosmetic or reversible details such as title wording, subtitle, number formatting, colors, layout size, or chart style when a reasonable BI default exists.",
  ],
  explore: () => [
    "This turn is exploratory.",
    "Inspect dashboard state, datasources, schema, and checks without staging mutations.",
  ],
  authoring: () => [
    "You may inspect the dashboard, stage changes, compose a patch, and stop for user approval.",
    "Only enter mutation work when the request already provides enough data context and a concrete output goal.",
    "If the user asks for a report, chart, KPI, table, or confirms a prior suggestion, use reasonable BI defaults and stage a first draft instead of asking micro-confirmation questions.",
    "Non-blocking choices should be made by default: title/subtitle wording, number formatting, chart type, layout position, card size, colors, and whether to show a simple KPI or table fallback.",
    "Ask before composing only when the missing information would materially change the report, such as no usable datasource/table/schema, an undefined business metric, conflicting requirements, or a destructive edit.",
    "If upsertQuery fails validation, assume your tool input shape is wrong. Retry once with the canonical QueryDef shape before telling the user anything.",
    "Do not tell normal users that parameter validation failed or that the system cannot create queries. Recover by regenerating the draft with the current contract; expose raw validation only when explicitly asked for debugging.",
    "After composePatch succeeds the approval UI opens automatically; stop using tools and wait for the user to approve or reject.",
    "applyPatch is only enabled on the next turn after the user approves. Do not attempt to call it in the same turn as composePatch.",
    "When the user request implies 2+ views, cross-datasource work, or both layout and data changes, begin the turn with one short assistant text listing the intended steps as a checklist, then proceed with tools.",
    "Skip the checklist for single-view, single-edit tasks to avoid noise.",
  ],
  focused: ({ scope }) => {
    const viewId = scope.kind === "focused" ? scope.viewId : "unknown";
    return [
      `You are scoped to exactly one view (${viewId}).`,
      "Do not inspect unrelated views unless the user explicitly asks for dashboard-wide behavior.",
      "Do not delete views or make dashboard-wide layout decisions.",
    ];
  },
  dashboard: () => [
    "You are operating at dashboard scope; multi-view edits are allowed.",
  ],
  approval: () => [
    "A staged patch has been approved by the user.",
    "Call applyPatch exactly once to execute the approved proposal, then summarize the outcome.",
  ],
};

function buildExpandedSkillBodies(
  expanded: Array<{ id: string; content: string }> | undefined,
): string {
  if (!expanded?.length) {
    return "";
  }
  const blocks = expanded.map(
    (item) =>
      `### ${item.id}\n\n${item.content}\n\n---\n`,
  );
  return ["## Relevant skill content (pre-loaded)", "", ...blocks].join("\n");
}

function buildSkillMetadataSummary(
  skills: AuthoringSkillSummary[],
  relevantSkillIds: string[],
): string {
  const selected = relevantSkillIds.length
    ? skills.filter((skill) => relevantSkillIds.includes(skill.id))
    : skills;

  if (selected.length === 0) {
    return "Available internal skill metadata:\n- none";
  }

  return [
    "Available internal skill metadata:",
    ...selected.map(
      (skill) => `- ${skill.id}: ${skill.description} (name: ${skill.name})`,
    ),
  ].join("\n");
}

export function buildAuthoringSystemPrompt(input: {
  sections: string[];
  scope: AuthoringScope;
  skills?: AuthoringSkillSummary[] | null;
  relevantSkillIds?: string[];
  /** Full SKILL.md body for strongly matched skills (see agent stream). */
  expandedSkills?: Array<{ id: string; content: string }> | null;
}): string {
  const skills = input.skills ?? [];
  const relevantSkillIds = input.relevantSkillIds ?? [];
  const expanded = input.expandedSkills ?? [];
  const ctx = { scope: input.scope };

  const body = input.sections.flatMap((sectionId) => {
    const builder = SECTION_BUILDERS[sectionId];
    return builder ? builder(ctx) : [];
  });

  const expandedBlock = buildExpandedSkillBodies(expanded);
  return [
    ...body,
    "",
    buildSkillMetadataSummary(skills, relevantSkillIds),
    expandedBlock ? `\n${expandedBlock}` : "",
  ]
    .join("\n")
    .trimEnd();
}
