import type {
  ToolStep,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";

export function prepareToolStep(action: WorkflowAction): ToolStep {
  if (
    action.kind === "answer" ||
    action.kind === "complete_goal" ||
    action.kind === "ask_user" ||
    action.kind === "block_goal" ||
    action.kind === "reject_patch" ||
    action.kind === "await_approval"
  ) {
    return { mode: "terminal", activeTools: [], toolChoice: "none" };
  }
  return {
    mode: "forced",
    activeTools: [action.tool],
    toolChoice: { type: "tool", toolName: action.tool },
  };
}
