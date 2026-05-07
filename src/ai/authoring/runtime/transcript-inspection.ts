import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  ApplyPatchToolOutput,
  AuthoringDraftOutput,
} from "@/ai/authoring/contracts/tool-io";
import { stripProviderRuntimeMetadata } from "@/ai/authoring/runtime/llm-boundary";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

function textFromAgentMessage(message: AgentMessage): string {
  if (message.role === "user") {
    return Array.isArray(message.content)
      ? message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim()
      : message.content.trim();
  }
  if (message.role === "assistant") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
  }
  return "";
}

export function extractLatestAgentUserText(messages: AgentMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }
    const text = textFromAgentMessage(message);
    if (text) {
      return text;
    }
  }
  return null;
}

function findLatestToolDetails<T>(
  messages: AgentMessage[],
  toolName: string,
  predicate: (value: unknown) => value is T,
): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isToolResultMessage(message) || message.toolName !== toolName) {
      continue;
    }
    const details = stripProviderRuntimeMetadata(message.details);
    if (predicate(details)) {
      return details;
    }
  }
  return null;
}

function isAuthoringDraftOutput(value: unknown): value is AuthoringDraftOutput {
  return (
    isRecord(value) &&
    isRecord(value.suggestion) &&
    typeof value.suggestion.id === "string" &&
    isRecord(value.suggestion.patch)
  );
}

function isApplyPatchToolOutput(value: unknown): value is ApplyPatchToolOutput {
  return (
    isRecord(value) &&
    value.applied === true &&
    typeof value.suggestion_id === "string"
  );
}

export function findLatestDraftOutputFromTranscript(
  messages: AgentMessage[],
): AuthoringDraftOutput | null {
  return findLatestToolDetails(messages, "composePatch", isAuthoringDraftOutput);
}

export function findDraftOutputBySuggestionIdFromTranscript(
  messages: AgentMessage[],
  suggestionId: string,
): AuthoringDraftOutput | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isToolResultMessage(message) || message.toolName !== "composePatch") {
      continue;
    }
    const details = stripProviderRuntimeMetadata(message.details);
    if (isAuthoringDraftOutput(details) && details.suggestion.id === suggestionId) {
      return details;
    }
  }
  return null;
}

export function findLatestApplyPatchOutputFromTranscript(
  messages: AgentMessage[],
): ApplyPatchToolOutput | null {
  return findLatestToolDetails(messages, "applyPatch", isApplyPatchToolOutput);
}

export interface AuthoringConversationSignals {
  latestUserText: string;
  latestDraftOutput: AuthoringDraftOutput | null;
  approvalState: "none" | "requested" | "approved" | "rejected";
}

export function deriveConversationSignalsFromTranscript(input: {
  messages: AgentMessage[];
  promptText?: string | null;
  hasApprovalRequest?: boolean;
  approvalDecision?: "approve" | "reject" | null;
}): AuthoringConversationSignals {
  const latestUserText =
    input.promptText?.trim() || extractLatestAgentUserText(input.messages) || "";
  const latestDraftOutput = findLatestDraftOutputFromTranscript(input.messages);
  const latestApplyOutput = findLatestApplyPatchOutputFromTranscript(input.messages);

  // If applyPatch consumed the latest proposal, clear the pending draft.
  // Otherwise old composePatch outputs in the transcript keep approvalState
  // stuck at "requested" forever, blocking tools on all subsequent turns.
  const proposalConsumed =
    latestApplyOutput &&
    latestDraftOutput &&
    findLatestToolResultIndex(input.messages, "applyPatch") >
      findLatestToolResultIndex(input.messages, "composePatch");

  const approvalState: AuthoringConversationSignals["approvalState"] =
    input.approvalDecision === "approve"
      ? "approved"
      : input.approvalDecision === "reject"
        ? "rejected"
        : input.hasApprovalRequest
          ? "requested"
          : proposalConsumed
            ? "none"
            : latestDraftOutput
              ? "requested"
              : "none";

  return {
    latestUserText,
    latestDraftOutput: proposalConsumed ? null : latestDraftOutput,
    approvalState,
  };
}

function findLatestToolResultIndex(
  messages: AgentMessage[],
  toolName: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "toolResult" &&
      message.toolName === toolName
    ) {
      return index;
    }
  }
  return -1;
}
