import type { AuthoringDraftOutput } from "../../../ai/authoring/contracts/tool-io";

export function shouldRequestLocalPatchApproval(input: {
  latestDraftOutput: AuthoringDraftOutput | null;
  latestAppliedSuggestionId?: string | null;
  locallyResolvedSuggestionIds: Set<string>;
}) {
  const suggestionId = input.latestDraftOutput?.suggestion.id;
  if (!suggestionId) {
    return false;
  }

  return (
    input.latestAppliedSuggestionId !== suggestionId &&
    !input.locallyResolvedSuggestionIds.has(suggestionId)
  );
}
