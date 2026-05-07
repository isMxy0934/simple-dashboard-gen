import type { AuthoringUiMessage } from "@/web/authoring/agent/types";
import {
  AUTHORING_INTERRUPTED_TOOL_ERROR,
  isIncompleteToolPart,
} from "@/web/authoring/agent/incomplete-tools";

export type AgentRuntimeStatus = "submitted" | "streaming" | "ready" | "error";

export type AuthoringWorkingIndicatorKind =
  | "understanding"
  | "thinking"
  | "preparingTool"
  | "executingTool"
  | "slow";

export type AuthoringTerminalNoticeKind =
  | "interrupted"
  | "toolFailed"
  | "chartDraftUpdated"
  | "queryDraftUpdated"
  | "viewDraftUpdated"
  | "bindingDraftUpdated";

const DEFAULT_LONG_RUNNING_MS = 9000;

function collectCurrentTurnAssistantParts(messages: AuthoringUiMessage[]) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const parts: AuthoringUiMessage["parts"] = [];
  for (let index = Math.max(latestUserIndex + 1, 0); index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      parts.push(...message.parts);
    }
  }
  return parts;
}

function getToolState(part: AuthoringUiMessage["parts"][number]): string | null {
  if (!part.type.startsWith("tool-")) {
    return null;
  }
  const state = (part as { state?: unknown }).state;
  return typeof state === "string" ? state : null;
}

function getToolErrorText(part: AuthoringUiMessage["parts"][number]): string | null {
  if (!part.type.startsWith("tool-")) {
    return null;
  }
  const errorText = (part as { errorText?: unknown }).errorText;
  return typeof errorText === "string" ? errorText : null;
}

function currentTurnHasAssistantText(parts: AuthoringUiMessage["parts"]): boolean {
  return parts.some(
    (part) => part.type === "text" && Boolean(part.text?.trim()),
  );
}

function getLastToolPart(parts: AuthoringUiMessage["parts"]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.type.startsWith("tool-")) {
      return part;
    }
  }
  return null;
}

export function getAuthoringWorkingActivityFingerprint(
  messages: AuthoringUiMessage[],
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
  messages: AuthoringUiMessage[];
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

export function getAuthoringTerminalNotice(input: {
  messages: AuthoringUiMessage[];
  agentStatus: AgentRuntimeStatus;
}): AuthoringTerminalNoticeKind | null {
  if (input.agentStatus === "submitted" || input.agentStatus === "streaming") {
    return null;
  }

  const parts = collectCurrentTurnAssistantParts(input.messages);
  if (parts.length === 0 || currentTurnHasAssistantText(parts)) {
    return null;
  }

  const lastToolPart = getLastToolPart(parts);
  if (!lastToolPart) {
    return null;
  }

  if (isIncompleteToolPart(lastToolPart)) {
    return "interrupted";
  }

  if (getToolState(lastToolPart) !== "output-error") {
    if (getToolState(lastToolPart) !== "output-available") {
      return null;
    }
    if (lastToolPart.type === "tool-stageChart") {
      return "chartDraftUpdated";
    }
    if (lastToolPart.type === "tool-stageDelete") {
      return "viewDraftUpdated";
    }
    return null;
  }

  return getToolErrorText(lastToolPart) === AUTHORING_INTERRUPTED_TOOL_ERROR
    ? "interrupted"
    : "toolFailed";
}
