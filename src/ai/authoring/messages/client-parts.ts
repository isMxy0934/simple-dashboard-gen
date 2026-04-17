import type {
  AuthoringMessage,
  AuthoringPatchApprovalPayload,
} from "@/ai/authoring/contracts/tool-io";
import { findLatestApplyPatchApproval } from "@/ai/authoring/messages/inspection";

export const AUTHORING_CLIENT_ONLY_DATA_KEYS = [
  "authoring_patch_approval",
] as const;

export type AuthoringClientOnlyDataKey =
  (typeof AUTHORING_CLIENT_ONLY_DATA_KEYS)[number];

const CLIENT_ONLY_PART_TYPES: ReadonlySet<string> = new Set(
  AUTHORING_CLIENT_ONLY_DATA_KEYS.map((key) => `data-${key}`),
);
const MODEL_DEDUPED_ASSISTANT_PART_TYPES = new Set([
  "data-authoring_scope",
  "data-authoring_patch",
  "data-authoring_checks",
  "data-authoring_sub_task",
]);

export function isAuthoringClientOnlyDataPartType(partType: string): boolean {
  return CLIENT_ONLY_PART_TYPES.has(partType);
}

export const AUTHORING_PATCH_APPROVAL_DATA_KEY: AuthoringClientOnlyDataKey =
  "authoring_patch_approval";

export const AUTHORING_PATCH_APPROVAL_PART_TYPE =
  `data-${AUTHORING_PATCH_APPROVAL_DATA_KEY}` as const;

export type { AuthoringPatchApprovalPayload };

function removeClientOnlyPartsFromAssistantMessages(
  messages: AuthoringMessage[],
): AuthoringMessage[] {
  const next = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }
    const parts = message.parts.filter(
      (part) => !isAuthoringClientOnlyDataPartType(part.type),
    );
    return { ...message, parts };
  });
  return next.filter(
    (message) => !(message.role === "assistant" && message.parts.length === 0),
  );
}

function dedupeAssistantParts(
  parts: AuthoringMessage["parts"],
): AuthoringMessage["parts"] {
  const lastIndexByType = new Map<string, number>();

  parts.forEach((part, index) => {
    if (MODEL_DEDUPED_ASSISTANT_PART_TYPES.has(part.type)) {
      lastIndexByType.set(part.type, index);
    }
  });

  return parts.filter((part, index) => {
    if (!MODEL_DEDUPED_ASSISTANT_PART_TYPES.has(part.type)) {
      return true;
    }

    return lastIndexByType.get(part.type) === index;
  });
}

function compactAssistantMessageParts(
  parts: AuthoringMessage["parts"],
): AuthoringMessage["parts"] {
  const deduped = dedupeAssistantParts(parts).filter(
    (part) => part.type !== "step-start",
  );
  const lastTextIndex = findLastTextIndex(deduped);
  const hasToolPart = deduped.some((part) => part.type.startsWith("tool-"));

  if (!hasToolPart || lastTextIndex < 0) {
    return deduped;
  }

  return deduped.filter(
    (part, index) => part.type !== "text" || index === lastTextIndex,
  );
}

function findLastTextIndex(parts: AuthoringMessage["parts"]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") {
      return index;
    }
  }

  return -1;
}

function findAssistantMessageIndexWithApplyPatchApproval(
  messages: AuthoringMessage[],
  approvalId: string,
): number {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "approval-requested" &&
        part.approval.id === approvalId
      ) {
        return i;
      }
    }
  }
  return -1;
}

/** Removes all client-only data parts before model transport. */
export function stripAuthoringMessagesForModel(
  messages: AuthoringMessage[],
): AuthoringMessage[] {
  return removeClientOnlyPartsFromAssistantMessages(messages).map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    return {
      ...message,
      parts: compactAssistantMessageParts(message.parts),
    };
  });
}

export function syncAuthoringPatchApprovalUi(
  messages: AuthoringMessage[],
): { messages: AuthoringMessage[]; changed: boolean } {
  const base = removeClientOnlyPartsFromAssistantMessages(messages);
  const pending = findLatestApplyPatchApproval(base);

  if (!pending) {
    return { messages: base, changed: base !== messages };
  }

  const anchorIndex = findAssistantMessageIndexWithApplyPatchApproval(
    base,
    pending.approvalId,
  );
  if (anchorIndex < 0) {
    return { messages: base, changed: base !== messages };
  }

  const anchor = base[anchorIndex];
  const uiPart: AuthoringMessage["parts"][number] = {
    type: AUTHORING_PATCH_APPROVAL_PART_TYPE,
    data: {
      approvalId: pending.approvalId,
      suggestionId: pending.suggestionId,
    },
  };

  const next = [...base];
  next[anchorIndex] = {
    ...anchor,
    parts: [...anchor.parts, uiPart],
  };

  return { messages: next, changed: true };
}
