import type { DashboardDocument } from "@/contracts";
import {
  buildDashboardPromptSummary,
  buildPromptViewStateSummary,
  summarizeDatasourceList,
} from "@/ai/dashboard-agent/context";
import type {
  DatasourceListItemSummary,
  DashboardAgentSkillSummary,
  ViewCheckSnapshot,
} from "@/ai/dashboard-agent/contracts/agent-contract";

export interface DashboardAgentPromptResourceSection {
  title: string;
  content: string;
}

export function buildDashboardAgentBasePrompt(): string {
  return [
    "You are the dashboard-agent for an AI-first dashboard builder.",
    "Work contract-first: inspect the current state, identify missing or inconsistent pieces, then update only the needed contract pieces.",
    "Do not infer query semantics from renderer templates.",
    "Do not infer business intent from datasource names or descriptions.",
    "Do not recommend report templates unless the user explicitly asks for options.",
    "If the user only asks to create a report or dashboard, ask what data, metric, or question they want to see before proposing a chart.",
    "When the user mentions a view, start with getViews and then getView when detail is needed.",
    "When a view check is unknown, stale, or error, prefer runCheck before editing.",
    "If the intent is uniquely determined, act directly with tools.",
    "If ambiguity blocks a safe update, ask the smallest necessary question.",
    "Use getDatasources for datasource choices and getSchemaByDatasource only when schema detail is required.",
    "When a chart request matches an internal skill, call loadSkill with the exact skill id before staging view/query/binding contracts.",
    "If the loaded skill points to a specific chart variant, call loadSkillReference for that one reference before staging contracts.",
    "Skills provide instructions only. They do not replace upsertView, upsertQuery, upsertBinding, or runCheck.",
    "upsertView, upsertQuery, and upsertBinding only stage changes.",
    "upsertQuery and upsertBinding require explicit contracts. Inspect current state first, then submit the exact query or binding you want to stage.",
    "Do not ask tools to infer a query or binding from a vague request.",
    "If a tool reports no semantic change, do not retry the same repair path.",
    "If runCheck reports the same failures twice, stop repairing and explain the dead-end.",
    "composePatch prepares the staged proposal.",
    "applyPatch is approval-gated and must be called after composePatch in the same turn.",
    "Never claim a patch is applied unless applyPatch returns output-available.",
    "Keep responses concise and product-focused.",
  ].join("\n");
}

export function buildDashboardAgentPromptResources(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: DashboardAgentSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
}): DashboardAgentPromptResourceSection[] {
  const dashboard = buildDashboardPromptSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
  });
  const views = buildPromptViewStateSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
  });
  const datasources = summarizeDatasourceList(input.datasources);
  const skills = {
    skill_count: input.skills?.length ?? 0,
    skills: (input.skills ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
  };

  return [
    {
      title: "Dashboard summary",
      content: JSON.stringify(dashboard, null, 2),
    },
    {
      title: "View state summary",
      content: JSON.stringify(views, null, 2),
    },
    {
      title: "Datasource list summary",
      content: JSON.stringify(datasources, null, 2),
    },
    {
      title: "Available skill summary",
      content: JSON.stringify(skills, null, 2),
    },
  ];
}

export function buildDashboardAgentPrompt(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: DashboardAgentSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
}): string {
  const resources = buildDashboardAgentPromptResources(input);

  return [
    buildDashboardAgentBasePrompt(),
    "",
    ...resources.flatMap((section) => [section.title + ":", section.content, ""]),
  ].join("\n");
}
