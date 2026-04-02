import type { DashboardAgentMessage } from "@/agent/dashboard-agent/contracts/agent-contract";

/** Compact per-message summary for debug logs (not for LLM). */
export interface DashboardAgentMessageOutlineEntry {
  id: string;
  role: string;
  parts: string[];
}

function summarizePart(part: DashboardAgentMessage["parts"][number]): string {
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

export function outlineDashboardAgentMessages(
  messages: DashboardAgentMessage[],
): DashboardAgentMessageOutlineEntry[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts.map(summarizePart),
  }));
}
