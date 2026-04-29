import type { AuthoringMessage } from "@/ai/authoring/contracts/runtime";

function isHistoricalDeepSeekThinkingPart(part: AuthoringMessage["parts"][number]) {
  return part.type === "reasoning" || part.type === "step-start" || part.type.startsWith("tool-");
}

/**
 * DeepSeek V4 thinking mode requires reasoning_content to be echoed back for
 * historical tool-call turns. The current AI SDK DeepSeek provider only echoes
 * reasoning for assistant messages after the latest user message, so old raw
 * tool-call transcripts can trigger 400s. Keep prior user/final assistant text
 * as conversation memory, and let the current turn run thinking + tools normally.
 */
export function prepareDeepSeekThinkingUiMessages(
  messages: AuthoringMessage[],
): AuthoringMessage[] {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex <= 0) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index >= latestUserIndex || message.role !== "assistant") {
      return message;
    }

    const parts = message.parts.filter(
      (part) => !isHistoricalDeepSeekThinkingPart(part),
    );

    return {
      ...message,
      parts,
    };
  });
}
