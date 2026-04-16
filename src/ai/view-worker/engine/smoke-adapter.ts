import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";

function renderMessagePart(
  part: MainAgentMessage["parts"][number],
): string | null {
  if (part.type === "text") {
    const content = part.text.trim();
    return content.length > 0 ? content : null;
  }

  if (part.type === "reasoning") {
    return "[reasoning]";
  }

  if (part.type.startsWith("tool-")) {
    const toolPart = part as { type: string; state?: string };
    return `[${toolPart.type}:${toolPart.state ?? "unknown"}]`;
  }

  if (part.type.startsWith("data-")) {
    return `[${part.type}]`;
  }

  return `[${part.type}]`;
}

export function renderMainAgentMessageToText(
  message: MainAgentMessage,
): string {
  const parts = message.parts
    .map(renderMessagePart)
    .filter((value): value is string => Boolean(value));

  const body = parts.join(" ").trim();
  return `[${message.role}] ${body || "(empty)"}`;
}

export function renderMainAgentTranscriptToText(
  messages: MainAgentMessage[],
): string {
  return messages.map(renderMainAgentMessageToText).join("\n");
}
