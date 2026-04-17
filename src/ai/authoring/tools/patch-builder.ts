import type {
  Binding,
  DashboardDocument,
} from "@/contracts";
import type {
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
} from "@/ai/authoring/contracts/artifacts";
import type {
  MainAgentCheckSummary,
  MainAgentDraftOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";

export function buildPatchDetails(input: {
  dashboard: DashboardDocument;
  bindingMode?: "mock" | "live";
  runtimeCheck?: MainAgentCheckSummary;
  repair: MainAgentDraftOutput["repair"];
}) {
  const details = [
    `Prepared ${input.dashboard.dashboard_spec.views.length} view${input.dashboard.dashboard_spec.views.length === 1 ? "" : "s"} in the candidate dashboard.`,
    `Prepared ${input.dashboard.query_defs.length} query definition${input.dashboard.query_defs.length === 1 ? "" : "s"} and ${input.dashboard.bindings.length} binding${input.dashboard.bindings.length === 1 ? "" : "s"}.`,
  ];

  if (input.bindingMode) {
    details.push(`Binding mode for the candidate patch is "${input.bindingMode}".`);
  }

  if (input.runtimeCheck) {
    details.push(`Runtime check: ${input.runtimeCheck.reason}`);
  }

  if (input.repair.attempted > 0) {
    details.push(
      `${input.repair.status === "repaired" ? "Auto-repair stabilized" : "Auto-repair attempted"} in ${input.repair.attempted} round${input.repair.attempted === 1 ? "" : "s"}.`,
    );
  }

  return details;
}

export function buildPatchFromDocument(
  currentDocument: DashboardDocument,
  nextDocument: DashboardDocument,
  kind: AiSuggestionKind,
  workingDraft: WorkingDraftState,
): ContractPatch {
  const operations: ContractPatchOperation[] = [];
  const currentViews = new Map(
    currentDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const nextViews = new Map(
    nextDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const currentQueries = new Map(
    currentDocument.query_defs.map((query) => [query.id, query]),
  );
  const nextQueries = new Map(
    nextDocument.query_defs.map((query) => [query.id, query]),
  );
  const currentBindings = new Map(
    currentDocument.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindings = new Map(
    nextDocument.bindings.map((binding) => [binding.id, binding]),
  );
  const viewIds = collectRelevantPatchIds(
    currentViews,
    nextViews,
    workingDraft.dirtyViewIds,
  );

  for (const viewId of viewIds) {
    const previous = currentViews.get(viewId);
    const next = nextViews.get(viewId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "update",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Update view "${next.title}".`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Add view "${next.title}".`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Remove view "${previous.title}".`,
      });
    }
  }

  if (
    JSON.stringify(currentDocument.dashboard_spec.layout) !==
      JSON.stringify(nextDocument.dashboard_spec.layout) &&
    (workingDraft.layoutTouched ||
      operations.some((operation) => operation.path.startsWith("dashboard_spec.views.")))
  ) {
    operations.push({
      op: "update",
      path: "dashboard_spec.layout",
      summary:
        kind === "layout"
          ? "Refresh desktop/mobile layout positions for the active canvas."
          : "Adjust layout references to keep views and bindings aligned.",
    });
  }

  const queryIds = collectRelevantPatchIds(
    currentQueries,
    nextQueries,
    workingDraft.dirtyQueryIds,
  );

  for (const queryId of queryIds) {
    const previous = currentQueries.get(queryId);
    const next = nextQueries.get(queryId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "upsert",
        path: `query_defs.${queryId}`,
        summary: `Update query "${next.name}" (${queryId}).`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `query_defs.${queryId}`,
        summary: `Add query "${next.name}" (${queryId}).`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `query_defs.${queryId}`,
        summary: `Remove query "${previous.name}" (${queryId}).`,
      });
    }
  }

  const bindingIds = collectRelevantPatchIds(
    currentBindings,
    nextBindings,
    workingDraft.dirtyBindingIds,
  );

  for (const bindingId of bindingIds) {
    const previous = currentBindings.get(bindingId);
    const next = nextBindings.get(bindingId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "upsert",
        path: `bindings.${bindingId}`,
        summary: `Update binding for view "${next.view_id}".`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `bindings.${bindingId}`,
        summary: `Add binding for view "${next.view_id}".`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `bindings.${bindingId}`,
        summary: `Remove binding for view "${previous.view_id}".`,
      });
    }
  }

  const uniqueOperations = dedupePatchOperations(operations);
  return {
    summary:
      kind === "layout"
        ? `Prepare ${uniqueOperations.length} layout-side contract updates.`
        : `Prepare ${uniqueOperations.length} data-side contract updates.`,
    operations: uniqueOperations,
  };
}

function collectRelevantPatchIds<T extends { id: string }>(
  currentMap: Map<string, T>,
  nextMap: Map<string, T>,
  dirtyIds: Set<string>,
): string[] {
  if (dirtyIds.size > 0) {
    return [...dirtyIds];
  }

  return [...new Set([...currentMap.keys(), ...nextMap.keys()])];
}

function dedupePatchOperations(
  operations: ContractPatchOperation[],
): ContractPatchOperation[] {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.op}:${operation.path}:${operation.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
