import type {
  AfterToolCallContext,
  BeforeToolCallContext,
  AgentContext,
} from "@mariozechner/pi-agent-core";
import type { RuntimeToolSurface } from "@/ai/authoring/agent/tool-surface";
import {
  normalizeActiveAuthoringToolName,
  surfaceConfigDigest,
} from "@/ai/authoring/agent/tool-surface";
import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import { extractAuthoringToolGateError } from "@/ai/authoring/contracts/errors";

function collectTextContent(result: AfterToolCallContext["result"]): string {
  return result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

export function buildAuthoringPiHooks(input: {
  getCurrentSurface: () => RuntimeToolSurface;
  getActiveToolNames: () => ReadonlySet<AuthoringToolName>;
  isApprovalToolAllowed: () => boolean;
  onToolResult?: (input: {
    toolName: AuthoringToolName;
    result: AfterToolCallContext["result"];
    isError: boolean;
    context?: AgentContext;
  }) => Promise<void> | void;
  refreshRuntimeSurface: (context?: AgentContext) => Promise<void>;
  /** Incremental optimization: digest to compare before triggering full rebuild. */
  getLastSurfaceDigest: () => string | null;
  setLastSurfaceDigest: (digest: string | null) => void;
}) {
  return {
    beforeToolCall: async ({ toolCall }: BeforeToolCallContext) => {
      const toolName = normalizeActiveAuthoringToolName(toolCall.name);
      const currentSurface = input.getCurrentSurface();
      if (!toolName || !input.getActiveToolNames().has(toolName)) {
        return {
          block: true,
          reason: `Tool ${toolCall.name} is not available in ${currentSurface.mode} mode.`,
        };
      }
      if (
        toolName === "applyPatch" &&
        (currentSurface.mode !== "approval" || !input.isApprovalToolAllowed())
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
      if (toolName) {
        await input.onToolResult?.({ toolName, result, isError, context });
      }
      const currentSurface = input.getCurrentSurface();
      const currentDigest = surfaceConfigDigest(currentSurface);
      const lastDigest = input.getLastSurfaceDigest();
      if (currentDigest !== lastDigest || lastDigest === null) {
        input.setLastSurfaceDigest(currentDigest);
        await input.refreshRuntimeSurface(context);
      }
      if (!isError) {
        return undefined;
      }

      const gateError =
        extractAuthoringToolGateError(result.details) ??
        extractAuthoringToolGateError(collectTextContent(result));
      return gateError ? { details: { error: gateError } } : undefined;
    },
  };
}
