"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import type { MergeResponsiveEChartsTemplateOptions } from "../../../renderers/echarts/browser/materialize-option";
import { ChartFrame } from "../../dashboard/render";

export interface ViewerChartProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
  showMeta?: boolean;
  presentation?: MergeResponsiveEChartsTemplateOptions;
}

export function ViewerChart({
  optionTemplate,
  rowsCount,
  showMeta,
  presentation,
}: ViewerChartProps) {
  return (
    <ChartFrame
      optionTemplate={optionTemplate}
      rowsCount={rowsCount}
      showMeta={showMeta}
      presentation={presentation}
    />
  );
}
