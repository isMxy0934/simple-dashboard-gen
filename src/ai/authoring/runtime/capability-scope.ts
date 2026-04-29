import type {
  AuthoringCapabilityProfile,
  AuthoringScopeCapabilities,
  AuthoringSkillSummary,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";
import type {
  AuthoringIntent,
  ViewListItem,
  DatasourceListItemSummary,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringConversationSignals } from "@/ai/authoring/messages/conversation-signals";

/** Consecutive tool errors at the trailing end of this tool's history before it is dropped. */
export const TOOL_FAILURE_THRESHOLD = 3;

export interface AuthoringScopeInput {
  dashboard: {
    id: string | null;
    name: string;
    views: Array<Pick<ViewListItem, "id" | "title" | "renderer_kind" | "check_status">>;
    datasources: DatasourceListItemSummary[];
    checksSummary: { ok: number; warning: number; error: number };
  };
  conversation: AuthoringConversationSignals;
  focusedViewId: string | null;
  stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
  skills: AuthoringSkillSummary[];
  /**
   * Optional explicit intent provided by the caller (e.g. the UI request
   * forwarding a UI-declared intent). V2 workflow intent resolution happens
   * outside this capability resolver.
   */
  intentSignal?: AuthoringIntent | null;
  /**
   * Capability profile locked at the start of the user turn. When set,
   * recomputed scope capabilities are clamped unless the turn legitimately
   * enters a terminal no-tool state.
   */
  lockedProfile?: AuthoringCapabilityProfile | null;
}

export type { AuthoringIntent };

/**
 * Resolves explicit UI intent for capability selection. V2 workflow routing is
 * handled by the runtime reducer and decideNextActionV2.
 */
export function resolveAuthoringIntent(
  _latestUserText: string,
  explicitIntent?: AuthoringIntent | null,
): AuthoringIntent {
  return explicitIntent ?? "author";
}

export const READ_DASHBOARD_TOOLS = [
  "getViews",
  "getView",
  "getQuery",
  "getBinding",
  "getDraftStatus",
  "getDatasources",
  "getSchemaByDatasource",
  "runCheck",
  "loadSkill",
  "loadSkillReference",
] satisfies AuthoringToolName[];

export const READ_FOCUSED_TOOLS = [
  "getView",
  "getQuery",
  "getBinding",
  "getDraftStatus",
  "getDatasources",
  "getSchemaByDatasource",
  "runCheck",
  "loadSkill",
  "loadSkillReference",
] satisfies AuthoringToolName[];

export const WRITE_DASHBOARD_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "upsertLayout",
  "deleteView",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

/**
 * Write tools allowed in focused-view scope.
 *
 * Note the intentional asymmetries vs `WRITE_DASHBOARD_TOOLS`:
 *
 *  - `upsertView` is included but the tool impl (`buildUpsertViewTool`) force-
 *    overrides `view_id` with the focused view id and uses
 *    `assertNoFocusedLayoutMutation` to reject layout edits. In focused scope
 *    it can only mutate the currently focused view.
 *  - `deleteView` is intentionally excluded: deleting the focused view would
 *    invalidate the focused scope itself, so dashboard-level edits of that
 *    shape must be done in dashboard scope.
 *  - `upsertQuery` / `upsertBinding` / `deleteQuery` / `deleteBinding` are
 *    gated by `assertFocusedViewAccess` inside each tool so cross-view writes
 *    throw.
 *
 * Keep this list consistent with the focused guards in `tools/focused-guards.ts`.
 */
export const WRITE_FOCUSED_TOOLS = [
  "upsertView",
  "upsertQuery",
  "upsertBinding",
  "upsertLayout",
  "deleteQuery",
  "deleteBinding",
] satisfies AuthoringToolName[];

function unionTools(...groups: readonly AuthoringToolName[][]): AuthoringToolName[] {
  return [...new Set(groups.flatMap((group) => group))];
}

function buildScopeResolution(input: {
  effectiveScope: "dashboard" | "focused";
  selectedViewId: string | null;
  scopeReason: AuthoringScopeCapabilities["scopeResolution"]["scope_reason"];
  requiresScopeClarification?: boolean;
}): AuthoringScopeCapabilities["scopeResolution"] {
  return {
    effective_scope: input.effectiveScope,
    selected_view_id: input.selectedViewId,
    scope_reason: input.scopeReason,
    requires_scope_clarification: Boolean(input.requiresScopeClarification),
  };
}

function isDashboardLevelRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const requestsNewCard =
    /(新增|添加|再加|创建|新建|增加|add|create|new|another)/i.test(normalized) &&
    /(卡片|图表|视图|看板|报表|一张图|一个图|card|chart|view|dashboard|report)/i.test(
      normalized,
    );
  const requestsDashboardChange =
    /(整个|全局|全部|所有|整张|整表|看板|仪表盘|dashboard|whole|entire|all cards|layout|布局|重排|重新布局|调整布局)/i.test(
      normalized,
    );

  return requestsNewCard || requestsDashboardChange;
}

