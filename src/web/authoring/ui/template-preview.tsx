"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { ChartFrame } from "../../dashboard/render";

interface TemplatePreviewProps {
  option: EChartsOptionTemplate;
  rowsCount: number;
}

export function TemplatePreview({
  option,
  rowsCount,
}: TemplatePreviewProps) {
  return (
    <ChartFrame
      option={option}
      rowsCount={rowsCount}
      metaText="Template preview uses generated sample slot values."
    />
  );
}
