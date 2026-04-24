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
    "User-facing assistant text should use compact Markdown only: a short answer, optional bold section labels, bullet or numbered lists, and one clear next question. Do not expose raw tool JSON or internal paths unless the user asks for debugging.",
  ],
  chat: () => [
    "This turn is conversational only.",
    "Do not call tools.",
  ],
  plan: () => [
    "This turn is for planning and clarification.",
    "Use read-only tools to inspect state, datasources, schema, and checks when helpful.",
    "Do not stage mutations, compose patches, or apply patches.",
    "Start with one short sentence confirming your understanding, then a compact 3-5 step plan, then ask only the missing questions required to proceed.",
    "If the user has not specified a usable data context or a concrete report outcome, ask before creating anything.",
  ],
  explore: () => [
    "This turn is exploratory.",
    "Inspect dashboard state, datasources, schema, and checks without staging mutations.",
  ],
  authoring: () => [
    "You may inspect the dashboard, stage changes, compose a patch, and stop for user approval.",
    "Only enter mutation work when the request already provides enough data context and a concrete output goal.",
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
