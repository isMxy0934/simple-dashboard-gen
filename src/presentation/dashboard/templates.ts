import type {
  DashboardTemplateRef,
} from "../../contracts";
import {
  listCanonicalDashboardTemplateDefinitions,
  type DashboardTemplateBootstrapDefinition,
} from "@/contracts/dashboard-templates";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import { listTemplateRuntimes } from "@/presentation/dashboard/runtime";
export {
  DEFAULT_DASHBOARD_TEMPLATE_ID,
  DEFAULT_DASHBOARD_TEMPLATE_REF,
  DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  applyDashboardTemplateDefaults,
  createDashboardFromTemplate,
  resolveDashboardTemplate,
  resolveKnownDashboardTemplateRef,
} from "@/domain/dashboard/templates";

export type DashboardTemplateDefinition = DashboardTemplateBootstrapDefinition;

export interface DashboardTemplateSummary {
  id: string;
  version: string;
  ref: DashboardTemplateRef;
  nameKey: string;
  descriptionKey: string;
  badgeKey: string;
  featureKeys: string[];
  accent: "purple" | "teal" | "gold";
  cardCount: number;
  filterCount: number;
}

function assertDashboardTemplateRecipeIdsRegistered(): void {
  const registeredRecipeIds = new Set<string>(ECHARTS_STAGE_CHART_RECIPE_IDS);
  const missingRecipeIds = listCanonicalDashboardTemplateDefinitions().flatMap((template) =>
    template.chartRecipeIds
      .filter((recipeId) => !registeredRecipeIds.has(recipeId))
      .map((recipeId) => `${template.id}:${recipeId}`),
  );

  if (missingRecipeIds.length > 0) {
    throw new Error(
      `Dashboard templates reference unregistered chart recipes: ${missingRecipeIds.join(", ")}`,
    );
  }
}

assertDashboardTemplateRecipeIdsRegistered();

export function listDashboardTemplateSummaries(): DashboardTemplateSummary[] {
  const templatesById = new Map(
    listCanonicalDashboardTemplateDefinitions().map((template) => [template.id, template]),
  );

  return listTemplateRuntimes().flatMap((runtime) => {
    const template = templatesById.get(runtime.id);
    if (!template) {
      return [];
    }

    return [{
      id: runtime.id,
      version: runtime.version,
      ref: {
        id: runtime.id,
        version: runtime.version,
      },
      nameKey: runtime.metadata.nameKey,
      descriptionKey: runtime.metadata.descriptionKey,
      badgeKey: runtime.metadata.badgeKey,
      featureKeys: [...runtime.metadata.featureKeys],
      accent: runtime.metadata.accent,
      cardCount: template.starter.views.length,
      filterCount: template.filters.length,
    }];
  });
}
