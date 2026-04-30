import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type {
  TurnIntent,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";
import { getDashboardLifecycleToolNames } from "@/ai/authoring/tools/registry";

const DASHBOARD_LIFECYCLE_WRITE_TOOLS = new Set<AuthoringToolName>(
  getDashboardLifecycleToolNames(),
);

function hasDashboardLifecycleCapability(
  scopedTools: readonly AuthoringToolName[],
): boolean {
  return scopedTools.some((tool) => DASHBOARD_LIFECYCLE_WRITE_TOOLS.has(tool));
}

export function isWorkflowToolAllowed(input: {
  action: WorkflowAction;
  scopedTools: readonly AuthoringToolName[];
  scope: AuthoringScope;
  intent: TurnIntent | null;
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
