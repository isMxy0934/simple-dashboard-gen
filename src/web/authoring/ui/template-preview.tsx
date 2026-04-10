"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";
import { mergeResponsiveEChartsTemplate } from "../../../renderers/echarts/browser/materialize-option";
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
  const chartOptionRef = useRef(chartOption);
  const syncChartRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    chartOptionRef.current = chartOption;
  }, [chartOption]);

  useEffect(() => {
    let active = true;
    let resizeHandler: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frameId: number | null = null;
    let echartsPromise: Promise<typeof import("echarts")> | null = null;

    function hostIsReady(hostEl: HTMLDivElement) {
      return hostEl.clientWidth > 8 && hostEl.clientHeight > 8;
    }

    function cancelScheduledSync() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    }

    function syncChart() {
      const hostEl = hostRef.current;
      if (!active || !hostEl || !hostIsReady(hostEl)) {
        return;
      }

      if (chartRef.current) {
        chartRef.current.resize();
        return;
      }

      echartsPromise ??= import("echarts");
      void echartsPromise.then((echarts) => {
        const currentHost = hostRef.current;
        if (!active || !currentHost || chartRef.current || !hostIsReady(currentHost)) {
          return;
        }

        const instance = echarts.init(currentHost, undefined, {
          renderer: "canvas",
        });

        chartRef.current = instance;
        instance.setOption(chartOptionRef.current as never, true);
        instance.resize();
      });
    }

    function scheduleSync() {
      if (!active) {
        return;
      }

      cancelScheduledSync();
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncChart();
      });
    }

    syncChartRef.current = scheduleSync;
    resizeHandler = () => {
      scheduleSync();
    };
    window.addEventListener("resize", resizeHandler);
    resizeObserver = new ResizeObserver(() => {
      scheduleSync();
    });
    if (hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }
    scheduleSync();

    return () => {
      active = false;
      syncChartRef.current = null;
      cancelScheduledSync();
      resizeObserver?.disconnect();
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(chartOption as never, true);
      syncChartRef.current?.();
      return;
    }

    syncChartRef.current?.();
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
