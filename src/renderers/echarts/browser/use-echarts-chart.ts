"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EChartsOptionTemplate } from "@/renderers/echarts/contract";
import { loadEChartsModule } from "@/renderers/echarts/browser/echarts-loader";
import { mergeResponsiveEChartsTemplate } from "@/renderers/echarts/browser/materialize-option";

interface EChartsInstance {
  setOption: (option: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

function hostIsReady(hostEl: HTMLDivElement) {
  return hostEl.clientWidth > 8 && hostEl.clientHeight > 8;
}

export function useEChartsChart(optionTemplate: EChartsOptionTemplate) {
  const optionKey = useMemo(
    () => JSON.stringify(optionTemplate),
    [optionTemplate],
  );
  const chartOption = useMemo(
    () => mergeResponsiveEChartsTemplate(optionTemplate),
    [optionKey],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const chartOptionRef = useRef(chartOption);
  const syncChartRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    chartOptionRef.current = chartOption;
  }, [chartOption]);

  useEffect(() => {
    let active = true;
    let frameId: number | null = null;

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

      void loadEChartsModule().then((echarts) => {
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
    const resizeHandler = () => scheduleSync();
    window.addEventListener("resize", resizeHandler);
    const resizeObserver = new ResizeObserver(() => scheduleSync());
    if (hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }
    scheduleSync();

    return () => {
      active = false;
      syncChartRef.current = null;
      cancelScheduledSync();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeHandler);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(chartOption as never, true);
    }
    syncChartRef.current?.();
  }, [chartOption]);

  return hostRef;
}
