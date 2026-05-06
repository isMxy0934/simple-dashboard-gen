import type {
  AgentEvent,
  AgentMessage,
} from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { AuthoringUiMessage } from "@/web/authoring/agent/types";
import { finalizeIncompleteToolCalls } from "@/web/authoring/agent/incomplete-tools";

function createUiMessageId(prefix: string, seed?: string | number) {
  if (seed !== undefined && seed !== null) {
    return `${prefix}_${String(seed).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneUiMessages(messages: AuthoringUiMessage[]): AuthoringUiMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => ({ ...part })),
  }));
}

function findLastAssistantMessage(messages: AuthoringUiMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages[index];
    }
  }
  const assistant: AuthoringUiMessage = {
    id: createUiMessageId("a"),
    role: "assistant",
    parts: [],
  };
  messages.push(assistant);
  return assistant;
}

function assistantText(message: AssistantMessage): {
  text: string;
  thinking: string;
  errorText: string;
} {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const thinking = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("");
  const errorText =
    typeof message.errorMessage === "string" && message.errorMessage.trim()
      ? `智能体异常\n${message.errorMessage.trim()}`
      : "";
  return { text, thinking, errorText };
}

function upsertAssistantText(
  uiMessages: AuthoringUiMessage[],
  assistant: AssistantMessage,
) {
  const message = findLastAssistantMessage(uiMessages);
  const { text, thinking, errorText } = assistantText(assistant);
  const nonText = message.parts.filter(
    (part) => part.type !== "text" && part.type !== "reasoning",
  );
  message.parts = [
    ...(thinking ? [{ type: "reasoning" as const, text: thinking }] : []),
    ...(text || errorText ? [{ type: "text" as const, text: text || errorText }] : []),
    ...nonText,
  ];
}

function upsertToolPart(
  uiMessages: AuthoringUiMessage[],
  input: {
    toolCallId: string;
    toolName: string;
    state: string;
    args?: unknown;
    output?: unknown;
    errorText?: string;
  },
) {
  const message = findLastAssistantMessage(uiMessages);
  const type = `tool-${input.toolName}` as const;
  const existingIndex = message.parts.findIndex(
    (part) =>
      part.type === type &&
      "toolCallId" in part &&
      part.toolCallId === input.toolCallId,
  );
  const part = {
    type,
    state: input.state,
    toolCallId: input.toolCallId,
    ...(input.args !== undefined ? { input: input.args } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    ...(input.errorText ? { errorText: input.errorText } : {}),
  };

  if (existingIndex >= 0) {
    message.parts[existingIndex] = {
      ...message.parts[existingIndex],
      ...part,
    };
    return;
  }

  message.parts.push(part);
}

function toolResultErrorText(result: ToolResultMessage): string | undefined {
  if (!result.isError) {
    return undefined;
  }
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function upsertToolResultMessagePart(
  uiMessages: AuthoringUiMessage[],
  result: ToolResultMessage,
) {
  upsertToolPart(uiMessages, {
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    state: result.isError ? "output-error" : "output-available",
    output: result.details,
    errorText: toolResultErrorText(result),
  });
}

function userMessageContent(message: AgentMessage): string {
  if (message.role !== "user") {
    return "";
  }
  return Array.isArray(message.content)
    ? message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    : message.content;
}

export function projectAgentMessagesToUiMessages(
  messages: AgentMessage[],
): AuthoringUiMessage[] {
  const uiMessages: AuthoringUiMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = userMessageContent(message);
      if (content.trim()) {
        uiMessages.push({
          id: createUiMessageId("u", message.timestamp),
          role: "user",
          parts: [{ type: "text", text: content }],
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const { text, thinking, errorText } = assistantText(message);
      const parts: AuthoringUiMessage["parts"] = [
        ...(thinking ? [{ type: "reasoning" as const, text: thinking }] : []),
        ...(text || errorText
          ? [{ type: "text" as const, text: text || errorText }]
          : []),
      ];
      if (parts.length) {
        uiMessages.push({
          id: createUiMessageId("a", message.timestamp),
          role: "assistant",
          parts,
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const result = message as ToolResultMessage;
      upsertToolResultMessagePart(uiMessages, result);
    }
  }
  return uiMessages;
}

export function reduceAgentEventToUiMessages(
  messages: AuthoringUiMessage[],
  event: AgentEvent,
): AuthoringUiMessage[] {
  const uiMessages = cloneUiMessages(messages);

  if (event.type === "message_start" && event.message.role === "assistant") {
    uiMessages.push({
      id: createUiMessageId("a"),
      role: "assistant",
      parts: [],
    });
    upsertAssistantText(uiMessages, event.message);
    return uiMessages;
  }

  if (event.type === "message_end" && event.message.role === "user") {
    const content = userMessageContent(event.message);
    if (content.trim()) {
      uiMessages.push({
        id: createUiMessageId("u", event.message.timestamp),
        role: "user",
        parts: [{ type: "text", text: content }],
      });
    }
    return uiMessages;
  }

  if (
    (event.type === "message_update" || event.type === "message_end") &&
    event.message.role === "assistant"
  ) {
    upsertAssistantText(uiMessages, event.message);
    return uiMessages;
  }

  if (event.type === "tool_execution_start") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: "input-available",
      args: event.args,
    });
    return uiMessages;
  }

  if (event.type === "tool_execution_update") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: "input-available",
      args: event.args,
      output: event.partialResult?.details ?? event.partialResult,
    });
    return uiMessages;
  }

  if (event.type === "tool_execution_end") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: event.isError ? "output-error" : "output-available",
      output: event.result?.details ?? event.result,
      errorText: event.isError
        ? String(
            event.result?.content
              ?.filter((part: { type: string }) => part.type === "text")
              .map((part: { text: string }) => part.text)
              .join("\n") || "Tool execution failed.",
          )
        : undefined,
    });
    return uiMessages;
  }

  if (event.type === "message_end" && event.message.role === "toolResult") {
    const result = event.message as ToolResultMessage;
    upsertToolResultMessagePart(uiMessages, result);
    return uiMessages;
  }

  if (event.type === "agent_end") {
    const lastMessage = event.messages[event.messages.length - 1];
    if (
      lastMessage?.role === "assistant" &&
      typeof lastMessage.errorMessage === "string" &&
      lastMessage.errorMessage.trim()
    ) {
      const lastUiMessage = uiMessages[uiMessages.length - 1];
      const hasRenderableAssistant =
        lastUiMessage?.role === "assistant" &&
        lastUiMessage.parts.some(
          (part) =>
            part.type === "text" ||
            part.type === "reasoning" ||
            part.type.startsWith("tool-"),
        );
      if (!hasRenderableAssistant) {
        uiMessages.push({
          id: createUiMessageId("a"),
          role: "assistant",
          parts: [],
        });
      }
      upsertAssistantText(uiMessages, lastMessage);
    }
    return finalizeIncompleteToolCalls(uiMessages);
  }

  return uiMessages;
}