function streakTrailingFailureCount(
  history: Array<{ toolName: string; outcome: "ok" | "error" }>,
  toolName: string,
): number {
  const entries = history.filter((h) => h.toolName === toolName);
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome === "error") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function filterToolFailures(
  allowedTools: AuthoringToolName[],
  history: Array<{ toolName: string; outcome: "ok" | "error" }>,
): AuthoringToolName[] {
  return allowedTools.filter((name) => {
    const streak = streakTrailingFailureCount(history, name);
    return streak < TOOL_FAILURE_THRESHOLD;
  });
}

/**
 * Capability profile for a locked turn + scope. If `author-focused` is
 * requested but scope is not focused, falls back to dashboard authoring tools.
 */
function capabilitiesForLockedProfile(
  lockedProfile: AuthoringCapabilityProfile,
  scope: AuthoringScopeCapabilities["scope"],
): Pick<AuthoringScopeCapabilities, "profile" | "allowedTools"> {
  switch (lockedProfile) {
    case "chat":
      return {
        profile: "chat",
        allowedTools: [],
      };
    case "explore": {
      const readTools =
        scope.kind === "focused" ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
      return {
        profile: "explore",
        allowedTools: [...readTools],
      };
    }
    case "approval":
      return {
        profile: "chat",
        allowedTools: [],
      };
    case "author-focused":
      if (scope.kind === "focused") {
        return {
          profile: "author-focused",
          allowedTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS),
        };
      }
      return {
        profile: "author-dashboard",
        allowedTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
      };
    case "author-dashboard":
      return {
        profile: "author-dashboard",
        allowedTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
      };
    default:
      return {
        profile: "author-dashboard",
        allowedTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
      };
  }
}

function clampToLockedProfile(
  capabilities: AuthoringScopeCapabilities,
  lockedProfile: AuthoringCapabilityProfile | null | undefined,
): AuthoringScopeCapabilities {
  if (!lockedProfile) {
    return capabilities;
  }
  if (capabilities.profile === "approval" || capabilities.stopReason === "approval-applied") {
    return capabilities;
  }
  if (capabilities.profile === "chat") {
    return capabilities;
  }
  if (capabilities.profile === lockedProfile) {
    return capabilities;
  }
  const locked = capabilitiesForLockedProfile(lockedProfile, capabilities.scope);
  return {
    ...capabilities,
    profile: locked.profile,
    allowedTools: locked.allowedTools,
  };
}

