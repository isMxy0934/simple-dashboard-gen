import type {
  DashboardDocument,
  DashboardFilter,
  DashboardTemplateRef,
} from "../../contracts";
import {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
  CANONICAL_DASHBOARD_TEMPLATE_REF,
  CANONICAL_DASHBOARD_TEMPLATE_VERSION,
  listCanonicalDashboardTemplateDefinitions,
  resolveCanonicalDashboardTemplateDefinition,
  resolveKnownCanonicalDashboardTemplateRef,
  type DashboardTemplateBootstrapDefinition,
} from "@/contracts/dashboard-templates";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import { normalizeDashboardDesignKitId } from "@/contracts/dashboard-presentation";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";

export const DEFAULT_DASHBOARD_TEMPLATE_ID = CANONICAL_DASHBOARD_TEMPLATE_ID;
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = CANONICAL_DASHBOARD_TEMPLATE_VERSION;

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: CANONICAL_DASHBOARD_TEMPLATE_REF.id,
  version: CANONICAL_DASHBOARD_TEMPLATE_REF.version,
};

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

const DEFAULT_FILTERS: DashboardFilter[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePresentation(
  presentation: DashboardDocument["dashboard_spec"]["presentation"],
): DashboardDocument["dashboard_spec"]["presentation"] {
  return {
    ...clone(presentation),
    design_kit_id: normalizeDashboardDesignKitId(presentation.design_kit_id),
  };
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateDefinition {
  return resolveCanonicalDashboardTemplateDefinition(ref ?? DEFAULT_DASHBOARD_TEMPLATE_REF);
}

export function listDashboardTemplateSummaries(): DashboardTemplateSummary[] {
  return listCanonicalDashboardTemplateDefinitions().map((template) => ({
    id: template.id,
    version: template.version,
    ref: {
      id: template.id,
      version: template.version,
    },
    nameKey: template.metadata.nameKey,
    descriptionKey: template.metadata.descriptionKey,
    badgeKey: template.metadata.badgeKey,
    featureKeys: [...template.metadata.featureKeys],
    accent: template.metadata.accent,
    cardCount: template.starter.views.length,
    filterCount: template.filters.length,
  }));
}

export function resolveKnownDashboardTemplateRef(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateRef | null {
  return resolveKnownCanonicalDashboardTemplateRef(ref);
}

function normalizeTemplateRef(
  _ref: DashboardTemplateRef | undefined,
  resolvedTemplate: DashboardTemplateDefinition,
): DashboardTemplateRef {
  return {
    id: resolvedTemplate.id,
    version: resolvedTemplate.version,
  };
}

export function createDashboardFromTemplate(
  ref: DashboardTemplateRef = DEFAULT_DASHBOARD_TEMPLATE_REF,
): DashboardDocument {
  const template = resolveDashboardTemplate(ref);
  return {
    schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
    dashboard_spec: {
      schema_version: "0.3",
      template: {
        id: template.id,
        version: template.version,
      },
      presentation: clone(template.presentation),
      dashboard: {
        name: template.dashboardDefaults.name,
        description: template.dashboardDefaults.description,
      },
      layout: {
        desktop: {
          ...template.layout.desktop,
          items: clone(template.starter.desktopItems),
        },
        mobile: {
          ...template.layout.mobile,
          items: clone(template.starter.mobileItems),
        },
      },
      views: clone(template.starter.views),
      filters: template.filters.length > 0 ? clone(template.filters) : clone(DEFAULT_FILTERS),
    },
    query_defs: [],
    bindings: [],
  };
}

export function applyDashboardTemplateDefaults(
  document: DashboardDocument,
): DashboardDocument {
  const existingTemplate = document.dashboard_spec.template;
  const template = resolveDashboardTemplate(existingTemplate);
  const desktop = document.dashboard_spec.layout.desktop;
  const mobile = document.dashboard_spec.layout.mobile;
  const filters = Array.isArray(document.dashboard_spec.filters)
    ? document.dashboard_spec.filters
    : clone(template.filters);
  const layout = {
    ...document.dashboard_spec.layout,
    desktop: desktop ?? {
      ...template.layout.desktop,
      items: [],
    },
    ...(mobile ? { mobile } : {}),
  };

  return {
    ...document,
    schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
    dashboard_spec: {
      ...document.dashboard_spec,
      template: normalizeTemplateRef(existingTemplate, template),
      presentation: normalizePresentation(document.dashboard_spec.presentation),
      layout,
      filters,
    },
  };
}
