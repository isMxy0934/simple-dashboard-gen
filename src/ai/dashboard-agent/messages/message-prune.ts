import type { AiSuggestion } from "@/ai/dashboard-agent/tools/artifacts";
import type {
  DashboardAgentDraftOutput,
  ApplyPatchToolOutput,
  DashboardAgentMessage,
} from "@/ai/dashboard-agent/contracts/agent-contract";

function deepCloneMessages(messages: DashboardAgentMessage[]): DashboardAgentMessage[] {
  return JSON.parse(JSON.stringify(messages)) as DashboardAgentMessage[];
}

/**
 * Removes duplicate full-dashboard snapshots from chat history before POSTing to the agent API.
 * Keeps only the latest composePatch dashboard (for edge cases where apply references it);
 * strips every applyPatch output dashboard (current canvas is sent separately on the request body).
 */
export function redactHeavyDashboardSnapshotsForTransport(
  messages: DashboardAgentMessage[],
): DashboardAgentMessage[] {
  const next = deepCloneMessages(messages);
  const composeSlots: Array<{ mi: number; pi: number }> = [];

  for (let mi = 0; mi < next.length; mi++) {
    const m = next[mi];
    if (m.role !== "assistant") {
      continue;
    }
    for (let pi = 0; pi < m.parts.length; pi++) {
      const p = m.parts[pi];
      if (
        p.type === "tool-composePatch" &&
        p.state === "output-available" &&
        p.output &&
        typeof p.output === "object" &&
        "suggestion" in p.output
      ) {
        const out = p.output as DashboardAgentDraftOutput;
        if (out.suggestion?.dashboard) {
          composeSlots.push({ mi, pi });
        }
      }
    }
  }

  for (let i = 0; i < composeSlots.length - 1; i++) {
    const { mi, pi } = composeSlots[i];
    const part = next[mi].parts[pi] as { output: DashboardAgentDraftOutput };
    const out = part.output;
    part.output = {
      ...out,
      suggestion: {
        ...out.suggestion,
        dashboard: undefined,
      } as AiSuggestion,
    };
  }

  for (let mi = 0; mi < next.length; mi++) {
    const m = next[mi];
    if (m.role !== "assistant") {
      continue;
    }
    m.parts = m.parts.map((p) => {
      if (
        p.type === "tool-applyPatch" &&
        p.state === "output-available" &&
        p.output &&
        typeof p.output === "object" &&
        "dashboard" in p.output
      ) {
        const o = p.output as ApplyPatchToolOutput;
        if (o.dashboard) {
          return {
            ...p,
            output: { ...o, dashboard: undefined },
          };
        }
      }
      return p;
    });
  }

  return next;
}

/** After a patch is applied locally, drop the matching tool payloads to shrink React state and persistence. */
export function pruneToolDashboardsAfterAppliedPatch(
  messages: DashboardAgentMessage[],
  appliedSuggestionId: string,
): DashboardAgentMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") {
      return m;
    }
    const parts = m.parts.map((p) => {
      if (
        p.type === "tool-composePatch" &&
        p.state === "output-available" &&
        p.output &&
        typeof p.output === "object" &&
        "suggestion" in p.output
      ) {
        const out = p.output as DashboardAgentDraftOutput;
        if (out.suggestion?.id === appliedSuggestionId && out.suggestion.dashboard) {
          return {
            ...p,
            output: {
              ...out,
              suggestion: {
                ...out.suggestion,
                dashboard: undefined,
              } as AiSuggestion,
            },
          };
        }
      }
      if (
        p.type === "tool-applyPatch" &&
        p.state === "output-available" &&
        p.output &&
        typeof p.output === "object" &&
        "suggestion_id" in p.output
      ) {
        const out = p.output as ApplyPatchToolOutput;
        if (out.suggestion_id === appliedSuggestionId && out.dashboard) {
          return {
            ...p,
            output: { ...out, dashboard: undefined },
          };
        }
      }
      return p;
    });
    return { ...m, parts };
  });
}
