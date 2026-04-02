"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EChartsOptionTemplate } from "../../../contracts";
import { mergeResponsiveEChartsTemplate } from "../../shared/echarts-template";
import styles from "./authoring.module.css";

interface TemplatePreviewProps {
  optionTemplate: EChartsOptionTemplate;
  rowsCount: number;
}

export function TemplatePreview({
  optionTemplate,
  rowsCount,
}: TemplatePreviewProps) {
  const optionKey = JSON.stringify(optionTemplate);
  const chartOption = useMemo(
    () => mergeResponsiveEChartsTemplate(optionTemplate),
    [optionKey, optionTemplate],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<{
    setOption: (option: unknown, notMerge?: boolean) => void;
    resize: () => void;
    dispose: () => void;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let resizeHandler: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function mountChart() {
      if (!hostRef.current) {
        return;
      }

      const echarts = await import("echarts");
      if (!active || !hostRef.current) {
        return;
      }

      const hostEl = hostRef.current;
      const instance = echarts.init(hostEl, undefined, {
        renderer: "canvas",
      });

      chartRef.current = instance;
      instance.setOption(chartOption as never, true);
      resizeHandler = () => instance.resize();
      window.addEventListener("resize", resizeHandler);
      resizeObserver = new ResizeObserver(() => {
        instance.resize();
      });
      resizeObserver.observe(hostEl);
      instance.resize();
    }

    void mountChart();

    return () => {
      active = false;
      resizeObserver?.disconnect();
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [chartOption, optionKey]);

  useEffect(() => {
    chartRef.current?.setOption(chartOption as never, true);
  }, [chartOption, optionKey]);

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
