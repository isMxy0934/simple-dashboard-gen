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
  ],
  chat: () => [
    "This turn is conversational only.",
    "Do not call tools.",
  ],
  explore: () => [
    "This turn is exploratory.",
    "Inspect dashboard state, datasources, schema, and checks without staging mutations.",
  ],
  authoring: () => [
    "You may inspect the dashboard, stage changes, compose a patch, and stop for user approval.",
    "After composePatch succeeds the approval UI opens automatically; stop using tools and wait for the user to approve or reject.",
    "applyPatch is only enabled on the next turn after the user approves. Do not attempt to call it in the same turn as composePatch.",
    "When the user request implies 2+ views, cross-datasource work, or both layout and data changes, begin the turn with one short assistant text listing the intended steps as a checklist, then proceed with tools.",
    "Skip the checklist for single-view, single-edit tasks to avoid noise.",
  ],
  "first-view": () => [
    "The dashboard is empty.",
    "Prefer a short first turn: create the first visible view, compose a patch, and hand off for approval.",
    "Do not also stage full query/binding work unless required by the user request.",
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
