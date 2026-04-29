import type {
  AuthoringMode,
  AuthoringScopeDecision,
  AuthoringSkillSummary,
  AuthoringToolName,
} from "@/ai/authoring/types";
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
   * Mode locked at the start of the user turn. When set, recomputed scope
   * decisions are clamped so mode / tools / prompt sections stay aligned with
   * this mode unless the turn legitimately enters approval or stop.
   */
  lockedMode?: AuthoringMode | null;
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
 * Write tools allowed in focused-view mode.
 *
 * Note the intentional asymmetries vs `WRITE_DASHBOARD_TOOLS`:
 *
 *  - `upsertView` is included but the tool impl (`buildUpsertViewTool`) force-
 *    overrides `view_id` with the focused view id and uses
 *    `assertNoFocusedLayoutMutation` to reject layout edits. In focused mode
 *    it can only mutate the currently focused view.
 *  - `deleteView` is intentionally excluded: deleting the focused view would
 *    invalidate the focused scope itself, so dashboard-level edits of that
 *    shape must be done in dashboard mode.
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

function getDefaultSections(mode: AuthoringScopeDecision["mode"]): string[] {
  switch (mode) {
    case "chat":
      return ["identity", "chat"];
    case "explore":
      return ["identity", "explore"];
    case "author-focused":
      return ["identity", "authoring", "focused"];
    case "approval":
      return ["identity", "approval"];
    default:
      return ["identity", "authoring", "dashboard"];
  }
}

function buildScopeResolution(input: {
  effectiveScope: "dashboard" | "focused";
  selectedViewId: string | null;
  scopeReason: AuthoringScopeDecision["scopeResolution"]["scope_reason"];
  requiresScopeClarification?: boolean;
}): AuthoringScopeDecision["scopeResolution"] {
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
  activeTools: AuthoringToolName[],
  history: Array<{ toolName: string; outcome: "ok" | "error" }>,
): AuthoringToolName[] {
  return activeTools.filter((name) => {
    const streak = streakTrailingFailureCount(history, name);
    return streak < TOOL_FAILURE_THRESHOLD;
  });
}

/**
 * Toolkit for a locked mode + scope. If `author-focused` is requested but
 * scope is not focused, falls back to dashboard authoring tools.
 */
function toolkitForLockedMode(
  lockedMode: AuthoringMode,
  scope: AuthoringScopeDecision["scope"],
): Pick<
  AuthoringScopeDecision,
  "mode" | "activeTools" | "toolChoice" | "systemPromptSections"
> {
  switch (lockedMode) {
    case "chat":
      return {
        mode: "chat",
        activeTools: [],
        toolChoice: "none",
        systemPromptSections: getDefaultSections("chat"),
      };
    case "explore": {
      const readTools =
        scope.kind === "focused" ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
      return {
        mode: "explore",
        activeTools: [...readTools],
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("explore"),
      };
    }
    case "approval":
      return {
        mode: "chat",
        activeTools: [],
        toolChoice: "none",
        systemPromptSections: getDefaultSections("chat"),
      };
    case "author-focused":
      if (scope.kind === "focused") {
        return {
          mode: "author-focused",
          activeTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS),
          toolChoice: "auto",
          systemPromptSections: getDefaultSections("author-focused"),
        };
      }
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
    case "author-dashboard":
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
    default:
      return {
        mode: "author-dashboard",
        activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
        toolChoice: "auto",
        systemPromptSections: getDefaultSections("author-dashboard"),
      };
  }
}

function clampToLockedMode(
  decision: AuthoringScopeDecision,
  lockedMode: AuthoringMode | null | undefined,
): AuthoringScopeDecision {
  if (!lockedMode) {
    return decision;
  }
  if (decision.mode === "approval" || decision.stopReason === "approval-applied") {
    return decision;
  }
  if (decision.mode === "chat") {
    return decision;
  }
  if (decision.mode === lockedMode) {
    return decision;
  }
  const toolkit = toolkitForLockedMode(lockedMode, decision.scope);
  return {
    ...decision,
    mode: toolkit.mode,
    activeTools: toolkit.activeTools,
    toolChoice: toolkit.toolChoice,
    systemPromptSections: toolkit.systemPromptSections,
  };
}