function computeAuthoringScopeCore(input: AuthoringScopeInput): AuthoringScopeCapabilities {
  const latestUserText = input.conversation.latestUserText ?? "";
  const intent = resolveAuthoringIntent(latestUserText, input.intentSignal ?? null);
  const relevantSkillIds: string[] = [];
  const selectedViewId = input.focusedViewId?.trim() || null;
  const explicitFocus =
    selectedViewId &&
    input.dashboard.views.some((view) => view.id === selectedViewId)
      ? selectedViewId
      : null;
  const resolvedFocusedViewId = explicitFocus;
  const dashboardScopeResolution = buildScopeResolution({
    effectiveScope: "dashboard",
    selectedViewId: explicitFocus ?? selectedViewId,
    scopeReason: selectedViewId && !explicitFocus ? "invalid_selection" : "no_selection",
  });
  const focusedScopeResolution = buildScopeResolution({
    effectiveScope: "focused",
    selectedViewId: resolvedFocusedViewId,
    scopeReason: "selected_view",
  });

  if (input.stepHistoryInTurn.some((step) => step.toolName === "applyPatch" && step.outcome === "ok")) {
    const scope =
      resolvedFocusedViewId
        ? ({ kind: "focused", viewId: resolvedFocusedViewId } as const)
        : ({ kind: "dashboard" } as const);
    return {
      profile: resolvedFocusedViewId ? "author-focused" : "author-dashboard",
      scope,
      scopeResolution: resolvedFocusedViewId
        ? focusedScopeResolution
        : dashboardScopeResolution,
      allowedTools: [],
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: "approval-applied",
    };
  }

  if (input.conversation.approvalState === "approved") {
    return {
      profile: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      allowedTools: [],
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  const latestDraft = input.conversation.latestDraftOutput;
  const hasPendingLocalDraft = Boolean(latestDraft?.suggestion.dashboard);
  if (hasPendingLocalDraft && input.conversation.approvalState === "none") {
    return {
      profile: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      allowedTools: [],
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (hasPendingLocalDraft && input.conversation.approvalState === "requested") {
    return {
      profile: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      allowedTools: [],
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (
    intent === "apply" ||
    intent === "cancel" ||
    intent === "ask-capability"
  ) {
    return {
      profile: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      allowedTools: [],
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (intent === "explore") {
    const scope =
      resolvedFocusedViewId
        ? ({ kind: "focused", viewId: resolvedFocusedViewId } as const)
        : ({ kind: "dashboard" } as const);
    const allowedTools = resolvedFocusedViewId ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
    return {
      profile: "explore",
      scope,
      scopeResolution: resolvedFocusedViewId
        ? focusedScopeResolution
        : dashboardScopeResolution,
      allowedTools: [...allowedTools],
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (resolvedFocusedViewId) {
    if (isDashboardLevelRequest(latestUserText)) {
      return {
        profile: "chat",
        scope: { kind: "focused", viewId: resolvedFocusedViewId },
        scopeResolution: buildScopeResolution({
          effectiveScope: "focused",
          selectedViewId: resolvedFocusedViewId,
          scopeReason: "blocked_dashboard_request",
          requiresScopeClarification: true,
        }),
        allowedTools: [],
        contextBlockVariant: "focused",
        relevantSkillIds,
        stopReason: null,
      };
    }

    return {
      profile: "author-focused",
      scope: { kind: "focused", viewId: resolvedFocusedViewId },
      scopeResolution: focusedScopeResolution,
      allowedTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS),
      contextBlockVariant: "focused",
      relevantSkillIds,
      stopReason: null,
    };
  }

  return {
    profile: "author-dashboard",
    scope: { kind: "dashboard" },
    scopeResolution: dashboardScopeResolution,
    allowedTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
    contextBlockVariant: "dashboard",
    relevantSkillIds,
    stopReason: null,
  };
}

export function computeAuthoringScope(input: AuthoringScopeInput): AuthoringScopeCapabilities {
  const raw = computeAuthoringScopeCore(input);
  const clamped = clampToLockedProfile(raw, input.lockedProfile);
  return {
    ...clamped,
    allowedTools: filterToolFailures(clamped.allowedTools, input.stepHistoryInTurn),
  };
}
