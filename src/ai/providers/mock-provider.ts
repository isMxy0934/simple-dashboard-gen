import type { LlmGenerateTextInput, LlmGenerateTextResult, LlmProvider } from "./types";

export class MockProvider implements LlmProvider {
  readonly provider = "mock";
  readonly model = "mock";
  private readonly responseText: string;

  constructor(responseText = "") {
    this.responseText = responseText;
  }

  async generateText(_input: LlmGenerateTextInput): Promise<LlmGenerateTextResult> {
    return {
      provider: this.provider,
      model: this.model,
      text: this.responseText,
    };
  }
}
