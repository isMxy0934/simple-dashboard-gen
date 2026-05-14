"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { ChartFrame } from "../../dashboard/render";

interface TemplatePreviewProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
}

export function TemplatePreview({
  optionTemplate,
  rowsCount,
}: TemplatePreviewProps) {
  return (
    <ChartFrame
      optionTemplate={optionTemplate}
      rowsCount={rowsCount}
      metaText="Template preview uses generated sample slot values."
    />
  );
}
