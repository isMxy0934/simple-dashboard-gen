import type { AuthoringDraftOutput } from "../../../ai/authoring/contracts/tool-io";

export function shouldRequestLocalPatchApproval(input: {
  latestDraftOutput: AuthoringDraftOutput | null;
  latestAppliedSuggestionId?: string | null;
  locallyResolvedSuggestionIds: Set<string>;
  currentDocumentHash?: string | null;
}) {
  const latestDraftOutput = input.latestDraftOutput;
  const suggestionId = latestDraftOutput?.suggestion.id;
  if (!suggestionId) {
    return false;
  }
  if (
    !latestDraftOutput ||
    typeof latestDraftOutput.expires_at !== "number" ||
    latestDraftOutput.expires_at <= Date.now()
  ) {
    return false;
  }
  const currentDocumentHash = input.currentDocumentHash?.trim() || null;
  const baseDocumentHash =
    latestDraftOutput.base_document_fingerprint?.trim() || null;
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
