import type { DashboardAgentMessage } from "@/ai/dashboard-agent/contracts/agent-contract";

function renderMessagePart(
  part: DashboardAgentMessage["parts"][number],
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

export function renderDashboardAgentMessageToText(
  message: DashboardAgentMessage,
): string {
  const parts = message.parts
    .map(renderMessagePart)
    .filter((value): value is string => Boolean(value));

  const body = parts.join(" ").trim();
  return `[${message.role}] ${body || "(empty)"}`;
}

export function renderDashboardAgentTranscriptToText(
  messages: DashboardAgentMessage[],
): string {
  return messages.map(renderDashboardAgentMessageToText).join("\n");
}
