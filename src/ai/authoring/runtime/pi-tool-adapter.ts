import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AuthoringToolDefinition, AuthoringToolSet } from "@/ai/authoring/tools/definition";
import { formatAuthoringToolResultContent } from "@/ai/authoring/runtime/tool-result-content";
import { normalizeAuthoringToolError } from "@/ai/authoring/runtime/tool-error-normalizer";
import {
  AuthoringToolGateError,
  type AuthoringToolGateErrorSnapshot,
} from "@/ai/authoring/contracts/errors";

function prepareAuthoringToolArguments<TParameters extends TSchema>(
  name: string,
  definition: AuthoringToolDefinition<TParameters, unknown>,
  args: unknown,
): Static<TParameters> {
  try {
    const prepared = definition.prepareArguments
      ? definition.prepareArguments(args)
      : args;
    return Value.Parse(definition.parameters, prepared) as Static<TParameters>;
  } catch (error) {
    throw new Error(
      normalizeAuthoringToolError({
        toolName: name,
        definition,
        phase: "arguments",
        error,
      }).message,
    );
  }
}

export function toPiAgentTool(
  name: string,
  definition: AuthoringToolDefinition<TSchema, unknown>,
): AgentTool<TSchema, unknown> {
  return {
    name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: (args) =>
      prepareAuthoringToolArguments(name, definition, args),
    executionMode: definition.executionMode,
    execute: async (_toolCallId, params) => {
      let output: unknown;
      try {
        output = await definition.execute(params);
      } catch (error) {
        if (error instanceof AuthoringToolGateError) {
          const snapshot: AuthoringToolGateErrorSnapshot = {
            code: error.code,
            userSafeSummary: error.userSafeSummary,
            recoveryHint: error.recoveryHint,
            retryable: error.retryable,
          };
          return {
            content: [{ type: "text" as const, text: error.message }],
            details: { error: snapshot },
            isError: true,
          };
        }
        throw error;
      }

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
