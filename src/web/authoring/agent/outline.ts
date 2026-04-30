import type { AuthoringUiMessage } from "@/web/authoring/agent/types";

export interface AuthoringUiMessageOutlineEntry {
  id: string;
  role: string;
  parts: string[];
}

function summarizePart(part: AuthoringUiMessage["parts"][number]): string {
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

export function outlineAuthoringUiMessages(
  messages: AuthoringUiMessage[],
): AuthoringUiMessageOutlineEntry[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: (Array.isArray(message.parts) ? message.parts : []).map(summarizePart),
  }));
}
