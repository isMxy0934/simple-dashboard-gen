import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

export function extractLatestUserText(messages: AuthoringMessage[]): string | null {
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
