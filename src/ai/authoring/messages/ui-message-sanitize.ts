import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isAuthoringRole(value: unknown): value is AuthoringMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

function sanitizeAuthoringMessageParts(
  parts: unknown,
): AuthoringMessage["parts"] {
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts.flatMap((part) => {
    if (!isRecord(part) || typeof part.type !== "string") {
      return [];
    }

    if (part.type === "text" || part.type === "reasoning") {
      return typeof part.text === "string"
        ? [cloneJson(part) as AuthoringMessage["parts"][number]]
        : [];
    }

    return [cloneJson(part) as AuthoringMessage["parts"][number]];
  });
}

export function sanitizeAuthoringMessage(
  message: unknown,
): AuthoringMessage | null {
  if (
    !isRecord(message) ||
    typeof message.id !== "string" ||
    !isAuthoringRole(message.role)
  ) {
    return null;
  }

  return {
    ...(message.metadata !== undefined ? { metadata: cloneJson(message.metadata) } : {}),
    id: message.id,
    role: message.role,
    parts: sanitizeAuthoringMessageParts(message.parts),
  } as AuthoringMessage;
}

export function sanitizeAuthoringMessages(
  messages: unknown,
): AuthoringMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    const sanitized = sanitizeAuthoringMessage(message);
    return sanitized ? [sanitized] : [];
  });
}
