"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { ChartFrame } from "../../dashboard/render";

export interface ViewerChartProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
  showMeta?: boolean;
}

export function ViewerChart({
  optionTemplate,
  rowsCount,
  showMeta,
}: ViewerChartProps) {
  return (
    <ChartFrame
      optionTemplate={optionTemplate}
      rowsCount={rowsCount}
      showMeta={showMeta}
    />
  );
}
