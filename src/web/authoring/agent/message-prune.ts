import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";
import type {
  AuthoringDraftOutput,
  ApplyPatchToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringUiMessage } from "@/web/authoring/agent/types";

function deepCloneMessages(messages: AuthoringUiMessage[]): AuthoringUiMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AuthoringUiMessage[];
}

/**
 * Removes duplicate full-dashboard snapshots from chat history before POSTing to the agent API.
 * Keeps only the latest composePatch dashboard (for edge cases where apply references it);
 * strips every applyPatch output dashboard (current canvas is sent separately on the request body).
 */
export function redactHeavyDashboardSnapshotsForTransport(
  messages: AuthoringUiMessage[],
): AuthoringUiMessage[] {
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
        const out = p.output as AuthoringDraftOutput;
        if (out.suggestion?.dashboard) {
          composeSlots.push({ mi, pi });
        }
      }
    }
  }

  for (let i = 0; i < composeSlots.length - 1; i++) {
    const { mi, pi } = composeSlots[i];
    const part = next[mi].parts[pi] as { output: AuthoringDraftOutput };
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

export function pruneResolvedPatchProposalPayloads(
  messages: AuthoringUiMessage[],
  options:
    | { mode: "matching"; suggestionId: string }
    | { mode: "all_unresolved" },
): AuthoringUiMessage[] {
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
        const out = p.output as AuthoringDraftOutput;
        const shouldPrune =
          options.mode === "all_unresolved" ||
          out.suggestion?.id === options.suggestionId;
        if (shouldPrune && out.suggestion?.dashboard) {
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
        if (
          options.mode === "matching" &&
          out.suggestion_id === options.suggestionId &&
          out.dashboard
        ) {
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

/** After a patch is applied locally, drop the matching tool payloads to shrink React state and persistence. */
export function pruneToolDashboardsAfterAppliedPatch(
  messages: AuthoringUiMessage[],
  appliedSuggestionId: string,
): AuthoringUiMessage[] {
  return pruneResolvedPatchProposalPayloads(messages, {
    mode: "matching",
    suggestionId: appliedSuggestionId,
  });
}
