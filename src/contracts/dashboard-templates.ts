import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardFilter,
  DashboardLayoutItem,
  DashboardPresentation,
  DashboardTemplateRef,
} from "./dashboard";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "./dashboard-chart-recipes";
import {
  type DashboardColorThemeId,
  type DashboardViewStyleId,
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
} from "./dashboard-presentation";

export const CANONICAL_DASHBOARD_TEMPLATE_ID = "report_runtime_v1";
export const CANONICAL_DASHBOARD_TEMPLATE_VERSION = "1";

export const CANONICAL_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: CANONICAL_DASHBOARD_TEMPLATE_ID,
  version: CANONICAL_DASHBOARD_TEMPLATE_VERSION,
};

export interface DashboardTemplateBootstrapDefinition {
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

const CANONICAL_DASHBOARD_TEMPLATE_DEFINITION: DashboardTemplateBootstrapDefinition = {
  id: CANONICAL_DASHBOARD_TEMPLATE_ID,
  version: CANONICAL_DASHBOARD_TEMPLATE_VERSION,
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
    design_kit_id: CANONICAL_RUNTIME_DESIGN_KIT_ID,
    color_theme_id: DASHBOARD_COLOR_THEME_ID_PURPLE,
    default_view_style_id: DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
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

function cloneTemplateDefinition(): DashboardTemplateBootstrapDefinition {
  return structuredClone(CANONICAL_DASHBOARD_TEMPLATE_DEFINITION);
}

function hasCanonicalTemplateRef(
  ref?: DashboardTemplateRef | null,
): ref is DashboardTemplateRef {
  return (
    typeof ref?.id === "string" &&
    typeof ref.version === "string" &&
    ref.id.trim().length > 0 &&
    ref.version.trim().length > 0
  );
}

export function listCanonicalDashboardTemplateDefinitions(): DashboardTemplateBootstrapDefinition[] {
  return [cloneTemplateDefinition()];
}

export function resolveCanonicalDashboardTemplateDefinition(
  ref: DashboardTemplateRef = CANONICAL_DASHBOARD_TEMPLATE_REF,
): DashboardTemplateBootstrapDefinition {
  const template = resolveKnownCanonicalDashboardTemplateDefinition(ref);
  if (template) {
    return template;
  }

  throw new Error(`Unknown dashboard template: ${ref.id}@${ref.version}`);
}

export function resolveKnownCanonicalDashboardTemplateDefinition(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateBootstrapDefinition | null {
  if (!hasCanonicalTemplateRef(ref)) {
    return null;
  }

  if (
    ref.id === CANONICAL_DASHBOARD_TEMPLATE_ID &&
    ref.version === CANONICAL_DASHBOARD_TEMPLATE_VERSION
  ) {
    return cloneTemplateDefinition();
  }

  return null;
}

export function resolveKnownCanonicalDashboardTemplateRef(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateRef | null {
  const template = resolveKnownCanonicalDashboardTemplateDefinition(ref);
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    version: template.version,
  };
}

export function resolveCanonicalDashboardTemplateShellDefaults(): {
  defaultColorThemeId: DashboardColorThemeId;
  defaultViewStyleId: DashboardViewStyleId;
} {
  const template = cloneTemplateDefinition();
  return {
    defaultColorThemeId: template.presentation.color_theme_id as DashboardColorThemeId,
    defaultViewStyleId: template.presentation.default_view_style_id as DashboardViewStyleId,
  };
}
