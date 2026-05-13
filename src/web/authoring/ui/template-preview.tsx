"use client";

import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { useEChartsChart } from "../../../renderers/echarts/browser/use-echarts-chart";
import styles from "./authoring.module.css";

interface TemplatePreviewProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
}

export function TemplatePreview({
  optionTemplate,
  rowsCount,
}: TemplatePreviewProps) {
  const hostRef = useEChartsChart(optionTemplate);

  return (
    <div className={styles.previewWrap}>
      <div ref={hostRef} className={styles.previewChart} />
      <div className={styles.previewMeta}>
        <span>Template preview uses generated sample slot values.</span>
        <span className={styles.previewRows}>{rowsCount} items</span>
      </div>
    </div>
  );
}
