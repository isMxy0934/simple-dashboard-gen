let echartsModulePromise: Promise<typeof import("echarts")> | null = null;

export function loadEChartsModule(): Promise<typeof import("echarts")> {
  echartsModulePromise ??= import("echarts");
  return echartsModulePromise;
}
