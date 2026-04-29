import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import { joinAuthoringTextParts } from "@/ai/authoring/messages/user-text";

export function extractLatestUserText(messages: AuthoringMessage[]): string | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    if (message.role !== "user") {
      continue;
    }

    const text = joinAuthoringTextParts(message.parts);

    if (text) {
      return text;
    }
  }

  return null;
}
