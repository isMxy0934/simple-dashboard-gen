import type {
  AuthoringScopeCapabilities,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";
import {
  buildChatToolSurface,
  buildInspectToolSurface,
  buildWorkflowToolSurface,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";
import {
  getActiveGoal,
  prepareToolStep,
} from "@/ai/authoring/workflow/index";
import type {
  AuthoringWorkflowState,
  ToolStep,
  TurnIntent,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";

export function workflowIntentForCurrentTurn(input: {
  explicitWorkflowIntent: TurnIntent | null;
  workflowState: AuthoringWorkflowState;
}): TurnIntent | null {
  if (input.explicitWorkflowIntent) {
    return input.explicitWorkflowIntent;
  }
  return getActiveGoal(input.workflowState) ? { kind: "continue_workflow" } : null;
}

export function isStateChangingTerminalAction(action: WorkflowAction): boolean {
  return (
    action.kind === "complete_goal" ||
    action.kind === "ask_user" ||
    action.kind === "block_goal" ||
    action.kind === "reject_patch"
  );
}

export function workflowActionTool(action: WorkflowAction | null): AuthoringToolName | null {
  return action && "tool" in action ? action.tool : null;
}

export function forcedToolRetryText(step: ToolStep): string {
  const toolName =
    step.toolChoice !== "auto" && step.toolChoice !== "none"
      ? step.toolChoice.toolName
      : step.activeTools[0];
  return [
    "Runtime instruction: the workflow selected one required tool for this step.",
    `Call ${toolName} now using the current context and active goal facts.`,
    "Do not answer conversationally unless the tool call fails validation.",
  ].join("\n");
}

export function buildNoWorkflowSurface(
  capabilities: AuthoringScopeCapabilities,
): RuntimeToolSurface {
  if (capabilities.allowedTools.length === 0) {
    return buildChatToolSurface({
      scope: capabilities.scope,
      reason: capabilities.scopeResolution.requires_scope_clarification
        ? "scope_blocked"
        : "chat_only",
    });
  }
  return buildInspectToolSurface({
    scope: capabilities.scope,
    profile: capabilities.profile,
  });
}

export function buildRuntimeSurfaceForCurrentState(input: {
  capabilities: AuthoringScopeCapabilities;
  decideAction: () => WorkflowAction | null;
  applyStateChangingAction: (action: WorkflowAction) => void;
}): RuntimeToolSurface {
  let action = input.decideAction();
  if (!action) {
    return buildNoWorkflowSurface(input.capabilities);
  }

  for (let guard = 0; guard < 8; guard += 1) {
    if (action.kind === "complete_goal") {
      input.applyStateChangingAction(action);
      action = input.decideAction();
      if (!action) {
        return buildNoWorkflowSurface(input.capabilities);
      }
      continue;
    }

    if (isStateChangingTerminalAction(action)) {
      input.applyStateChangingAction(action);
    }
    return buildWorkflowToolSurface({
      action,
      step: prepareToolStep(action),
      scope: input.capabilities.scope,
    });
  }

  const blockAction: WorkflowAction = {
    kind: "block_goal",
    blocker: "workflow_loop",
    reason: "Workflow runtime could not settle the next action.",
  };
  return buildWorkflowToolSurface({
    action: blockAction,
    step: prepareToolStep(blockAction),
    scope: input.capabilities.scope,
  });
}
