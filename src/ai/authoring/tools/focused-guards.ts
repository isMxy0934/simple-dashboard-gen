import type {
  Binding,
  DashboardLayoutMap,
  QueryDef,
} from "@/contracts";
import type { ContractPatch } from "@/ai/authoring/contracts/artifacts";
import { AuthoringToolGateError } from "@/ai/authoring/contracts/errors";

export function assertFocusedViewAccess(input: {
  focusedViewId: string | null;
  requestedViewId: string | null | undefined;
  action: string;
}) {
  if (
    input.focusedViewId &&
    input.requestedViewId &&
    input.requestedViewId !== input.focusedViewId
  ) {
    throw new Error(
      `${input.action} is restricted to "${input.focusedViewId}".`,
    );
  }
}

export function resolveScopedViewId(input: {
  focusedViewId: string | null;
  requestedViewId?: string | null;
}) {
  return input.requestedViewId ?? input.focusedViewId ?? "";
}

export function assertNoFocusedLayoutMutation(input: {
  focusedViewId: string | null;
  hasLayoutChange: boolean;
}) {
  if (input.focusedViewId && input.hasLayoutChange) {
    throw new Error("View worker cannot modify layout.");
  }
}

function layoutItemsByView(layout: DashboardLayoutMap | undefined) {
  const items = new Map<string, string>();
  for (const [breakpoint, breakpointLayout] of Object.entries(layout ?? {})) {
    for (const item of breakpointLayout?.items ?? []) {
      items.set(`${breakpoint}:${item.view_id}`, JSON.stringify(item));
    }
  }
  return items;
}

function changedLayoutViewIds(input: {
  before: DashboardLayoutMap;
  after: DashboardLayoutMap;
}): string[] {
  const beforeItems = layoutItemsByView(input.before);
  const afterItems = layoutItemsByView(input.after);
  const keys = new Set([...beforeItems.keys(), ...afterItems.keys()]);
  const viewIds = new Set<string>();
  for (const key of keys) {
    if (beforeItems.get(key) === afterItems.get(key)) {
      continue;
    }
    const [, viewId] = key.split(":");
    if (viewId) {
      viewIds.add(viewId);
    }
  }
  return [...viewIds];
}

function queryIdsForFocusedView(input: {
  focusedViewId: string;
  beforeBindings: Binding[];
  afterBindings: Binding[];
}): Set<string> {
  return new Set(
    [...input.beforeBindings, ...input.afterBindings]
      .filter((binding) => binding.view_id === input.focusedViewId)
      .map((binding) => binding.query_id)
      .filter((queryId): queryId is string => Boolean(queryId)),
  );
}

function bindingIdsForFocusedView(input: {
  focusedViewId: string;
  beforeBindings: Binding[];
  afterBindings: Binding[];
}): Set<string> {
  return new Set(
    [...input.beforeBindings, ...input.afterBindings]
      .filter((binding) => binding.view_id === input.focusedViewId)
      .map((binding) => binding.id),
  );
}

function bindingTouchesNonFocusedView(input: {
  bindingId: string;
  focusedViewId: string;
  beforeBindings: Binding[];
  afterBindings: Binding[];
}): boolean {
  return [...input.beforeBindings, ...input.afterBindings]
    .filter((binding) => binding.id === input.bindingId)
    .some((binding) => binding.view_id !== input.focusedViewId);
}

function queryUsedByNonFocusedView(input: {
  queryId: string;
  focusedViewId: string;
  beforeBindings: Binding[];
  afterBindings: Binding[];
}): boolean {
  return [...input.beforeBindings, ...input.afterBindings].some(
    (binding) =>
      binding.query_id === input.queryId &&
      binding.view_id !== input.focusedViewId,
  );
}

function existingQueryIds(queries: QueryDef[]): Set<string> {
  return new Set(queries.map((query) => query.id));
}

function pathId(path: string, prefix: string): string | null {
  return path.startsWith(prefix) ? path.slice(prefix.length) || null : null;
}

export function assertFocusedPatchBoundary(input: {
  focusedViewId: string | null;
  patch: ContractPatch;
  before: {
    layout: DashboardLayoutMap;
    bindings: Binding[];
    queries: QueryDef[];
  };
  after: {
    layout: DashboardLayoutMap;
    bindings: Binding[];
    queries: QueryDef[];
  };
}) {
  if (!input.focusedViewId) {
    return;
  }

  const focusedQueryIds = queryIdsForFocusedView({
    focusedViewId: input.focusedViewId,
    beforeBindings: input.before.bindings,
    afterBindings: input.after.bindings,
  });
  const focusedBindingIds = bindingIdsForFocusedView({
    focusedViewId: input.focusedViewId,
    beforeBindings: input.before.bindings,
    afterBindings: input.after.bindings,
  });
  const beforeQueryIds = existingQueryIds(input.before.queries);

  for (const operation of input.patch.operations) {
    const viewId = pathId(operation.path, "dashboard_spec.views.");
    if (viewId && viewId !== input.focusedViewId) {
      throw new AuthoringToolGateError({
        code: "scope_violation",
        userSafeSummary: `composePatch is restricted to the focused view "${input.focusedViewId}".`,
        recoveryHint:
          "Clear the selected card before composing a dashboard-level proposal.",
        retryable: false,
      });
    }

    const bindingId = pathId(operation.path, "bindings.");
    if (
      bindingId &&
      (!focusedBindingIds.has(bindingId) ||
        bindingTouchesNonFocusedView({
          bindingId,
          focusedViewId: input.focusedViewId,
          beforeBindings: input.before.bindings,
          afterBindings: input.after.bindings,
        }))
    ) {
      throw new AuthoringToolGateError({
        code: "scope_violation",
        userSafeSummary: `composePatch cannot include binding "${bindingId}" outside the focused view.`,
        recoveryHint:
          "Restrict staged bindings to the selected card before composing.",
        retryable: false,
      });
    }

    const queryId = pathId(operation.path, "query_defs.");
    if (
      queryId &&
      beforeQueryIds.has(queryId) &&
      !focusedQueryIds.has(queryId)
    ) {
      throw new AuthoringToolGateError({
        code: "scope_violation",
        userSafeSummary: `composePatch cannot modify query "${queryId}" outside the focused view.`,
        recoveryHint:
          "Use a query owned by the selected card, or clear the selected card for dashboard-level edits.",
        retryable: false,
      });
    }
    if (
      queryId &&
      queryUsedByNonFocusedView({
        queryId,
        focusedViewId: input.focusedViewId,
        beforeBindings: input.before.bindings,
        afterBindings: input.after.bindings,
      })
    ) {
      throw new AuthoringToolGateError({
        code: "scope_violation",
        userSafeSummary: `composePatch cannot modify shared query "${queryId}" while focused on "${input.focusedViewId}".`,
        recoveryHint:
          "Use a focused-view query id or clear the selected card for shared query edits.",
        retryable: false,
      });
    }

    if (operation.path === "dashboard_spec.layout") {
      const changedViewIds = changedLayoutViewIds({
        before: input.before.layout,
        after: input.after.layout,
      });
      const outsideViewId = changedViewIds.find(
        (changedViewId) => changedViewId !== input.focusedViewId,
      );
      if (outsideViewId) {
        throw new AuthoringToolGateError({
          code: "scope_violation",
          userSafeSummary: `composePatch cannot include layout changes for "${outsideViewId}" while focused on "${input.focusedViewId}".`,
          recoveryHint:
            "Restrict layout changes to the selected card before composing.",
          retryable: false,
        });
      }
    }
  }
}
