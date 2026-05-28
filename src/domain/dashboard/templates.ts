import type {
  DashboardDocument,
  DashboardTemplateRef,
} from "../../contracts";
import {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
  CANONICAL_DASHBOARD_TEMPLATE_REF,
  CANONICAL_DASHBOARD_TEMPLATE_VERSION,
  resolveCanonicalDashboardTemplateDefinition,
  type DashboardTemplateBootstrapDefinition,
} from "@/contracts/dashboard-templates";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";

const DEFAULT_REPORT_TEMPLATE = resolveCanonicalDashboardTemplateDefinition();

export const DEFAULT_DASHBOARD_TEMPLATE_ID = CANONICAL_DASHBOARD_TEMPLATE_ID;
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = CANONICAL_DASHBOARD_TEMPLATE_VERSION;

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: CANONICAL_DASHBOARD_TEMPLATE_REF.id,
  version: CANONICAL_DASHBOARD_TEMPLATE_REF.version,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateBootstrapDefinition {
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
): DashboardTemplateBootstrapDefinition | null {
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
  resolvedTemplate: DashboardTemplateBootstrapDefinition,
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
