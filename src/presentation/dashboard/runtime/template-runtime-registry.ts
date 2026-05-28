import type {
  DashboardColorThemeId,
  DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";
import {
  resolveCanonicalDashboardTemplateDefinition,
  resolveCanonicalDashboardTemplateShellDefaults,
} from "@/contracts/dashboard-templates";

export interface TemplateRuntimeDefinition {
  id: "report_runtime_v1";
  version: "1";
  metadata: {
    nameKey: string;
    descriptionKey: string;
    badgeKey: string;
    featureKeys: string[];
  };
  zeroView: {
    mode: "full_shell";
    showControlBand: true;
  };
  shell: {
    surface: "report";
    defaultColorThemeId: DashboardColorThemeId;
    defaultViewStyleId: DashboardViewStyleId;
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
  },
  zeroView: {
    mode: "full_shell",
    showControlBand: true,
  },
  shell: {
    surface: "report",
    defaultColorThemeId: CANONICAL_SHELL_DEFAULTS.defaultColorThemeId,
    defaultViewStyleId: CANONICAL_SHELL_DEFAULTS.defaultViewStyleId,
  },
};

export function resolveTemplateRuntime(): TemplateRuntimeDefinition {
  return structuredClone(CANONICAL_TEMPLATE_RUNTIME);
}

export function listTemplateRuntimes(): TemplateRuntimeDefinition[] {
  return [resolveTemplateRuntime()];
}
