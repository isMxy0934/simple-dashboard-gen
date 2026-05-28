import type {
  DashboardColorThemeId,
  DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";
import { normalizeDashboardDesignKitId } from "@/contracts/dashboard-presentation";
import {
  resolveCanonicalDashboardTemplateDefinition,
  resolveCanonicalDashboardTemplateShellDefaults,
} from "@/contracts/dashboard-templates";
import type { DashboardDocument } from "@/contracts/dashboard";
import type { ViewFamilyId } from "@/contracts/dashboard-view-family-registry";

export interface TemplateRuntimeDefinition {
  id: "report_runtime_v1";
  version: "1";
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
    sampleFamilies: Array<{
      familyId: ViewFamilyId;
      emphasis: "primary" | "neutral";
    }>;
  };
}

const CANONICAL_TEMPLATE = resolveCanonicalDashboardTemplateDefinition();
const CANONICAL_SHELL_DEFAULTS = resolveCanonicalDashboardTemplateShellDefaults();

const CANONICAL_TEMPLATE_RUNTIME: TemplateRuntimeDefinition = {
  id: CANONICAL_TEMPLATE.id as TemplateRuntimeDefinition["id"],
  version: CANONICAL_TEMPLATE.version as TemplateRuntimeDefinition["version"],
  metadata: {
    nameKey: CANONICAL_TEMPLATE.metadata.nameKey,
    descriptionKey: CANONICAL_TEMPLATE.metadata.descriptionKey,
    badgeKey: CANONICAL_TEMPLATE.metadata.badgeKey,
    featureKeys: [...CANONICAL_TEMPLATE.metadata.featureKeys],
    accent: CANONICAL_TEMPLATE.metadata.accent,
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
    defaultColorThemeId: CANONICAL_SHELL_DEFAULTS.defaultColorThemeId,
    defaultViewStyleId: CANONICAL_SHELL_DEFAULTS.defaultViewStyleId,
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
    sampleFamilies: [
      { familyId: "kpi", emphasis: "primary" },
      { familyId: "trend", emphasis: "primary" },
      { familyId: "signal", emphasis: "neutral" },
    ],
  },
};

function isCanonicalRuntimeId(templateId?: string | null): boolean {
  return normalizeDashboardDesignKitId(templateId?.trim() ?? "") === CANONICAL_TEMPLATE_RUNTIME.id;
}

export function resolveTemplateRuntime(
  templateId: string = CANONICAL_TEMPLATE_RUNTIME.id,
): TemplateRuntimeDefinition {
  if (!isCanonicalRuntimeId(templateId)) {
    throw new Error(`Unknown dashboard template runtime: ${templateId}`);
  }

  return structuredClone(CANONICAL_TEMPLATE_RUNTIME);
}

export function resolveKnownTemplateRuntime(
  templateId?: string | null,
): TemplateRuntimeDefinition | null {
  return isCanonicalRuntimeId(templateId)
    ? resolveTemplateRuntime(CANONICAL_TEMPLATE_RUNTIME.id)
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
  return [resolveTemplateRuntime(CANONICAL_TEMPLATE_RUNTIME.id)];
}
