import type {
  DashboardDocument,
  DashboardRenderer,
} from "@/contracts";
import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import type { DashboardViewIntent } from "@/contracts/dashboard-view-intent";
import { getDesignKitViewKindMapping } from "@/contracts/dashboard-view-policy";
import { getStageChartBuilder } from "@/ai/authoring/skills/registry";
import type {
  StageChartFieldMappings,
  StageChartLayoutTemplate,
  StageChartSlotBindingTemplate,
} from "@/ai/authoring/skills/contract";
import { resolveViewPresentationContext } from "@/presentation/dashboard/presentation-context";

export interface CompileDashboardViewIntentInput {
  dashboard: DashboardDocument;
  viewId?: string;
  title: string;
  description?: string;
  intent: DashboardViewIntent;
}

export interface CompileDashboardViewIntentOutput {
  recipeId: EChartsStageChartRecipeId;
  renderer: DashboardRenderer;
  bindings: StageChartSlotBindingTemplate[];
  layout: StageChartLayoutTemplate;
}

function resultFieldForRole(
  role: keyof DashboardViewIntent["fields"],
): string {
  if (role === "time") {
    return "time_value";
  }
  if (role === "category") {
    return "category_name";
  }
  if (role === "series") {
    return "series_value";
  }
  if (role === "metric") {
    return "metric_value";
  }
  return "metric_value";
}

function toStageChartFields(intent: DashboardViewIntent): StageChartFieldMappings {
  const fields: StageChartFieldMappings = {};
  for (const [role, field] of Object.entries(intent.fields)) {
    if (!field) {
      continue;
    }
    const fieldRole = role as keyof DashboardViewIntent["fields"];
    fields[fieldRole] = {
      source_field: field.source_field,
      result_field: resultFieldForRole(fieldRole),
      ...(field.label !== undefined ? { label: field.label } : {}),
      ...(field.type !== undefined ? { type: field.type } : {}),
      ...(field.aggregation !== undefined ? { aggregation: field.aggregation } : {}),
    };
  }
  return fields;
}

export function compileDashboardViewIntent(
  input: CompileDashboardViewIntentInput,
): CompileDashboardViewIntentOutput {
  const presentation = resolveViewPresentationContext(input.dashboard, {
    viewId: input.viewId,
  });
  const mapping = getDesignKitViewKindMapping({
    designKitId: presentation.designKit.id,
    viewKind: input.intent.view_kind,
    viewStyleId: presentation.viewStyle.id,
  });
  if (!mapping) {
    throw new Error(
      `unsupported_view_kind: ${input.intent.view_kind} is not supported for ${presentation.designKit.id}.`,
    );
  }
  const builder = getStageChartBuilder(mapping.recipeId);
  if (!builder) {
    throw new Error(`missing_internal_recipe_builder: ${mapping.recipeId}`);
  }
  const built = builder.build({
    title: input.title,
    description: input.description,
    queryOutput: null,
    fields: toStageChartFields(input.intent),
    presentation,
  });
  return {
    recipeId: mapping.recipeId,
    renderer: built.renderer,
    bindings: built.bindings,
    layout: built.layout,
  };
}
