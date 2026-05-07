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
import type { AuthoringToolDefinition } from "@/ai/authoring/tools/definition";
import {
  normalizeAuthoringToolError,
  normalizedAuthoringToolErrorDetails,
} from "@/ai/authoring/runtime/tool-error-normalizer";

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
  getToolDefinition?: (toolName: AuthoringToolName) => AuthoringToolDefinition | null | undefined;
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
        const normalized = normalizeAuthoringToolError({
          toolName: toolCall.name,
          definition: toolName ? input.getToolDefinition?.(toolName) : undefined,
          phase: "unavailable",
          error: `Tool ${toolCall.name} is not available in ${currentSurface.mode} mode.`,
        });
        return {
          block: true,
          reason: normalized.message,
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

      const normalizedToolName = toolName ?? toolCall.name;
      const definition = toolName ? input.getToolDefinition?.(toolName) : undefined;
      const gateError =
        normalizeAuthoringToolError({
          toolName: normalizedToolName,
          definition,
          phase: "execution",
          error: result.details,
        });
      const normalized = gateError.kind === "gate"
        ? gateError
        : normalizeAuthoringToolError({
            toolName: normalizedToolName,
            definition,
            phase: "execution",
            error: collectTextContent(result),
      });
      return {
        content: [{ type: "text" as const, text: normalized.message }],
        details: normalizedAuthoringToolErrorDetails(normalized),
      };
    },
  };
}
