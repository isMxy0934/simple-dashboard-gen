import type { AuthoringUiMessage } from "@/web/authoring/agent/types";

const INCOMPLETE_TOOL_STATES = new Set(["input-streaming", "input-available"]);

type AuthoringUiMessagePart = AuthoringUiMessage["parts"][number];

export const AUTHORING_INTERRUPTED_TOOL_ERROR =
  "AUTHORING_TURN_INTERRUPTED: tool input was not completed before the response ended.";

export function isIncompleteToolPart(part: AuthoringUiMessagePart): boolean {
  if (!part.type.startsWith("tool-")) {
    return false;
  }

  const state = (part as { state?: string }).state;
  return typeof state === "string" && INCOMPLETE_TOOL_STATES.has(state);
}

export function finalizeIncompleteToolCalls(
  messages: AuthoringUiMessage[],
  errorText = AUTHORING_INTERRUPTED_TOOL_ERROR,
): AuthoringUiMessage[] {
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
      } as AuthoringUiMessagePart;
    });

    return messageChanged ? { ...message, parts } : message;
  });

  return changed ? nextMessages : messages;
}
