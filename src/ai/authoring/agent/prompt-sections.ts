import type { AuthoringCapabilityProfile } from "@/ai/authoring/contracts/runtime";
import type {
  TurnIntentV2,
  WorkflowActionV2,
} from "@/ai/authoring/v2/types";

export function defaultPromptSectionsForCapabilityProfile(
  profile: AuthoringCapabilityProfile,
): string[] {
  switch (profile) {
    case "chat":
      return ["identity", "chat"];
    case "explore":
      return ["identity", "explore"];
    case "author-focused":
      return ["identity", "authoring", "focused"];
    case "approval":
      return ["identity", "approval"];
    default:
      return ["identity", "authoring", "dashboard"];
  }
}

export function promptSectionsForWorkflowAction(input: {
  action: WorkflowActionV2 | null;
  intent: TurnIntentV2 | null;
  defaultSections: string[];
}): string[] {
  const scopeSections = input.defaultSections.filter(
    (section) => section === "focused" || section === "dashboard",
  );
  if (
    input.action?.kind === "await_approval"
  ) {
    return ["identity", "approval"];
  }
  if (
    input.action?.kind === "answer" ||
    input.action?.kind === "complete_goal" ||
    input.action?.kind === "ask_user" ||
    input.action?.kind === "block_goal" ||
    input.action?.kind === "reject_patch"
  ) {
    return ["identity", "workflow_response"];
  }
  if (input.action?.kind === "stage_query") {
    return ["identity", "stage_query", ...scopeSections];
  }
  if (input.action?.kind === "prepare_view_context") {
    return ["identity", "load_chart_skill", ...scopeSections];
  }
  if (input.action?.kind === "stage_view") {
    return ["identity", "stage_view", ...scopeSections];
  }
  if (input.action?.kind === "stage_binding") {
    return ["identity", "stage_binding", ...scopeSections];
  }
  if (input.action?.kind === "stage_layout") {
    return ["identity", "stage_layout", ...scopeSections];
  }
  if (input.action?.kind === "compose_patch") {
    return ["identity", "compose_patch", ...scopeSections];
  }
  return input.defaultSections;
}
