import type {
  DashboardColorThemeId,
  DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";
import { normalizeDashboardDesignKitId } from "@/contracts/dashboard-presentation";
import {
  listCanonicalDashboardTemplateDefinitions,
  type DashboardTemplateBootstrapDefinition,
} from "@/contracts/dashboard-templates";
import type { DashboardDocument } from "@/contracts/dashboard";
import type { DashboardViewKind } from "@/contracts/dashboard-view-intent";

export interface TemplateRuntimeDefinition {
  id: string;
  version: string;
  metadata: {
    nameKey: string;
    descriptionKey: string;
    badgeKey: string;
    featureKeys: string[];
    accent: "purple" | "teal" | "gold";
    recommended: true;
  };
  zeroView: {
    mode: "full_shell";
    showControlBand: true;
    emptyCanvasStyle: "report";
  };
  shell: {
    surface: "report";
    heroLayout: "editorial";
    canvasStyle: "framed";
    defaultColorThemeId: DashboardColorThemeId;
    defaultViewStyleId: DashboardViewStyleId;
  };
  controlBand: {
    placement: "below_header";
    layoutControl: "segmented";
    sharedFilterPlacement: "toolbar";
    refreshAction: "trailing_button";
  };
  pickerPreview: {
    hero: true;
    controlBand: true;
    sampleViewKinds: Array<{
      viewKind: DashboardViewKind;
      emphasis: "primary" | "neutral";
    }>;
  };
}

export function createTemplateRuntimeDefinition(
  template: DashboardTemplateBootstrapDefinition,
): TemplateRuntimeDefinition {
  return {
    id: template.id,
    version: template.version,
    metadata: {
      nameKey: template.metadata.nameKey,
      descriptionKey: template.metadata.descriptionKey,
      badgeKey: template.metadata.badgeKey,
      featureKeys: [...template.metadata.featureKeys],
      accent: template.metadata.accent,
      recommended: true,
    },
    zeroView: {
      mode: "full_shell",
      showControlBand: true,
      emptyCanvasStyle: "report",
    },
    shell: {
      surface: "report",
      heroLayout: "editorial",
      canvasStyle: "framed",
      defaultColorThemeId: template.presentation.color_theme_id as DashboardColorThemeId,
      defaultViewStyleId: template.presentation.default_view_style_id as DashboardViewStyleId,
    },
    controlBand: {
      placement: "below_header",
      layoutControl: "segmented",
      sharedFilterPlacement: "toolbar",
      refreshAction: "trailing_button",
    },
    pickerPreview: {
      hero: true,
      controlBand: true,
      sampleViewKinds: [
        { viewKind: "stat_kpi", emphasis: "primary" },
        { viewKind: "time_trend", emphasis: "primary" },
        { viewKind: "signal_list", emphasis: "neutral" },
      ],
    },
  };
}

const TEMPLATE_RUNTIME_REGISTRY = Object.fromEntries(
  listCanonicalDashboardTemplateDefinitions().map((template) => [
    template.id,
    createTemplateRuntimeDefinition(template),
  ]),
) as Record<string, TemplateRuntimeDefinition>;

function cloneRuntime(
  runtime: TemplateRuntimeDefinition,
): TemplateRuntimeDefinition {
  return structuredClone(runtime);
}

function normalizeTemplateRuntimeId(templateId?: string | null): string | null {
  const normalized = normalizeDashboardDesignKitId(templateId?.trim() ?? "");
  return normalized && Object.hasOwn(TEMPLATE_RUNTIME_REGISTRY, normalized)
    ? normalized
    : null;
}

export function resolveTemplateRuntime(
  templateId: string = listTemplateRuntimes()[0]?.id ?? "",
): TemplateRuntimeDefinition {
  const normalizedTemplateId = normalizeTemplateRuntimeId(templateId);
  if (!normalizedTemplateId) {
    throw new Error(`Unknown dashboard template runtime: ${templateId}`);
  }

  return cloneRuntime(TEMPLATE_RUNTIME_REGISTRY[normalizedTemplateId]);
}

export function resolveKnownTemplateRuntime(
  templateId?: string | null,
): TemplateRuntimeDefinition | null {
  const normalizedTemplateId = normalizeTemplateRuntimeId(templateId);
  return normalizedTemplateId
    ? cloneRuntime(TEMPLATE_RUNTIME_REGISTRY[normalizedTemplateId])
    : null;
}

export function resolveDashboardTemplateRuntime(
  dashboard: Pick<DashboardDocument, "dashboard_spec">,
): TemplateRuntimeDefinition {
  return resolveTemplateRuntime(
    dashboard.dashboard_spec.template?.id ??
      normalizeDashboardDesignKitId(dashboard.dashboard_spec.presentation.design_kit_id),
  );
}

export function listTemplateRuntimes(): TemplateRuntimeDefinition[] {
  return Object.values(TEMPLATE_RUNTIME_REGISTRY).map(cloneRuntime);
}
