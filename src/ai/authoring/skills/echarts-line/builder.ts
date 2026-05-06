import type {
  StageChartBuilder,
  StageChartBuilderOutput,
} from "@/ai/authoring/skills/contract";

export const echartsLineBuilder: StageChartBuilder = {
  skillId: "echarts-line",
  build(): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          tooltip: { trigger: "axis" },
          grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
          xAxis: { type: "category", data: [] },
          yAxis: { type: "value" },
          series: [{ type: "line", data: [], smooth: true, showSymbol: false }],
        },
        slots: [
          { id: "time", path: "xAxis.data", value_kind: "array", required: true },
          { id: "value", path: "series[0].data", value_kind: "array", required: true },
        ],
      },
      bindings: [
        { slot_id: "time", field_role: "time", value_kind: "array", required: true },
        { slot_id: "value", field_role: "metric", value_kind: "array", required: true },
      ],
      layout: {
        desktop: { w: 8, h: 6 },
        mobile: { w: 4, h: 6 },
      },
    };
  },
};