function computeAuthoringScopeCore(input: AuthoringScopeInput): AuthoringScopeDecision {
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
    const mode = resolvedFocusedViewId ? "author-focused" : "author-dashboard";
    return {
      mode,
      scope,
      scopeResolution: resolvedFocusedViewId
        ? focusedScopeResolution
        : dashboardScopeResolution,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections(mode),
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: "approval-applied",
    };
  }

  if (input.conversation.approvalState === "approved") {
    return {
      mode: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  const latestDraft = input.conversation.latestDraftOutput;
  const hasPendingLocalDraft = Boolean(latestDraft?.suggestion.dashboard);
  if (hasPendingLocalDraft && input.conversation.approvalState === "none") {
    return {
      mode: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
      contextBlockVariant: "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (hasPendingLocalDraft && input.conversation.approvalState === "requested") {
    return {
      mode: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
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
      mode: "chat",
      scope: { kind: "dashboard" },
      scopeResolution: dashboardScopeResolution,
      activeTools: [],
      toolChoice: "none",
      systemPromptSections: getDefaultSections("chat"),
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
    const activeTools = resolvedFocusedViewId ? READ_FOCUSED_TOOLS : READ_DASHBOARD_TOOLS;
    return {
      mode: "explore",
      scope,
      scopeResolution: resolvedFocusedViewId
        ? focusedScopeResolution
        : dashboardScopeResolution,
      activeTools: [...activeTools],
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("explore"),
      contextBlockVariant: resolvedFocusedViewId ? "focused" : "dashboard",
      relevantSkillIds,
      stopReason: null,
    };
  }

  if (resolvedFocusedViewId) {
    if (isDashboardLevelRequest(latestUserText)) {
      return {
        mode: "chat",
        scope: { kind: "focused", viewId: resolvedFocusedViewId },
        scopeResolution: buildScopeResolution({
          effectiveScope: "focused",
          selectedViewId: resolvedFocusedViewId,
          scopeReason: "blocked_dashboard_request",
          requiresScopeClarification: true,
        }),
        activeTools: [],
        toolChoice: "none",
        systemPromptSections: ["identity", "focused-scope-blocker"],
        contextBlockVariant: "focused",
        relevantSkillIds,
        stopReason: null,
      };
    }

    return {
      mode: "author-focused",
      scope: { kind: "focused", viewId: resolvedFocusedViewId },
      scopeResolution: focusedScopeResolution,
      activeTools: unionTools(READ_FOCUSED_TOOLS, WRITE_FOCUSED_TOOLS),
      toolChoice: "auto",
      systemPromptSections: getDefaultSections("author-focused"),
      contextBlockVariant: "focused",
      relevantSkillIds,
      stopReason: null,
    };
  }

  return {
    mode: "author-dashboard",
    scope: { kind: "dashboard" },
    scopeResolution: dashboardScopeResolution,
    activeTools: unionTools(READ_DASHBOARD_TOOLS, WRITE_DASHBOARD_TOOLS),
    toolChoice: "auto",
    systemPromptSections: getDefaultSections("author-dashboard"),
    contextBlockVariant: "dashboard",
    relevantSkillIds,
    stopReason: null,
  };
}

export function computeAuthoringScope(input: AuthoringScopeInput): AuthoringScopeDecision {
  const raw = computeAuthoringScopeCore(input);
  const clamped = clampToLockedMode(raw, input.lockedMode);
  return {
    ...clamped,
    activeTools: filterToolFailures(clamped.activeTools, input.stepHistoryInTurn),
  };
}
