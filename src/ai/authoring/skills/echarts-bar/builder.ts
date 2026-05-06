import type {
  StageChartBuilder,
  StageChartBuilderOutput,
} from "@/ai/authoring/skills/contract";

export const echartsBarBuilder: StageChartBuilder = {
  skillId: "echarts-bar",
  build(): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
          grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
          xAxis: { type: "category", data: [] },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: [], barMaxWidth: 36 }],
        },
        slots: [
          { id: "category", path: "xAxis.data", value_kind: "array", required: true },
          { id: "value", path: "series[0].data", value_kind: "array", required: true },
        ],
      },
      bindings: [
        { slot_id: "category", field_role: "category", value_kind: "array", required: true },
        { slot_id: "value", field_role: "metric", value_kind: "array", required: true },
      ],
      layout: {
        desktop: { w: 6, h: 6 },
        mobile: { w: 4, h: 6 },
      },
    };
  },
};
