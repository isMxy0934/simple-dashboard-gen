import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";
import type {
  AuthoringDraftOutput,
  ApplyPatchToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringUiMessage } from "@/web/authoring/agent/types";

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
