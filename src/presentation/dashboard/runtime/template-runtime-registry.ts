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

const CANONICAL_TEMPLATE_RUNTIME: TemplateRuntimeDefinition = {
  id: "report_runtime_v1",
  version: "1",
  metadata: {
    nameKey: "authoring.templates.defaultReport.name",
    descriptionKey: "authoring.templates.defaultReport.description",
    badgeKey: "authoring.templates.defaultReport.badge",
    featureKeys: [
      "authoring.templates.features.emptyCanvas",
      "authoring.templates.features.aiFirst",
      "authoring.templates.features.cleanReport",
    ],
  },
  zeroView: {
    mode: "full_shell",
    showControlBand: true,
  },
  shell: {
    surface: "report",
    defaultColorThemeId: "purple",
    defaultViewStyleId: "emphasis",
  },
};

export function resolveTemplateRuntime(): TemplateRuntimeDefinition {
  return structuredClone(CANONICAL_TEMPLATE_RUNTIME);
}

export function listTemplateRuntimes(): TemplateRuntimeDefinition[] {
  return [resolveTemplateRuntime()];
}
