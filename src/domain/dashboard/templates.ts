import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardFilter,
  DashboardLayoutItem,
  DashboardPresentation,
  DashboardTemplateRef,
} from "../../contracts";

export const DEFAULT_DASHBOARD_TEMPLATE_ID = "default_report";
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = "1";

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
};

export interface DashboardTemplateDefinition {
  id: string;
  version: string;
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

const DEFAULT_REPORT_TEMPLATE: DashboardTemplateDefinition = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  dashboardDefaults: {
    name: "Untitled Report",
    description: "",
  },
  presentation: {
    theme_id: "default_report",
    density: "compact",
    card_chrome: "report",
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
  chartRecipeIds: [
    "echarts-bar",
    "echarts-line",
    "echarts-kpi-text",
    "echarts-kpi-gauge",
  ],
};

const DASHBOARD_TEMPLATES = [DEFAULT_REPORT_TEMPLATE];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateDefinition {
  const knownTemplate = resolveKnownDashboardTemplate(ref);
  if (knownTemplate) {
    return knownTemplate;
  }

  return DEFAULT_REPORT_TEMPLATE;
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

function hasKnownDashboardTemplateRef(ref?: DashboardTemplateRef | null): boolean {
  return Boolean(resolveKnownDashboardTemplate(ref));
}

function normalizeTemplateRef(
  ref: DashboardTemplateRef | undefined,
  resolvedTemplate: DashboardTemplateDefinition,
): DashboardTemplateRef {
  if (hasKnownDashboardTemplateRef(ref)) {
    return {
      id: resolvedTemplate.id,
      version: resolvedTemplate.version,
    };
  }

  if (ref && isNonEmptyString(ref.id) && isNonEmptyString(ref.version)) {
    return {
      id: ref.id.trim(),
      version: ref.version.trim(),
    };
  }

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
    dashboard_spec: {
      schema_version: "0.2",
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
  const hasKnownTemplate = hasKnownDashboardTemplateRef(existingTemplate);
  const shouldApplyTemplatePresentation =
    !existingTemplate ||
    hasKnownTemplate ||
    !document.dashboard_spec.presentation;
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
    dashboard_spec: {
      ...document.dashboard_spec,
      template: normalizeTemplateRef(existingTemplate, template),
      presentation:
        shouldApplyTemplatePresentation
          ? clone(template.presentation)
          : document.dashboard_spec.presentation,
      layout,
      filters,
    },
  };
}
