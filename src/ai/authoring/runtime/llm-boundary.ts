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
    const pruned = input.messages.slice(-maxMessages);
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
    return messages.flatMap((message): Message[] => {
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
