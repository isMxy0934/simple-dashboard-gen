import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { z } from "zod";
import type {
  AuthoringToolDefinition,
  AuthoringToolSet,
} from "@/ai/authoring/tools/definition";

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function schemaToJsonSchema(schema: z.ZodType): TSchema {
  try {
    return z.toJSONSchema(schema) as unknown as TSchema;
  } catch {
    return Type.Any();
  }
}

export function toPiAgentTool(
  name: string,
  definition: AuthoringToolDefinition,
): AgentTool<TSchema, unknown> {
  return {
    name,
    label: name,
    description: definition.description,
    parameters: schemaToJsonSchema(definition.inputSchema),
    prepareArguments: (args: unknown) => {
      const parsed = definition.inputSchema.parse(args);
      return parsed as never;
    },
    execute: async (_toolCallId, params) => {
      const parsed = definition.inputSchema.parse(params);
      const output = await definition.execute(parsed);

      return {
        content: [
          {
            type: "text",
            text: stringifyToolOutput(output),
          },
        ],
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
