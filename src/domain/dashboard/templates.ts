import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardFilter,
  DashboardLayoutItem,
  DashboardPresentation,
  DashboardTemplateRef,
} from "../../contracts";
import {
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "@/contracts/dashboard-presentation";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";
import { resolveTemplateRuntime } from "@/presentation/dashboard/runtime";

const TEMPLATE_RUNTIME = resolveTemplateRuntime();

export const DEFAULT_DASHBOARD_TEMPLATE_ID = TEMPLATE_RUNTIME.id;
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = TEMPLATE_RUNTIME.version;

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
};

interface DashboardTemplateCoreDefinition {
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
}

const DEFAULT_REPORT_TEMPLATE: DashboardTemplateCoreDefinition = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  dashboardDefaults: {
    name: "Untitled Report",
    description: "",
  },
  presentation: {
    design_kit_id: OPERATIONAL_REPORT_DESIGN_KIT_ID,
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
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateCoreDefinition {
  if (!ref) {
    return DEFAULT_REPORT_TEMPLATE;
  }

  const knownTemplate = resolveKnownDashboardTemplate(ref);
  if (knownTemplate) {
    return knownTemplate;
  }

  throw new Error(`Unknown dashboard template: ${ref.id}@${ref.version}`);
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
): DashboardTemplateCoreDefinition | null {
  if (ref && isNonEmptyString(ref.id) && isNonEmptyString(ref.version)) {
    if (
      ref.id === DEFAULT_REPORT_TEMPLATE.id &&
      ref.version === DEFAULT_REPORT_TEMPLATE.version
    ) {
      return DEFAULT_REPORT_TEMPLATE;
    }
  }

  return null;
}

function normalizeTemplateRef(
  _ref: DashboardTemplateRef | undefined,
  resolvedTemplate: DashboardTemplateCoreDefinition,
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
