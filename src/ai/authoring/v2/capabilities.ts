import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/types";
import type {
  TurnIntentV2,
  WorkflowActionV2,
} from "@/ai/authoring/v2/types";

const DASHBOARD_LIFECYCLE_WRITE_TOOLS = new Set<AuthoringToolName>([
  "upsertQuery",
  "upsertView",
  "upsertBinding",
  "upsertLayout",
]);

function hasDashboardLifecycleCapability(
  scopedTools: readonly AuthoringToolName[],
): boolean {
  return scopedTools.some((tool) => DASHBOARD_LIFECYCLE_WRITE_TOOLS.has(tool));
}

export function isWorkflowToolAllowedV2(input: {
  action: WorkflowActionV2;
  scopedTools: readonly AuthoringToolName[];
  scope: AuthoringScope;
  intent: TurnIntentV2 | null;
}): boolean {
  if (!("tool" in input.action)) {
    return true;
  }

  if (input.scopedTools.includes(input.action.tool)) {
    return true;
  }

  if (input.action.kind === "compose_patch") {
    return (
      input.scope.kind === "dashboard" &&
      hasDashboardLifecycleCapability(input.scopedTools)
    );
  }

  if (input.action.kind === "apply_patch") {
    return (
      input.scope.kind !== "empty" &&
      input.intent?.kind === "approve_patch_event"
    );
  }

  return false;
}
