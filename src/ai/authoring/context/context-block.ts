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
  const viewState = buildPromptViewStateSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
    focusedViewId: input.variant === "focused" ? input.focusedViewId : undefined,
  });
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

  const markdown = [
    `<!-- authoring-context:fp=${buildAuthoringContextFingerprint(payload)} -->`,
    "# Context",
    "",
    "## Dashboard",
    JSON.stringify(dashboardSummary, null, 2),
    "",
    "## Views",
    JSON.stringify(viewState, null, 2),
    "",
    ...(focusedView
      ? ["## Focused view", JSON.stringify(focusedView, null, 2), ""]
      : []),
    "## Datasources",
    JSON.stringify(datasources, null, 2),
    "",
    ...(input.proposalSummary
      ? ["## Proposal", JSON.stringify(input.proposalSummary, null, 2), ""]
      : []),
  ].join("\n");

  return {
    markdown,
    fingerprint: buildAuthoringContextFingerprint(payload),
  };
}
