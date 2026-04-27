import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

const INCOMPLETE_TOOL_STATES = new Set(["input-streaming", "input-available"]);

type AuthoringMessagePart = AuthoringMessage["parts"][number];

export const AUTHORING_INTERRUPTED_TOOL_ERROR =
  "AUTHORING_TURN_INTERRUPTED: tool input was not completed before the response ended.";

export function isIncompleteToolPart(part: AuthoringMessagePart): boolean {
  if (!part.type.startsWith("tool-")) {
    return false;
  }

  const state = (part as { state?: string }).state;
  return typeof state === "string" && INCOMPLETE_TOOL_STATES.has(state);
}

export function finalizeIncompleteToolCalls(
  messages: AuthoringMessage[],
  errorText = AUTHORING_INTERRUPTED_TOOL_ERROR,
): AuthoringMessage[] {
  let changed = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let messageChanged = false;
    const parts = message.parts.map((part) => {
      if (!isIncompleteToolPart(part)) {
        return part;
      }

      changed = true;
      messageChanged = true;
      return {
        ...part,
        state: "output-error",
        errorText,
      } as AuthoringMessagePart;
    });

    return messageChanged ? { ...message, parts } : message;
  });

  return changed ? nextMessages : messages;
}
