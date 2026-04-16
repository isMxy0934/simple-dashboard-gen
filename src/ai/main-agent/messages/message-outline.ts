import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";

/** Compact per-message summary for session logs (not for LLM). */
export interface MainAgentMessageOutlineEntry {
  id: string;
  role: string;
  parts: string[];
}

function summarizePart(part: MainAgentMessage["parts"][number]): string {
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
    const t = part as { type: string; state?: string };
    return `${t.type}[${t.state ?? "?"}]`;
  }
  if (part.type.startsWith("data-")) {
    return part.type;
  }
  return part.type;
}

export function outlineMainAgentMessages(
  messages: MainAgentMessage[],
): MainAgentMessageOutlineEntry[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts.map(summarizePart),
  }));
}
