import {
  collectSkillResources,
} from "./resource-provider";
import {
  createDashboardAuthoringSkill,
  type DashboardAuthoringSkillContext,
  type DashboardAuthoringToolSet,
} from "./dashboard-authoring-skill";
import { createDashboardReviewSkill } from "./dashboard-review-skill";
import { mergeSkillTools } from "./tool-provider";
import type { AgentSkillDefinition, AgentSkillResource } from "./types";

export interface DashboardAuthoringSkillSet {
  skills: AgentSkillDefinition<DashboardAuthoringToolSet>[];
  instructions: string[];
  resources: AgentSkillResource[];
  tools: DashboardAuthoringToolSet;
}

export type DashboardAuthoringSkillFactory = (
  input: DashboardAuthoringSkillContext,
) => AgentSkillDefinition<DashboardAuthoringToolSet> | null;

const defaultDashboardAuthoringSkillFactories: DashboardAuthoringSkillFactory[] = [
  createDashboardAuthoringSkill,
  createDashboardReviewSkill,
];

const DASHBOARD_AGENT_SKILLS_ENV = "DASHBOARD_AGENT_SKILLS";

declare global {
  var __dashboardAuthoringSkillFactories:
    | DashboardAuthoringSkillFactory[]
    | undefined;
}

function getRegisteredDashboardAuthoringSkillFactories() {
  if (!globalThis.__dashboardAuthoringSkillFactories) {
    globalThis.__dashboardAuthoringSkillFactories = [];
  }

  return globalThis.__dashboardAuthoringSkillFactories;
}

export function registerDashboardAuthoringSkillFactory(
  factory: DashboardAuthoringSkillFactory,
) {
  const factories = getRegisteredDashboardAuthoringSkillFactories();

  if (!factories.includes(factory)) {
    factories.push(factory);
  }
}

export function resolveDashboardAuthoringSkillSet(
  input: DashboardAuthoringSkillContext,
): DashboardAuthoringSkillSet {
  const enabledSkillIds = getConfiguredDashboardSkillIds();
  const factories = [
    ...defaultDashboardAuthoringSkillFactories,
    ...getRegisteredDashboardAuthoringSkillFactories(),
  ];
  const skills = factories
    .map((factory) => factory(input))
    .filter(
      (skill): skill is AgentSkillDefinition<DashboardAuthoringToolSet> =>
        skill !== null &&
        (enabledSkillIds === null || enabledSkillIds.has(skill.id)),
    );

  return {
    skills,
    instructions: skills.flatMap((skill) => skill.instructions),
    resources: collectSkillResources(skills),
    tools: mergeSkillTools(skills) as DashboardAuthoringToolSet,
  };
}

function getConfiguredDashboardSkillIds() {
  const raw = process.env[DASHBOARD_AGENT_SKILLS_ENV]?.trim();
  if (!raw) {
    return null;
  }

  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : null;
}
