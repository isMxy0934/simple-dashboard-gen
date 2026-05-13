"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { useEChartsChart } from "../../../renderers/echarts/browser/use-echarts-chart";
import styles from "./viewer.module.css";

export interface ViewerChartProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
}

export function ViewerChart({ optionTemplate, rowsCount }: ViewerChartProps) {
  const hostRef = useEChartsChart(optionTemplate);

  return (
    <div className={styles.chartWrap}>
      <div ref={hostRef} className={styles.chartHost} />
      <div className={styles.chartMeta}>
        <span>ECharts renderer slots are injected from binding results.</span>
        <span className={styles.chartCounter}>{rowsCount} items</span>
      </div>
    </div>
  );
}
