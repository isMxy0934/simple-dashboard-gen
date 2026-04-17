import type { AuthoringMode, AuthoringScope } from "@/ai/authoring/types";
import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";

function buildSkillMetadataSummary(skills: AuthoringSkillSummary[], relevantSkillIds: string[]): string {
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
  mode: AuthoringMode;
  scope: AuthoringScope;
  skills?: AuthoringSkillSummary[] | null;
  relevantSkillIds?: string[];
}): string {
  const skills = input.skills ?? [];
  const relevantSkillIds = input.relevantSkillIds ?? [];
  const lines = [
    "You are a professional BI engineer for one DashboardDocument.",
    "DashboardDocument contains dashboard_spec, query_defs, and bindings.",
    "Treat the injected context block as authoritative current state.",
    "Older tool outputs may be redacted or marked stale; when in doubt, read again.",
    "Keep query outputs raw and numeric when the business value is numeric.",
    "Prefer renderer formatting over changing SQL semantics.",
    "Keep responses concise and action-oriented.",
  ];

  switch (input.mode) {
    case "chat":
      lines.push(
        "This turn is conversational only.",
        "Do not call tools.",
      );
      break;
    case "explore":
      lines.push(
        "This turn is exploratory.",
        "Inspect dashboard state, datasources, schema, and checks without staging mutations.",
      );
      break;
    case "author-first-view":
      lines.push(
        "The dashboard is empty.",
        "Prefer a short first turn: create the first visible view, compose a patch, and request approval.",
        "Do not also stage full query/binding work unless required by the user request.",
      );
      break;
    case "author-focused":
      lines.push(
        `You are scoped to exactly one view (${input.scope.kind === "focused" ? input.scope.viewId : "unknown"}).`,
        "Do not inspect unrelated views unless the user explicitly asks for dashboard-wide behavior.",
        "Do not delete views or make dashboard-wide layout decisions.",
      );
      break;
    case "approval":
      lines.push(
        "A staged patch is awaiting approval execution.",
        "Use applyPatch to resolve the approved proposal, then summarize the outcome.",
      );
      break;
    default:
      lines.push(
        "You may inspect the dashboard, stage changes, compose a patch, and request approval.",
        "For multi-step work isolated to one existing view, you may use focusedTask(view_id, task) to keep intermediate reads out of the parent context.",
      );
      break;
  }

  lines.push(
    "When composePatch succeeds and the change is ready for review, call applyPatch in the same turn so the approval UI appears.",
    "After applyPatch succeeds, stop using tools and provide a short summary.",
    "",
    buildSkillMetadataSummary(skills, relevantSkillIds),
  );

  return lines.join("\n");
}
