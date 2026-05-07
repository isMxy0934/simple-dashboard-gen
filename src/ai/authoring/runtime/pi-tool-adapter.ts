import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "typebox";
import type { AuthoringToolDefinition, AuthoringToolSet } from "@/ai/authoring/tools/definition";
import { formatAuthoringToolResultContent } from "@/ai/authoring/runtime/tool-result-content";

export function toPiAgentTool(
  name: string,
  definition: AuthoringToolDefinition<TSchema, unknown>,
): AgentTool<TSchema, unknown> {
  return {
    name,
    label: name,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: (args: unknown) => args,
    execute: async (_toolCallId, params) => {
      const output = await definition.execute(params);

      return {
        content: formatAuthoringToolResultContent(name, output),
        details: output,
      };
    },
  };
}

export function toPiAgentTools(tools: AuthoringToolSet): AgentTool<TSchema, unknown>[] {
  return Object.entries(tools).map(([name, definition]) =>
    toPiAgentTool(name, definition),
  );
}
