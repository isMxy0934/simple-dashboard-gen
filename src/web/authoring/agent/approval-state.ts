import type { AuthoringDraftOutput } from "../../../ai/authoring/contracts/tool-io";

export function shouldRequestLocalPatchApproval(input: {
  latestDraftOutput: AuthoringDraftOutput | null;
  latestAppliedSuggestionId?: string | null;
  locallyResolvedSuggestionIds: Set<string>;
  currentDocumentHash?: string | null;
}) {
  const suggestionId = input.latestDraftOutput?.suggestion.id;
  if (!suggestionId) {
    return false;
  }
  const currentDocumentHash = input.currentDocumentHash?.trim() || null;
  const baseDocumentHash =
    input.latestDraftOutput?.base_document_fingerprint?.trim() || null;
  if (
    currentDocumentHash &&
    (!baseDocumentHash || baseDocumentHash !== currentDocumentHash)
  ) {
    return false;
  }

  return (
    input.latestAppliedSuggestionId !== suggestionId &&
    !input.locallyResolvedSuggestionIds.has(suggestionId)
  );
}
