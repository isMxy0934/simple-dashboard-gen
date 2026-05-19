"use client";

import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import {
  useEChartsChart,
} from "@/renderers/echarts/browser/use-echarts-chart";
import type { MergeResponsiveEChartsTemplateOptions } from "@/renderers/echarts/browser/materialize-option";
import styles from "./chart-frame.module.css";

export interface ChartFrameProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
  metaText?: string;
  showMeta?: boolean;
  presentation?: MergeResponsiveEChartsTemplateOptions;
}

export function ChartFrame({
  optionTemplate,
  rowsCount,
  metaText = "ECharts renderer slots are injected from binding results.",
  showMeta = true,
  presentation,
}: ChartFrameProps) {
  const hostRef = useEChartsChart(optionTemplate, presentation);

  return (
    <div className={styles.chartWrap}>
      <div ref={hostRef} className={styles.chartHost} />
      {showMeta ? (
        <div className={styles.chartMeta}>
          <span>{metaText}</span>
          <span className={styles.chartCounter}>{rowsCount} items</span>
        </div>
      ) : null}
    </div>
  );
}
