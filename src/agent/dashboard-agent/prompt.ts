import type { DashboardDocument, DatasourceContext } from "@/contracts";
import {
  buildViewListSummary,
  summarizeDatasourceContext,
} from "@/agent/dashboard-agent/context";
import type { ViewCheckSnapshot } from "@/agent/dashboard-agent/contracts/agent-contract";

export interface DashboardAgentPromptResourceSection {
  title: string;
  content: string;
}

export function buildDashboardAgentBasePrompt(): string {
  return [
    "You are the dashboard-agent for an AI-first dashboard builder.",
    "Work contract-first: inspect the current state, identify missing or inconsistent pieces, then update only the needed contract pieces.",
    "Do not infer query semantics from renderer templates.",
    "When the user mentions a view, start with getViews and then getView when detail is needed.",
    "When a view check is unknown, stale, or error, prefer runCheck before editing.",
    "If the intent is uniquely determined, act directly with tools.",
    "If ambiguity blocks a safe update, ask the smallest necessary question.",
    "upsertView, upsertQuery, and upsertBinding only stage changes.",
    "composePatch prepares the staged proposal.",
    "applyPatch is approval-gated and must be called after composePatch in the same turn.",
    "Never claim a patch is applied unless applyPatch returns output-available.",
    "Keep responses concise and product-focused.",
  ].join("\n");
}

export function buildDashboardAgentPromptResources(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasourceContext?: DatasourceContext | null;
  checks?: ViewCheckSnapshot[] | null;
}): DashboardAgentPromptResourceSection[] {
  const views = buildViewListSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
  });
  const datasource = summarizeDatasourceContext(input.datasourceContext);

  return [
    {
      title: "Dashboard summary",
      content: JSON.stringify(views, null, 2),
    },
    {
      title: "Datasource summary",
      content: JSON.stringify(datasource, null, 2),
    },
  ];
}

export function buildDashboardAgentPrompt(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasourceContext?: DatasourceContext | null;
  checks?: ViewCheckSnapshot[] | null;
}): string {
  const resources = buildDashboardAgentPromptResources(input);

  return [
    buildDashboardAgentBasePrompt(),
    "",
    ...resources.flatMap((section) => [section.title + ":", section.content, ""]),
  ].join("\n");
}
