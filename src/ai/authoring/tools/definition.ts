import type { ToolExecutionMode } from "@mariozechner/pi-agent-core";
import type { TSchema, Static } from "typebox";

export interface AuthoringToolContractMetadata {
  /** What the model must provide or omit at the argument boundary. */
  parameters?: string[];
  /** Inputs the model must not synthesize because runtime owns them. */
  prohibited?: string[];
  /** Recoverable state requirements before the tool can succeed. */
  preconditions?: string[];
}

export interface AuthoringToolDefinition<
  TParams extends TSchema = TSchema,
  TOutput = unknown,
> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  contract?: AuthoringToolContractMetadata;
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
