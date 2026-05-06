import type {
  DeclareAuthoringGoalToolInput,
  DraftStatusToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import {
  getActiveGoal,
} from "@/ai/authoring/workflow";
import type {
  ArtifactStatus,
  TurnIntent,
  WorkflowToolExecution,
} from "@/ai/authoring/workflow/types";

export function buildRuntimeCheckStatus(input: {
  draftStatus: DraftStatusToolOutput;
  goal: ReturnType<typeof getActiveGoal>;
}): ArtifactStatus["runtimeCheck"] | undefined {
  if (input.draftStatus.check_fresh) {
    return { required: true, status: "passed", errors: [] };
  }
  if (input.draftStatus.blockers.includes("stale_check")) {
    return {
      required: true,
      status: input.draftStatus.last_check_hash ? "stale" : "not_run",
      errors: [],
    };
  }
  return undefined;
}

export function explicitEventIntent(
  approvalEvent?: {
    proposalId: string;
    decision: "approve" | "reject";
    baseVersion: number;
  } | null,
): TurnIntent | null {
  return approvalEvent
    ? {
        kind: "approve_patch_event",
        proposalId: approvalEvent.proposalId,
        decision: approvalEvent.decision,
        baseVersion: approvalEvent.baseVersion,
      }
    : null;
}

export function declarationToTurnIntent(
  declaration: DeclareAuthoringGoalToolInput,
): TurnIntent {
  if (declaration.kind === "set_data_mode") {
    return { kind: "set_data_mode", dataMode: declaration.dataMode };
  }
  if (declaration.kind === "create_dashboard") {
    return { kind: "create_dashboard", goal: declaration.goal };
  }
  return { kind: declaration.kind, goal: declaration.goal };
}

function toolResultErrorText(content: Array<{ type: string; text?: string }> | undefined) {
  return (
    content
      ?.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n") || "Tool execution failed."
  );
}

export function piToolResultToWorkflowExecution(input: {
  result: {
    content?: Array<{ type: string; text?: string }>;
    details?: unknown;
  };
  isError: boolean;
}): WorkflowToolExecution {
  if (input.isError) {
    return {
      status: "failed",
      reason: "tool_error",
      message: toolResultErrorText(input.result.content),
      output: input.result.details,
      error: toolResultErrorText(input.result.content),
    };
  }

  return {
    status: "succeeded",
    output: input.result.details,
  };
}
