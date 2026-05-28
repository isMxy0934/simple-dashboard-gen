import { resolveCanonicalDashboardTemplateDefinition } from "@/contracts/dashboard-templates";

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
    defaultColorThemeId: "purple" | "teal";
    defaultViewStyleId: "emphasis" | "clean" | "gradient";
  };
}

const CANONICAL_TEMPLATE = resolveCanonicalDashboardTemplateDefinition();

const CANONICAL_TEMPLATE_RUNTIME: TemplateRuntimeDefinition = {
  id: CANONICAL_TEMPLATE.id,
  version: CANONICAL_TEMPLATE.version,
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
    defaultColorThemeId: CANONICAL_TEMPLATE.presentation.color_theme_id,
    defaultViewStyleId: CANONICAL_TEMPLATE.presentation.default_view_style_id,
  },
};

export function resolveTemplateRuntime(): TemplateRuntimeDefinition {
  return structuredClone(CANONICAL_TEMPLATE_RUNTIME);
}

export function listTemplateRuntimes(): TemplateRuntimeDefinition[] {
  return [resolveTemplateRuntime()];
}
