import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { RuntimeToolSurface } from "@/ai/authoring/agent/tool-surface";
import type { ToolStep } from "@/ai/authoring/workflow/types";

export type ForcedToolRetryDecision =
  | { kind: "ignore" }
  | { kind: "retry"; step: ToolStep; targetTool: AuthoringToolName }
  | { kind: "block"; step: ToolStep; targetTool: AuthoringToolName };

function stepFromSurface(surface: RuntimeToolSurface): ToolStep | null {
  return surface.mode === "forced"
    ? {
        mode: "forced",
        activeTools: [...surface.activeTools],
        toolChoice: surface.toolChoice,
      }
    : null;
}

export function createForcedToolRetryGate() {
  let forcedStepAtTurnStart: ToolStep | null = null;
  let retryUsed = false;

  return {
    resetRetryBudget() {
      retryUsed = false;
    },
    recordTurnStart(surface: RuntimeToolSurface) {
      forcedStepAtTurnStart = stepFromSurface(surface);
    },
    decideTurnEnd(input: {
      calledTools: readonly string[];
    }): ForcedToolRetryDecision {
      const step = forcedStepAtTurnStart;
      forcedStepAtTurnStart = null;
      if (!step) {
        return { kind: "ignore" };
      }

      const targetTool = step.activeTools[0];
      if (!targetTool || input.calledTools.includes(targetTool)) {
        return { kind: "ignore" };
      }

      if (!retryUsed) {
        retryUsed = true;
        return { kind: "retry", step, targetTool };
      }

      return { kind: "block", step, targetTool };
    },
  };
}
