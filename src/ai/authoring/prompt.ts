import type { AuthoringScope } from "@/ai/authoring/types";
import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringTaskStateSnapshot } from "@/ai/authoring/contracts/session-state";

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
    "Do not treat advisory or exploration questions as creation requests. If the user asks what data exists, how to analyze something, what to do next, or which report would be useful, answer with options and recommendations without staging mutations.",
    "Create or edit a draft only when the latest user turn clearly requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
    "Ask only blocker questions. Do not ask about reversible defaults that users can adjust after the draft exists.",
    "Keep query outputs raw and numeric when the business value is numeric.",
    "Prefer renderer formatting over changing SQL semantics.",
    "Keep responses concise and action-oriented.",
    "User-facing text should explain business choices, not implementation mechanics.",
    "Do not describe QueryDef, binding, slot, renderer path, tool calls, patch internals, or approval workflow in normal user-facing text.",
    "Use compact Markdown only: a short answer, optional bold section labels, bullets when useful, and at most one clear question.",
    "Tool input contracts live in tool descriptions and schemas. Follow them exactly when calling tools.",
    "You decide whether to inspect data, load skills, or create/edit a draft by calling tools. Tool contracts enforce completeness, safety, schema, and skill contracts.",
  ],
  chat: () => [
    "This turn is conversational only.",
    "Do not call tools.",
  ],
  discover: () => [
    "This turn is for discovery and blockers only.",
    "Use read-only tools to inspect state, datasources, schema, and checks when helpful.",
    "Do not stage mutations, compose patches, or apply patches.",
    "If the user asks for business metrics without confirmed data context, identify likely datasource/table candidates before asking anything else.",
    "Present candidates in business language: what each measures, which requested metrics it supports, why one candidate seems best, and any important limitation.",
    "Do not make the user know table details. Translate schema details into business meaning so the user can judge the metric source.",
    "Ask at most one blocker question, and only when datasource/table, metric meaning, or report outcome is genuinely missing.",
    "Do not ask about time range, grouping, chart type, layout, formatting, colors, or titles unless that choice changes the business meaning or the user explicitly asks to decide it.",
    "Do not give implementation plans, checklists, or first/then/finally sequencing for ordinary report creation.",
    "After the user confirms a specific recommended report or concrete metric view, the next authoring turn should create the draft with defaults instead of continuing to clarify.",
  ],
  explore: () => [
    "This turn is exploratory.",
    "Inspect dashboard state, datasources, schema, and checks without staging mutations.",
  ],
  authoring: () => [
    "You may inspect the dashboard, stage changes, compose a patch, and request local approval when the latest user turn is a creation or edit request.",
    "When creation intent is clear, do the work; do not narrate internal execution.",
    "Mutation work is allowed when the user provides confirmed data context and a concrete output goal.",
    "Confirmed data context means the user named a datasource/table/schema/SQL, selected one of your candidates, or confirmed a prior datasource/table recommendation.",
    "A vague request like 'show recent sales, orders, and AOV' is not confirmed data context. Inspect candidates and ask one datasource/table question before staging changes.",
    "Do not call write tools for advisory-only questions such as '我们该怎么做', '怎么分析', '有哪些数据可以用', '销售数据分析该怎么做', or '你建议怎么做'. Use read-only tools at most, explain the useful options, and ask the user which direction they want to create.",
    "A concrete visualization request such as '我想看最近 GMV 趋势' or an explicit action such as '创建/搭建/生成这个报表' is enough to stage the first draft when data context is confirmed.",
    "If the user only confirms a broad data direction such as '销售规模' or '销售质量', explain the likely report options and wait for a concrete output choice before staging mutations.",
    "For report creation, load one relevant ECharts skill reference for the view type and one relevant data-format skill reference for the data shape before calling write tools.",
    "Pass the exact loaded skill reference key (for example echarts-skills/line-timeseries or data-format-skills/time-series) in write tool skill_reference fields.",
    "If no ECharts skill reference supports the requested chart type, explain that this chart type is not currently supported instead of creating a freeform chart.",
    "Use skill references for reusable renderer, layout, output, formatting, and binding defaults. Do not encode business-specific report templates in the main prompt.",
    "Before mutations, user-facing text is optional. If needed, use one short sentence naming the confirmed datasource/table and why it fits the concrete output goal.",
    "Ask before composing only for true blockers: no usable datasource/table/schema, undefined business metric, conflicting requirements, or destructive overwrite/delete.",
    "Never ask micro-confirmation questions for reversible choices: title/subtitle wording, number formatting, chart type, layout position, card size, colors, ordering, or simple KPI/table fallback.",
    "Layout and formatting are defaults, not blockers. Use loaded skill-reference defaults or a sensible BI default; users can drag, resize, or edit afterward.",
    "If any write tool fails validation (upsertQuery, upsertView, or upsertBinding), assume your tool input shape is wrong. Read the error, retry once with the canonical shape in the same turn, and do not switch back to clarification unless a real blocker remains.",
    "Do not compose a patch for a staged data-backed view until the query, view, and every required binding are staged. If you have staged only query + view, call upsertBinding next.",
    "If task state says the last write tool failed, repair that tool input first using the tool description and schema. Do not change the user-facing goal.",
    "After a write-tool validation error, do not load unrelated or guessed skill references. Recover from the visible validation error and the canonical contracts already in the prompt.",
    "Do not tell normal users that parameter validation failed or that the system cannot create queries. Recover by regenerating the draft with the current contract; expose raw validation only when explicitly asked for debugging.",
    "When the draft is complete and composePatch succeeds, call applyPatch with the composed suggestion_id to open the approval UI. This requests approval only; it will not apply until the user approves.",
    "Once applyPatch is awaiting approval, stop using tools and wait for the user to approve or reject.",
    "Do not emit multi-step implementation plans, checklists, or internal sequencing such as first/then/finally for ordinary report creation.",
    "Do not tell users you will confirm view structure, then add queries, then bind views, then request approval. Those are internal mechanics.",
    "Do not ask to confirm the view structure unless the user explicitly asks to design structure first.",
    "Use at most one chart skill reference per chart family in a turn. Do not repeatedly load skill references when the canonical contracts in this prompt are enough.",
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
    "A staged patch is ready for applyPatch.",
    "If no approval has been recorded yet, call applyPatch exactly once to request user approval and then wait.",
    "If the user has already approved, call applyPatch exactly once to execute the approved proposal, then summarize the outcome.",
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

function buildTaskStateSummary(
  taskState: AuthoringTaskStateSnapshot | null | undefined,
): string {
  if (!taskState) {
    return "";
  }

  const lines = [
    "Current task state:",
    `- phase: ${taskState.phase}`,
    taskState.goalSummary ? `- goal: ${taskState.goalSummary}` : null,
    taskState.selectedDataContext
      ? `- selected data: ${[
          taskState.selectedDataContext.datasourceId,
          taskState.selectedDataContext.tableName,
        ]
          .filter(Boolean)
          .join(" / ")}`
      : null,
    taskState.loadedSkillReferences.length
      ? `- loaded skill refs: ${taskState.loadedSkillReferences.join(", ")}`
      : null,
    taskState.lastFailedTool
      ? [
          `- last failed write tool: ${taskState.lastFailedTool.toolName}`,
          `attempts: ${taskState.lastFailedTool.attemptCount}`,
          taskState.lastFailedTool.code
            ? `code: ${taskState.lastFailedTool.code}`
            : null,
          taskState.lastFailedTool.retryable === false
            ? "do not retry the same write"
            : "repair once before changing strategy",
          taskState.lastFailedTool.recoveryHint
            ? `recovery: ${taskState.lastFailedTool.recoveryHint}`
            : "recover with the canonical tool contract before changing strategy",
        ]
          .filter((part): part is string => Boolean(part))
          .join("; ")
      : null,
    taskState.lastBlockerQuestion
      ? `- last blocker asked: ${taskState.lastBlockerQuestion}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function buildAuthoringSystemPrompt(input: {
  sections: string[];
  scope: AuthoringScope;
  skills?: AuthoringSkillSummary[] | null;
  relevantSkillIds?: string[];
  taskState?: AuthoringTaskStateSnapshot | null;
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
  const taskStateBlock = buildTaskStateSummary(input.taskState);
  return [
    ...body,
    "",
    ...(taskStateBlock ? [taskStateBlock, ""] : []),
    buildSkillMetadataSummary(skills, relevantSkillIds),
    expandedBlock ? `\n${expandedBlock}` : "",
  ]
    .join("\n")
    .trimEnd();
}
