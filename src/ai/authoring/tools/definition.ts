import type { ToolExecutionMode } from "@mariozechner/pi-agent-core";
import type { TSchema, Static } from "typebox";

export interface AuthoringToolDefinition<
  TParams extends TSchema = TSchema,
  TOutput = unknown,
> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;
  execute: (params: Static<TParams>) => Promise<TOutput> | TOutput;
}

export type AuthoringToolSet = Record<string, AuthoringToolDefinition>;

export function defineTool<TParams extends TSchema, TOutput>(
  def: AuthoringToolDefinition<TParams, TOutput>,
): AuthoringToolDefinition<TParams, TOutput> {
  return def;
}
