import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

export interface AuthoringMessageOutlineEntry {
  id: string;
  role: string;
  parts: string[];
}

function summarizePart(part: AuthoringMessage["parts"][number]): string {
  if (part.type === "text") {
    const raw = part.text.trim().replace(/\s+/g, " ");
    const cap = 160;
    return raw.length <= cap
      ? `text:${raw || "(empty)"}`
      : `text:${raw.slice(0, cap)}…`;
  }
  if (part.type === "reasoning") {
    return "reasoning";
  }
  if (part.type.startsWith("tool-")) {
    const toolPart = part as { type: string; state?: string };
    return `${toolPart.type}[${toolPart.state ?? "?"}]`;
  }
  if (part.type.startsWith("data-")) {
    return part.type;
  }
  return part.type;
}

export function outlineAuthoringMessages(
  messages: AuthoringMessage[],
): AuthoringMessageOutlineEntry[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map(summarizePart),
  }));
}

export const outlineMainAgentMessages = outlineAuthoringMessages;
