import type {
  AuthoringGoalV2,
  ContextStatusV2,
  ViewGoalV2,
} from "@/ai/authoring/v2/types";

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
  chartType: ViewGoalV2["chartType"] | undefined,
): DataFormatContextShapeV2 | null {
  if (!chartType) {
    return null;
  }
  if (chartType === "kpi") {
    return "scalar_kpi";
  }
  if (chartType === "bar" || chartType === "pie") {
    return "category_series";
  }
  if (chartType === "table") {
    return "detail_rows";
  }
  return "time_series";
}
