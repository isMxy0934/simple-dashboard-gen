import type { ModelMessage } from "@ai-sdk/provider-utils";
import type {
  AuthoringDraftOutput,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import { findLatestDraftOutput, hasPendingApprovalResponse, hasPendingToolApproval } from "@/ai/authoring/messages/inspection";
import { extractLatestUserText } from "@/ai/authoring/shared/extract-latest-user-text";
import { joinAuthoringTextParts, stripAuthoringContextBlock } from "@/ai/authoring/shared/user-text";

export type AuthoringApprovalState =
  | "none"
  | "requested"
  | "approved"
  | "rejected";

export interface AuthoringConversationSignals {
  latestUserText: string;
  latestDraftOutput: AuthoringDraftOutput | null;
  approvalState: AuthoringApprovalState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractLatestUserTextFromModelMessages(messages: ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      const text = stripAuthoringContextBlock(message.content).trim();
      if (text) {
        return text;
      }
      continue;
    }

    const text = joinAuthoringTextParts(message.content);
    if (text) {
      return text;
    }
  }

  return "";
}

function findLatestDraftOutputInModelMessages(
  messages: ModelMessage[],
): AuthoringDraftOutput | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (
        part.type !== "tool-result" ||
        part.toolName !== "composePatch" ||
        !isRecord(part.output) ||
        part.output.type !== "json" ||
        !isRecord(part.output.value) ||
        !("suggestion" in part.output.value) ||
        !isRecord(part.output.value.suggestion) ||
        !isRecord(part.output.value.suggestion.dashboard)
      ) {
        continue;
      }

      return part.output.value as unknown as AuthoringDraftOutput;
    }
  }

  return null;
}

function findApprovalStateInModelMessages(
  messages: ModelMessage[],
): AuthoringApprovalState {
  const applyPatchApprovalIds = new Set<string>();
  const applyPatchToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part.type === "tool-call" && part.toolName === "applyPatch") {
        applyPatchToolCallIds.add(part.toolCallId);
        continue;
      }

      if (
        part.type === "tool-approval-request" &&
        applyPatchToolCallIds.has(part.toolCallId)
      ) {
        applyPatchApprovalIds.add(part.approvalId);
      }
    }
  }

  if (applyPatchApprovalIds.size === 0) {
    return "none";
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (
        part.type !== "tool-approval-response" ||
        !applyPatchApprovalIds.has(part.approvalId)
      ) {
        continue;
      }

      return part.approved ? "approved" : "rejected";
    }
  }

  return "requested";
}

export function deriveConversationSignalsFromUiMessages(
  messages: AuthoringMessage[],
): AuthoringConversationSignals {
  return {
    latestUserText: extractLatestUserText(messages) ?? "",
    latestDraftOutput: findLatestDraftOutput(messages),
    approvalState: hasPendingApprovalResponse(messages)
      ? "approved"
      : hasPendingToolApproval(messages)
        ? "requested"
        : "none",
  };
}

export function deriveConversationSignalsFromModelMessages(
  messages: ModelMessage[],
): AuthoringConversationSignals {
  return {
    latestUserText: extractLatestUserTextFromModelMessages(messages),
    latestDraftOutput: findLatestDraftOutputInModelMessages(messages),
    approvalState: findApprovalStateInModelMessages(messages),
  };
}
