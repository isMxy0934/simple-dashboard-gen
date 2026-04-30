import type {
  ToolStepV2,
  WorkflowActionV2,
} from "@/ai/authoring/v2/types";

export function prepareToolStepV2(action: WorkflowActionV2): ToolStepV2 {
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
