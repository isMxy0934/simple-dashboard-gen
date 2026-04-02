import { createDeepSeek } from "@ai-sdk/deepseek";

export function createDeepSeekProvider() {
  return createDeepSeek({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}
