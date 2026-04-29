import type {
  AuthoringGoalV2,
  ContextStatusV2,
} from "@/ai/authoring/v2/types";
import { findChartCapabilityV2 } from "@/ai/authoring/v2/chart-capabilities";

export type DataFormatContextShapeV2 = NonNullable<
  ContextStatusV2["dataFormatSkillLoadedFor"]
>["shape"];

export function dataShapeToContextShapeV2(
  shape: string,
): DataFormatContextShapeV2 {
  if (/scalar|kpi/i.test(shape)) {
    return "scalar_kpi";
  }
  if (/detail|row|table/i.test(shape)) {
    return "detail_rows";
  }
  if (/category|bar|pie/i.test(shape)) {
    return "category_series";
  }
  return "time_series";
}

export function expectedDataFormatShapeForGoalV2(
  goal: Pick<AuthoringGoalV2, "chartPlan"> | null | undefined,
): DataFormatContextShapeV2 | null {
  const chartType = goal?.chartPlan?.chartType;
  return expectedDataFormatShapeForChartTypeV2(chartType);
}

export function expectedDataFormatShapeForChartTypeV2(
  chartType: string | undefined,
): DataFormatContextShapeV2 | null {
  return findChartCapabilityV2(chartType)?.dataShape ?? null;
}
