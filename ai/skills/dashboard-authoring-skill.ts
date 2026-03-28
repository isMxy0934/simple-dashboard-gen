import type {
  DashboardDocument,
  DatasourceContext,
} from "../../contracts";
import type { ContractStateSummary } from "../runtime/agent-contract";
import type { AuthoringRouteDecision } from "../runtime/authoring-route";
import {
  buildDashboardAgentBasePrompt,
  buildDashboardAgentPromptResources,
} from "../authoring/prompt";
import { buildDashboardAgentTools } from "../authoring/tools";
import type { DashboardAiDependencies } from "../runtime/dependencies";
import type { AgentSkillDefinition, AgentSkillResource } from "./types";

export type DashboardAuthoringToolSet = ReturnType<typeof buildDashboardAgentTools>;

export interface DashboardAuthoringSkillContext {
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages?: Parameters<typeof buildDashboardAgentTools>[0]["messages"];
  contractState?: ContractStateSummary;
  routeDecision?: AuthoringRouteDecision;
  runtimeMode?: "inspection" | "authoring";
  dependencies?: DashboardAiDependencies;
}

export function createDashboardAuthoringSkill(
  input: DashboardAuthoringSkillContext,
): AgentSkillDefinition<DashboardAuthoringToolSet> {
  const resources: AgentSkillResource[] = buildDashboardAgentPromptResources({
    dashboard: input.dashboard,
    datasourceContext: input.datasourceContext,
  }).map((resource, index) => ({
    id: `dashboard-authoring-resource-${index + 1}`,
    title: resource.title,
    content: resource.content,
  }));

  return {
    id: "dashboard-authoring",
    description: "Core dashboard authoring tools, context, and approval policy.",
    instructions: [buildDashboardAgentBasePrompt()],
    resources,
    tools: buildDashboardAgentTools(input),
    approvalPolicy: {
      requiresApproval: true,
      summary: "Dashboard contract changes must be approved before apply.",
    },
  };
}
