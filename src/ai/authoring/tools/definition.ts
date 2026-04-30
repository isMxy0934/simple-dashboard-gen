import type { z } from "zod";

export interface AuthoringToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: any) => Promise<any> | any;
  [key: string]: unknown;
}

export type AuthoringToolSet = Record<string, AuthoringToolDefinition>;

export function tool<TInput, TOutput>(definition: {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
  [key: string]: unknown;
}): AuthoringToolDefinition {
  return definition;
}
