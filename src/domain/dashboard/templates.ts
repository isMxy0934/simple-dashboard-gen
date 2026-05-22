import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardFilter,
  DashboardLayoutItem,
  DashboardPresentation,
  DashboardTemplateRef,
} from "../../contracts";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";
import {
  getDefaultDashboardColorThemeId,
  getDefaultDashboardDesignKitId,
  getDefaultDashboardViewStyleId,
} from "@/presentation/dashboard/themes";

export const DEFAULT_DASHBOARD_TEMPLATE_ID = "operational_report";
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = "1";

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
};

export interface DashboardTemplateDefinition {
  id: string;
  version: string;
  metadata: {
    nameKey: string;
    descriptionKey: string;
    badgeKey: string;
    featureKeys: string[];
    accent: "purple" | "teal" | "gold";
  };
  dashboardDefaults: {
    name: string;
    description: string;
  };
  presentation: DashboardPresentation;
  layout: {
    desktop: Pick<DashboardBreakpointLayout, "cols" | "row_height">;
    mobile: Pick<DashboardBreakpointLayout, "cols" | "row_height">;
  };
  starter: {
    views: DashboardDocument["dashboard_spec"]["views"];
    desktopItems: DashboardLayoutItem[];
    mobileItems: DashboardLayoutItem[];
  };
  filters: DashboardFilter[];
  chartRecipeIds: string[];
}

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

const DEFAULT_REPORT_TEMPLATE: DashboardTemplateDefinition = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  metadata: {
    nameKey: "authoring.templates.defaultReport.name",
    descriptionKey: "authoring.templates.defaultReport.description",
    badgeKey: "authoring.templates.defaultReport.badge",
    featureKeys: [
      "authoring.templates.features.emptyCanvas",
      "authoring.templates.features.aiFirst",
      "authoring.templates.features.cleanReport",
    ],
    accent: "purple",
  },
  dashboardDefaults: {
    name: "Untitled Report",
    description: "",
  },
  presentation: {
    design_kit_id: getDefaultDashboardDesignKitId(),
    color_theme_id: getDefaultDashboardColorThemeId(),
    default_view_style_id: getDefaultDashboardViewStyleId(),
  },
  layout: {
    desktop: {
      cols: 12,
      row_height: 30,
    },
    mobile: {
      cols: 4,
      row_height: 30,
    },
  },
  starter: {
    views: [],
    desktopItems: [],
    mobileItems: [],
  },
  filters: [],
  chartRecipeIds: [...ECHARTS_STAGE_CHART_RECIPE_IDS],
};

const DASHBOARD_TEMPLATES = [DEFAULT_REPORT_TEMPLATE];

function assertDashboardTemplateRecipeIdsRegistered(): void {
  const registeredRecipeIds = new Set<string>(ECHARTS_STAGE_CHART_RECIPE_IDS);
  const missingRecipeIds = DASHBOARD_TEMPLATES.flatMap((template) =>
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateDefinition {
  if (!ref) {
    return DEFAULT_REPORT_TEMPLATE;
  }

  const knownTemplate = resolveKnownDashboardTemplate(ref);
  if (knownTemplate) {
    return knownTemplate;
  }

  throw new Error(`Unknown dashboard template: ${ref.id}@${ref.version}`);
}

export function listDashboardTemplateSummaries(): DashboardTemplateSummary[] {
  return DASHBOARD_TEMPLATES.map((template) => ({
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
  const template = resolveKnownDashboardTemplate(ref);
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    version: template.version,
  };
}

function resolveKnownDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateDefinition | null {
  if (ref && isNonEmptyString(ref.id) && isNonEmptyString(ref.version)) {
    const match = DASHBOARD_TEMPLATES.find(
      (template) =>
        template.version === ref.version && template.id === ref.id,
    );
    if (match) {
      return match;
    }
  }

  return null;
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
      filters: clone(template.filters),
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
      presentation: clone(document.dashboard_spec.presentation),
      layout,
      filters,
    },
  };
}
