import type {
  AfterToolCallContext,
  BeforeToolCallContext,
  AgentContext,
} from "@mariozechner/pi-agent-core";
import type { RuntimeToolSurface } from "@/ai/authoring/agent/tool-surface";
import { normalizeActiveAuthoringToolName } from "@/ai/authoring/agent/tool-surface";
import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import { workflowActionTool } from "@/ai/authoring/agent/runtime-surface";

export function buildAuthoringPiHooks(input: {
  getCurrentSurface: () => RuntimeToolSurface;
  getActiveToolNames: () => ReadonlySet<AuthoringToolName>;
  applyWorkflowToolTransition: (input: {
    toolName: AuthoringToolName;
    result: AfterToolCallContext["result"];
    isError: boolean;
  }) => void;
  refreshRuntimeSurface: (context?: AgentContext) => Promise<void>;
}) {
  return {
    beforeToolCall: async ({ toolCall }: BeforeToolCallContext) => {
      const toolName = normalizeActiveAuthoringToolName(toolCall.name);
      const currentSurface = input.getCurrentSurface();
      if (!toolName || !input.getActiveToolNames().has(toolName)) {
        return {
          block: true,
          reason: `Tool ${toolCall.name} is not active for the current workflow step.`,
        };
      }
      if (
        toolName === "applyPatch" &&
        currentSurface.action?.kind !== "apply_patch"
      ) {
        return {
          block: true,
          reason: "applyPatch is only available for a matching local UI approval event.",
        };
      }
      return undefined;
    },
    afterToolCall: async ({
      toolCall,
      result,
      isError,
      context,
    }: AfterToolCallContext) => {
      const toolName = normalizeActiveAuthoringToolName(toolCall.name);
      const currentSurface = input.getCurrentSurface();
      const actionForTool = workflowActionTool(currentSurface.action);
      if (toolName && actionForTool === toolName) {
        input.applyWorkflowToolTransition({ toolName, result, isError });
      }
      await input.refreshRuntimeSurface(context);
      return undefined;
    },
  };
}

