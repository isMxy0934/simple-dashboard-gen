import type {
  AgentMessage,
  CustomAgentMessages,
} from "@mariozechner/pi-agent-core";
import type {
  Message,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { formatAuthoringToolResultContent } from "@/ai/authoring/runtime/tool-result-content";

const PROVIDER_RUNTIME_KEYS = new Set([
  "providerOptions",
  "providerMetadata",
  "callProviderMetadata",
  "resultProviderMetadata",
]);

export interface AuthoringContextAgentMessage {
  role: "authoring";
  kind: "context";
  content: string;
  timestamp: number;
}

export interface AuthoringNoticeAgentMessage {
  role: "authoring";
  kind: "notice";
  content: string;
  timestamp: number;
}

export interface AuthoringRuntimeInstructionAgentMessage {
  role: "authoring";
  kind: "runtime_instruction";
  content: string;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    authoringContext: AuthoringContextAgentMessage;
    authoringNotice: AuthoringNoticeAgentMessage;
    authoringRuntimeInstruction: AuthoringRuntimeInstructionAgentMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asToolCallId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.toolCallId ?? value.id ?? value.call_id;
  return typeof id === "string" && id.trim() ? id : null;
}

function getMessageToolCallIds(message: AgentMessage): string[] {
  if (!isRecord(message)) {
    return [];
  }
  const topLevel = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const contentLevel = Array.isArray(message.content)
    ? message.content.filter(
        (part): part is Record<string, unknown> =>
          isRecord(part) && part.type === "toolCall",
      )
    : [];
  return [...topLevel, ...contentLevel]
    .map(asToolCallId)
    .filter((id): id is string => Boolean(id));
}

function getToolResultCallId(message: AgentMessage): string | null {
  if (!isRecord(message) || message.role !== "toolResult") {
    return null;
  }
  const id = message.toolCallId ?? message.call_id;
  return typeof id === "string" && id.trim() ? id : null;
}

function hasMessageText(message: AgentMessage): boolean {
  if (!isRecord(message)) {
    return false;
  }
  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        isRecord(part) &&
        ((part.type === "text" && typeof part.text === "string" && part.text.trim()) ||
          (part.type === "thinking" &&
            typeof part.thinking === "string" &&
            part.thinking.trim())),
    )
  );
}

function withoutToolCalls(
  message: AgentMessage,
  allowedCallIds: Set<string>,
): AgentMessage {
  if (!isRecord(message)) {
    return message;
  }
  const next: Record<string, unknown> = { ...message };
  if (Array.isArray(next.toolCalls)) {
    const toolCalls = next.toolCalls.filter((toolCall) => {
      const id = asToolCallId(toolCall);
      return id ? allowedCallIds.has(id) : false;
    });
    if (toolCalls.length) {
      next.toolCalls = toolCalls;
    } else {
      delete next.toolCalls;
    }
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.filter((part) => {
      if (!isRecord(part) || part.type !== "toolCall") {
        return true;
      }
      const id = asToolCallId(part);
      return id ? allowedCallIds.has(id) : false;
    });
  }
  return next as unknown as AgentMessage;
}

export function sanitizeToolCallPairs(messages: AgentMessage[]): AgentMessage[] {
  const strippedMessages = stripProviderRuntimeMetadata(messages);
  const resultIndexByCallId = new Map<string, number>();
  strippedMessages.forEach((message, index) => {
    const callId = getToolResultCallId(message);
    if (callId) {
      resultIndexByCallId.set(callId, index);
    }
  });
  const allowedCallIds = new Set<string>();
  const out: AgentMessage[] = [];

  for (const [index, message] of strippedMessages.entries()) {
    if (!isRecord(message)) {
      continue;
    }
    if (message.role === "assistant") {
      const callIds = getMessageToolCallIds(message);
      if (callIds.length === 0) {
        out.push(message);
        continue;
      }
      const pairedIds = callIds.filter((id) => {
        const resultIndex = resultIndexByCallId.get(id);
        return resultIndex !== undefined && resultIndex > index;
      });
      if (pairedIds.length === 0) {
        if (hasMessageText(message)) {
          out.push(withoutToolCalls(message, new Set()));
        }
        continue;
      }
      pairedIds.forEach((id) => allowedCallIds.add(id));
      out.push(withoutToolCalls(message, new Set(pairedIds)));
      continue;
    }

    if (message.role === "toolResult") {
      const callId = getToolResultCallId(message);
      if (!callId || !allowedCallIds.has(callId)) {
        continue;
      }
    }

    out.push(message);
  }

  return out;
}

export function stripProviderRuntimeMetadata<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripProviderRuntimeMetadata(item)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PROVIDER_RUNTIME_KEYS.has(key)) {
      continue;
    }
    next[key] = stripProviderRuntimeMetadata(entry);
  }

  return next as T;
}

export function createAuthoringContextMessage(
  content: string,
): AuthoringContextAgentMessage {
  return {
    role: "authoring",
    kind: "context",
    content,
    timestamp: Date.now(),
  };
}

export function createAuthoringRuntimeInstructionMessage(
  content: string,
): AuthoringRuntimeInstructionAgentMessage {
  return {
    role: "authoring",
    kind: "runtime_instruction",
    content,
    timestamp: Date.now(),
  };
}

export function transformAuthoringContext(input: {
  messages: AgentMessage[];
  contextMarkdown: string;
  maxMessages?: number;
}): AgentMessage[] {
  try {
    const maxMessages = input.maxMessages ?? 40;
    const pruned = sanitizeToolCallPairs(input.messages.slice(-maxMessages));
    if (!input.contextMarkdown.trim()) {
      return pruned;
    }

    return [createAuthoringContextMessage(input.contextMarkdown), ...pruned];
  } catch {
    return Array.isArray(input.messages)
      ? input.messages.slice(-(input.maxMessages ?? 40))
      : [];
  }
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
  try {
    return sanitizeToolCallPairs(messages).flatMap((message): Message[] => {
      try {
        const stripped = stripProviderRuntimeMetadata(message);

        if (stripped.role === "authoring" && stripped.kind === "context") {
          return [
            {
              role: "user",
              content: stripped.content,
              timestamp: stripped.timestamp,
            },
          ];
        }

        if (
          stripped.role === "authoring" &&
          stripped.kind === "runtime_instruction"
        ) {
          return [
            {
              role: "user",
              content: stripped.content,
              timestamp: stripped.timestamp,
            },
          ];
        }

        if (stripped.role === "toolResult") {
          const toolResult = stripped as ToolResultMessage;
          const llmToolResult = { ...toolResult };
          delete (llmToolResult as { details?: unknown }).details;
          if (toolResult.isError) {
            return [llmToolResult as ToolResultMessage];
          }
          return [
            {
              ...llmToolResult,
              content: formatAuthoringToolResultContent(
                toolResult.toolName,
                toolResult.details,
              ),
            },
          ];
        }

        if (stripped.role === "user" || stripped.role === "assistant") {
          return [stripped as Message];
        }

        return [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function sanitizeAgentMessages(messages: unknown): AgentMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return stripProviderRuntimeMetadata(
    messages.filter((message): message is AgentMessage => {
      return (
        isRecord(message) &&
        (message.role === "user" ||
          message.role === "assistant" ||
          message.role === "toolResult" ||
          message.role === "authoring")
      );
    }),
  );
}

export type { CustomAgentMessages };
