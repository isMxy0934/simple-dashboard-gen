export type LlmMessageRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmGenerateTextInput {
  messages: LlmMessage[];
}

export interface LlmGenerateTextResult {
  provider: string;
  model: string;
  text: string;
}

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult>;
}
