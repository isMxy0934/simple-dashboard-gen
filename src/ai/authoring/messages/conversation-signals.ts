import type {
  AuthoringDraftOutput,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import { findLatestDraftOutput, hasPendingApprovalResponse, hasPendingToolApproval } from "@/ai/authoring/messages/inspection";
import { extractLatestUserText } from "@/ai/authoring/messages/extract-latest-user-text";

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
