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
import type { AuthoringConversationSignals } from "@/ai/authoring/runtime/transcript-inspection";
import {
  getAuthorToolNamesForScope,
  getReadToolNamesForScope,
} from "@/ai/authoring/tools/registry";

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
   * forwarding a UI-declared intent). This only selects a coarse tool mode.
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

/** Resolves explicit UI intent for coarse capability selection. */
export function resolveAuthoringIntent(
  _latestUserText: string,
  explicitIntent?: AuthoringIntent | null,
): AuthoringIntent {
  return explicitIntent ?? "explore";
}

function unionTools(...groups: readonly AuthoringToolName[][]): AuthoringToolName[] {
  return [...new Set(groups.flatMap((group) => group))];
}

function readToolsForScope(scope: "dashboard" | "focused"): AuthoringToolName[] {
  return getReadToolNamesForScope(scope);
}

function authoringToolsForScope(scope: "dashboard" | "focused"): AuthoringToolName[] {
  return getAuthorToolNamesForScope(scope);
}

function authorToolsForScope(scope: "dashboard" | "focused"): AuthoringToolName[] {
  return unionTools(readToolsForScope(scope), authoringToolsForScope(scope));
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

/**
 * Quick keyword check for whether the user's message suggests dashboard-level
 * work (new cards, layout changes) rather than edits to a focused view.
 *
 * Keep this conservative: it only blocks focused edits when the text clearly
 * asks for dashboard-level work.
 */
const DASHBOARD_LEVEL_ACTION_KEYWORDS = /\b(add|create|new|another)\b/i;
const DASHBOARD_LEVEL_OBJECT_KEYWORDS = /\b(card|chart|view|dashboard|report)\b/i;
const DASHBOARD_LEVEL_SCOPE_KEYWORDS = /\b(dashboard|whole|entire|all cards|layout)\b/i;
const DASHBOARD_LEVEL_ACTION_KEYWORDS_ZH = /(新增|添加|创建|生成|加一个|再加|新建)/;
const DASHBOARD_LEVEL_OBJECT_KEYWORDS_ZH = /(卡片|图表|视图|看板|仪表盘|报表)/;
const DASHBOARD_LEVEL_SCOPE_KEYWORDS_ZH = /(整个|全部|所有|全局|看板|仪表盘|布局)/;

function containsDashboardLevelKeywords(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const requestsNewCard =
    DASHBOARD_LEVEL_ACTION_KEYWORDS.test(normalized) &&
    DASHBOARD_LEVEL_OBJECT_KEYWORDS.test(normalized);
  const requestsDashboardChange =
    DASHBOARD_LEVEL_SCOPE_KEYWORDS.test(normalized) ||
    DASHBOARD_LEVEL_SCOPE_KEYWORDS_ZH.test(normalized);
  const requestsNewCardZh =
    DASHBOARD_LEVEL_ACTION_KEYWORDS_ZH.test(normalized) &&
    DASHBOARD_LEVEL_OBJECT_KEYWORDS_ZH.test(normalized);

  return requestsNewCard || requestsNewCardZh || requestsDashboardChange;
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
      const readTools = readToolsForScope(scope.kind === "focused" ? "focused" : "dashboard");
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
          allowedTools: authorToolsForScope("focused"),
        };
      }
      return {
        profile: "author-dashboard",
        allowedTools: authorToolsForScope("dashboard"),
      };
    case "author-dashboard":
      return {
        profile: "author-dashboard",
        allowedTools: authorToolsForScope("dashboard"),
      };
    default:
      return {
        profile: "author-dashboard",
        allowedTools: authorToolsForScope("dashboard"),
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
    const allowedTools = readToolsForScope(resolvedFocusedViewId ? "focused" : "dashboard");
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
    if (containsDashboardLevelKeywords(latestUserText)) {
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
      allowedTools: authorToolsForScope("focused"),
      contextBlockVariant: "focused",
      relevantSkillIds,
      stopReason: null,
    };
  }

  return {
    profile: "author-dashboard",
    scope: { kind: "dashboard" },
    scopeResolution: dashboardScopeResolution,
    allowedTools: authorToolsForScope("dashboard"),
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
