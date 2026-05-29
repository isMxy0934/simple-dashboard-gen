import type {
  DashboardDocument,
  DashboardTemplateRef,
} from "../../contracts";
import {
  CANONICAL_DASHBOARD_TEMPLATE_ID,
  CANONICAL_DASHBOARD_TEMPLATE_REF,
  CANONICAL_DASHBOARD_TEMPLATE_VERSION,
  resolveCanonicalDashboardTemplateDefinition,
  resolveKnownCanonicalDashboardTemplateRef,
  type DashboardTemplateBootstrapDefinition,
} from "@/contracts/dashboard-templates";
import { getTemplateDensityContract } from "@/contracts/dashboard-template-capability-registry";
import { normalizeDashboardDesignKitId } from "@/contracts/dashboard-presentation";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";
import { generateMobileLayout } from "./layout";

export const DEFAULT_DASHBOARD_TEMPLATE_ID = CANONICAL_DASHBOARD_TEMPLATE_ID;
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = CANONICAL_DASHBOARD_TEMPLATE_VERSION;

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: CANONICAL_DASHBOARD_TEMPLATE_REF.id,
  version: CANONICAL_DASHBOARD_TEMPLATE_REF.version,
};

function clone<T>(value: T): T {
  return structuredClone(value);
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
): DashboardTemplateBootstrapDefinition {
  return resolveCanonicalDashboardTemplateDefinition(ref ?? DEFAULT_DASHBOARD_TEMPLATE_REF);
}

export function resolveKnownDashboardTemplateRef(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateRef | null {
  return resolveKnownCanonicalDashboardTemplateRef(ref);
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

function resolveTemplateLayoutDefaults(
  template: DashboardTemplateBootstrapDefinition,
): DashboardTemplateBootstrapDefinition["layout"] {
  const density = getTemplateDensityContract(template.id);
  return {
    desktop: {
      ...template.layout.desktop,
      row_height: density?.rowHeight.desktop ?? template.layout.desktop.row_height,
    },
    mobile: {
      ...template.layout.mobile,
      row_height: density?.rowHeight.mobile ?? template.layout.mobile.row_height,
    },
  };
}

export function createDashboardFromTemplate(
  ref: DashboardTemplateRef = DEFAULT_DASHBOARD_TEMPLATE_REF,
): DashboardDocument {
  const template = resolveDashboardTemplate(ref);
  const layoutDefaults = resolveTemplateLayoutDefaults(template);
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
          ...layoutDefaults.desktop,
          items: clone(template.starter.desktopItems),
        },
        mobile: {
          ...layoutDefaults.mobile,
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
  const layoutDefaults = resolveTemplateLayoutDefaults(template);
  const desktop = document.dashboard_spec.layout.desktop;
  const mobile = document.dashboard_spec.layout.mobile;
  const desktopLayout = desktop ?? {
    ...layoutDefaults.desktop,
    items: [],
  };
  const mobileLayout = mobile ?? {
    ...generateMobileLayout(desktopLayout),
    row_height: layoutDefaults.mobile.row_height,
  };
  const filters = Array.isArray(document.dashboard_spec.filters)
    ? document.dashboard_spec.filters
    : clone(template.filters);
  const layout = {
    ...document.dashboard_spec.layout,
    desktop: desktopLayout,
    mobile: mobileLayout,
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
