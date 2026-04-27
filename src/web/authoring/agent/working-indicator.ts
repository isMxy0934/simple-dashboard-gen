import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

export type AgentRuntimeStatus = "submitted" | "streaming" | "ready" | "error";

export type AuthoringWorkingIndicatorKind =
  | "understanding"
  | "thinking"
  | "preparingTool"
  | "executingTool"
  | "slow";

const DEFAULT_LONG_RUNNING_MS = 9000;

function collectCurrentTurnAssistantParts(messages: AuthoringMessage[]) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const parts: AuthoringMessage["parts"] = [];
  for (let index = Math.max(latestUserIndex + 1, 0); index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      parts.push(...message.parts);
    }
  }
  return parts;
}

function getToolState(part: AuthoringMessage["parts"][number]): string | null {
  if (!part.type.startsWith("tool-")) {
    return null;
  }
  const state = (part as { state?: unknown }).state;
  return typeof state === "string" ? state : null;
}

export function getAuthoringWorkingActivityFingerprint(
  messages: AuthoringMessage[],
): string {
  const currentParts = collectCurrentTurnAssistantParts(messages);
  return currentParts
    .map((part) => {
      if (part.type === "text") {
        return `text:${part.text.length}`;
      }
      if (part.type === "reasoning") {
        return `reasoning:${part.text.length}`;
      }
      if (part.type.startsWith("tool-")) {
        return `${part.type}:${getToolState(part) ?? "unknown"}`;
      }
      return part.type;
    })
    .join("|");
}

export function getAuthoringWorkingIndicator(input: {
  messages: AuthoringMessage[];
  agentStatus: AgentRuntimeStatus;
  inactiveMs: number;
  longRunningMs?: number;
}): AuthoringWorkingIndicatorKind | null {
  if (input.agentStatus !== "submitted" && input.agentStatus !== "streaming") {
    return null;
  }

  const parts = collectCurrentTurnAssistantParts(input.messages);
  const toolStates = parts
    .filter((part) => part.type.startsWith("tool-"))
    .map(getToolState);

  if (toolStates.includes("input-streaming")) {
    return "preparingTool";
  }

  if (toolStates.includes("input-available")) {
    return "executingTool";
  }

  const longRunningMs = input.longRunningMs ?? DEFAULT_LONG_RUNNING_MS;
  if (input.inactiveMs >= longRunningMs) {
    return "slow";
  }

  if (parts.some((part) => part.type === "reasoning")) {
    return "thinking";
  }

  return "understanding";
}
