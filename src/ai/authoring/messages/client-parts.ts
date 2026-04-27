import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import { isIncompleteToolPart } from "@/ai/authoring/messages/incomplete-tools";

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
]);

export function isAuthoringClientOnlyDataPartType(partType: string): boolean {
  return CLIENT_ONLY_PART_TYPES.has(partType);
}

function removeClientOnlyPartsFromAssistantMessages(
  messages: AuthoringMessage[],
): AuthoringMessage[] {
  let changed = false;
  const next: AuthoringMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      next.push(message);
      continue;
    }

    const parts = message.parts.filter(
      (part) => !isAuthoringClientOnlyDataPartType(part.type),
    );
    const partsChanged = parts.length !== message.parts.length;

    if (parts.length === 0) {
      changed = true;
      continue;
    }

    if (partsChanged) {
      changed = true;
      next.push({ ...message, parts });
      continue;
    }

    next.push(message);
  }

  return changed ? next : messages;
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
  const deduped = dedupeAssistantParts(parts)
    .filter((part) => part.type !== "step-start")
    .filter((part) => !isIncompleteToolPart(part));
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
