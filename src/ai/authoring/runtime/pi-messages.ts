import type {
  AgentMessage,
  CustomAgentMessages,
} from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

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

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    authoringContext: AuthoringContextAgentMessage;
    authoringNotice: AuthoringNoticeAgentMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function uiMessageText(message: AuthoringMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

function timestampFromMessage(message: AuthoringMessage): number {
  const createdAt = message.createdAt;
  if (createdAt instanceof Date) {
    return createdAt.getTime();
  }
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function authoringUiMessagesToAgentMessages(
  messages: AuthoringMessage[],
): AgentMessage[] {
  return messages.flatMap((message): AgentMessage[] => {
    const text = uiMessageText(message);
    if (!text) {
      return [];
    }

    if (message.role === "user") {
      return [
        {
          role: "user",
          content: text,
          timestamp: timestampFromMessage(message),
        } satisfies UserMessage,
      ];
    }

    if (message.role === "assistant") {
      return [
        {
          role: "assistant",
          content: [{ type: "text", text }],
          api: "unknown",
          provider: "unknown",
          model: "unknown",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: timestampFromMessage(message),
        } satisfies AssistantMessage,
      ];
    }

    return [];
  });
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

export function transformAuthoringContext(input: {
  messages: AgentMessage[];
  contextMarkdown: string;
  maxMessages?: number;
}): AgentMessage[] {
  const maxMessages = input.maxMessages ?? 40;
  const pruned = input.messages.slice(-maxMessages);
  if (!input.contextMarkdown.trim()) {
    return pruned;
  }

  return [createAuthoringContextMessage(input.contextMarkdown), ...pruned];
}

export function convertAuthoringMessagesToLlm(
  messages: AgentMessage[],
): Message[] {
  return messages.flatMap((message): Message[] => {
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
      stripped.role === "user" ||
      stripped.role === "assistant" ||
      stripped.role === "toolResult"
    ) {
      return [stripped as Message];
    }

    return [];
  });
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

export function agentMessagesToAuthoringUiMessages(
  messages: AgentMessage[],
): AuthoringMessage[] {
  const uiMessages: AuthoringMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const content = Array.isArray(message.content)
        ? message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
        : message.content;
      uiMessages.push({
        id: `u-${message.timestamp}`,
        role: "user",
        parts: [{ type: "text", text: content }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      uiMessages.push({
        id: `a-${message.timestamp}`,
        role: "assistant",
        parts: text ? [{ type: "text", text }] : [],
      });
      continue;
    }

    if (message.role === "toolResult") {
      const toolResult = message as ToolResultMessage;
      uiMessages.push({
        id: `t-${toolResult.toolCallId}`,
        role: "assistant",
        parts: [
          {
            type: `tool-${toolResult.toolName}`,
            state: toolResult.isError ? "output-error" : "output-available",
            toolCallId: toolResult.toolCallId,
            output: toolResult.details,
            ...(toolResult.isError
              ? {
                  errorText: toolResult.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n"),
                }
              : {}),
          },
        ],
      });
    }
  }

  return uiMessages;
}

export type { CustomAgentMessages };
