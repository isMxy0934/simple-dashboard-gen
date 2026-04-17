import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildFocusedViewSummary,
  buildPromptViewStateSummary,
  buildWorkerPromptSummary,
  summarizeDatasourceList,
} from "@/ai/authoring/context/context-summary";
import { buildAuthoringContextFingerprint } from "@/ai/authoring/context/fingerprint";

/**
 * Soft cap on how many views we expand inline in the context block.
 * Beyond this, non-focused views are truncated to id+title only and the
 * model is told to use `getView` for details. Keeps the per-turn system
 * payload bounded for large dashboards.
 */
const MAX_INLINE_VIEWS = 20;

interface ViewStateLike {
  view_count: number;
  views?: Array<Record<string, unknown>>;
  canvas_focus_active?: boolean;
  focused_view_id?: string;
  agent_scope_note?: string;
  other_views_peer_reference?: Array<{ id: string; title: string }>;
}

function capViewState(viewState: ViewStateLike): {
  payload: ViewStateLike & { truncated?: boolean; hidden_view_count?: number };
  truncated: boolean;
} {
  const views = viewState.views ?? [];
  if (views.length <= MAX_INLINE_VIEWS) {
    return { payload: viewState, truncated: false };
  }

  const keptViews = views.slice(0, MAX_INLINE_VIEWS);
  const droppedViews = views.slice(MAX_INLINE_VIEWS);
  const hiddenPeers = droppedViews.map((view) => ({
    id: String(view.id ?? ""),
    title: String(view.title ?? ""),
  }));

  const existingPeers = viewState.other_views_peer_reference ?? [];
  return {
    payload: {
      ...viewState,
      views: keptViews,
      other_views_peer_reference: [...existingPeers, ...hiddenPeers],
      truncated: true,
      hidden_view_count: droppedViews.length,
    },
    truncated: true,
  };
}

export function buildAuthoringContextBlock(input: {
  variant: "dashboard" | "focused" | "empty";
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  proposalSummary?: {
    proposal_id: string;
    summary: string;
    operation_count: number;
  } | null;
}): { markdown: string; fingerprint: string } {
  const dashboardSummary = buildWorkerPromptSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
  });
  const rawViewState = buildPromptViewStateSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
    focusedViewId: input.variant === "focused" ? input.focusedViewId : undefined,
  });
  const { payload: viewState, truncated: viewsTruncated } = capViewState(
    rawViewState as ViewStateLike,
  );
  const focusedView =
    input.variant === "focused"
      ? buildFocusedViewSummary({
          document: input.dashboard,
          focusedViewId: input.focusedViewId,
          checks: input.checks,
        })
      : null;
  const datasources = summarizeDatasourceList(input.datasources);

  const payload = {
    variant: input.variant,
    dashboardSummary,
    viewState,
    focusedView,
    datasources,
    proposalSummary: input.proposalSummary ?? null,
  };

  // Compact JSON (no indentation) to keep token footprint small; the model
  // reads it as-is and can parse either form.
  const markdown = [
    `<!-- authoring-context:fp=${buildAuthoringContextFingerprint(payload)} -->`,
    "# Context",
    "",
    "## Dashboard",
    JSON.stringify(dashboardSummary),
    "",
    "## Views",
    JSON.stringify(viewState),
    ...(viewsTruncated
      ? [
          `Only the first ${MAX_INLINE_VIEWS} views are expanded; remaining ids+titles are in \`other_views_peer_reference\`. Use \`getView\` for details.`,
        ]
      : []),
    "",
    ...(focusedView
      ? ["## Focused view", JSON.stringify(focusedView), ""]
      : []),
    "## Datasources",
    JSON.stringify(datasources),
    "",
    ...(input.proposalSummary
      ? ["## Proposal", JSON.stringify(input.proposalSummary), ""]
      : []),
  ].join("\n");

  return {
    markdown,
    fingerprint: buildAuthoringContextFingerprint(payload),
  };
}
