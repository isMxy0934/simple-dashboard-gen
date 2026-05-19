"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { ChartFrame } from "../../dashboard/render";

export interface ViewerChartProps {
  option: EChartsOptionTemplate;
  rowsCount: number;
  showMeta?: boolean;
}

export function ViewerChart({
  option,
  rowsCount,
  showMeta,
}: ViewerChartProps) {
  return (
    <ChartFrame
      option={option}
      rowsCount={rowsCount}
      showMeta={showMeta}
    />
  );
}
