"use client";

import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import {
  useEChartsChart,
} from "@/renderers/echarts/browser/use-echarts-chart";
import styles from "./chart-frame.module.css";

export interface ChartFrameProps {
  option: EChartsOptionTemplate;
  rowsCount: number;
  metaText?: string;
  showMeta?: boolean;
}

export function ChartFrame({
  option,
  rowsCount,
  metaText = "ECharts renderer slots are injected from binding results.",
  showMeta = true,
}: ChartFrameProps) {
  const hostRef = useEChartsChart(option);

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
