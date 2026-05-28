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
      metaText="Canonical template preview uses the current runtime shell and family tokens."
    />
  );
}
