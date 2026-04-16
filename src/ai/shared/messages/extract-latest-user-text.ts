import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";

export function extractLatestUserText(messages: MainAgentMessage[]): string | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    if (message.role !== "user") {
      continue;
    }

    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return null;
}
