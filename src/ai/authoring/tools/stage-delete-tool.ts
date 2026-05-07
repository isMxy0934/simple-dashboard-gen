import { createHash } from "node:crypto";
import type { DashboardDocument } from "@/contracts";
import type {
  DraftStatusToolOutput,
  StageDeleteToolInput,
  StageDeleteToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { MutationDescriptor } from "@/ai/authoring/contracts/mutations";
import { tool } from "@/ai/authoring/tools/definition";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import { assertFocusedViewAccess } from "@/ai/authoring/tools/focused-guards";
import { resolveRequiredView } from "@/ai/authoring/tools/detail-builders";
import {
  removeBindingFromDocument,
  removeQueryFromDocument,
  removeViewFromDocument,
} from "@/domain/dashboard/document";
import { z } from "zod";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export function buildStageDeleteTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
  buildDraftStatus: () => DraftStatusToolOutput;
}) {
  return tool({
    description:
      "Stage one delete transaction for a view, query, or binding. The runtime removes dependent bindings atomically and returns blockers instead of leaving partial deletion drafts.",
    inputSchema: z.object({
      reason: z.string().optional(),
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("view"), view_id: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("query"), query_id: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("binding"), binding_id: z.string().min(1) }).strict(),
      ]),
    }).strict(),
    execute: async (toolInput: StageDeleteToolInput): Promise<StageDeleteToolOutput> => {
      const target = toolInput.target;
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(document);
      let nextDocument = document;
      const removedViewIds: string[] = [];
      const removedQueryIds: string[] = [];
      const removedBindingIds: string[] = [];
      let summary = "";

      if (target.kind === "view") {
        if (input.focusedViewId) {
          throw new Error(
            "View deletion is dashboard-level work. Clear the selected card and retry from dashboard scope.",
          );
        }
        assertFocusedViewAccess({
          focusedViewId: input.focusedViewId,
          requestedViewId: target.view_id,
          action: "View deletion",
        });
        const view = resolveRequiredView(document, target.view_id);
        removedViewIds.push(view.id);
        removedBindingIds.push(
          ...document.bindings
            .filter((binding) => binding.view_id === view.id)
            .map((binding) => binding.id),
        );
        nextDocument = removeViewFromDocument(document, view.id);
        summary = `Staged deletion for view "${view.title}".`;
        input.recordMutation({ kind: "view-delete", view_id: view.id });
      }

      if (target.kind === "query") {
        const queryId = target.query_id;
        const query = document.query_defs.find((candidate) => candidate.id === queryId);
        if (!query) {
          throw new Error(`Query "${queryId}" was not found.`);
        }
        const affectedBindings = document.bindings.filter((binding) => binding.query_id === query.id);
        if (
          input.focusedViewId &&
          affectedBindings.some((binding) => binding.view_id !== input.focusedViewId)
        ) {
          throw new Error(`Query "${query.id}" is not scoped to "${input.focusedViewId}".`);
        }
        removedQueryIds.push(query.id);
        removedBindingIds.push(...affectedBindings.map((binding) => binding.id));
        nextDocument = removeQueryFromDocument(document, query.id);
        summary = `Staged deletion for query "${query.name}".`;
        input.recordMutation({
          kind: "query-delete",
          query_id: query.id,
          affected_view_ids: affectedBindings.map((binding) => binding.view_id),
        });
      }

      if (target.kind === "binding") {
        const bindingId = target.binding_id;
        const binding = document.bindings.find((candidate) => candidate.id === bindingId);
        if (!binding) {
          throw new Error(`Binding "${bindingId}" was not found.`);
        }
        assertFocusedViewAccess({
          focusedViewId: input.focusedViewId,
          requestedViewId: binding.view_id,
          action: "Binding deletion",
        });
        removedBindingIds.push(binding.id);
        nextDocument = removeBindingFromDocument(document, binding.id);
        summary = `Staged deletion for binding "${binding.id}".`;
        input.recordMutation({
          kind: "binding-delete",
          binding_id: binding.id,
          view_id: binding.view_id,
        });
      }

      if (beforeFingerprint === input.buildDocumentFingerprint(nextDocument)) {
        throw new Error("No delete transaction was staged.");
      }

      if (removedViewIds.length > 0) {
        input.workingDraft.dashboardSpec = cloneDashboardSpec(nextDocument.dashboard_spec);
        input.workingDraft.layoutTouched = true;
        removedViewIds.forEach((viewId) => input.workingDraft.dirtyViewIds.add(viewId));
      }
      if (removedQueryIds.length > 0) {
        input.workingDraft.queryDefs = nextDocument.query_defs.map(cloneQuery);
        removedQueryIds.forEach((queryId) => input.workingDraft.dirtyQueryIds.add(queryId));
      }
      if (removedBindingIds.length > 0) {
        input.workingDraft.bindings = nextDocument.bindings.map(cloneBinding);
        removedBindingIds.forEach((bindingId) => input.workingDraft.dirtyBindingIds.add(bindingId));
      }
      input.markWorkingDraftUpdated();

      const transactionId = `txn_delete_${stableHash(JSON.stringify(toolInput.target))}`;
      return {
        summary,
        transaction_id: transactionId,
        stage: "staged",
        target: toolInput.target,
        artifact_ids: {
          removed_view_ids: removedViewIds,
          removed_query_ids: removedQueryIds,
          removed_binding_ids: removedBindingIds,
        },
        blockers: [],
        draft_status: input.buildDraftStatus(),
      };
    },
  });
}
