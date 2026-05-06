import type {
  StageChartBuilder,
  StageChartBuilderOutput,
} from "@/ai/authoring/skills/contract";

export const echartsKpiGaugeBuilder: StageChartBuilder = {
  skillId: "echarts-kpi-gauge",
  build(input): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          series: [
            {
              type: "gauge",
              min: 0,
              max: 100,
              progress: { show: true, width: 12 },
              axisLine: { lineStyle: { width: 12 } },
              axisTick: { show: false },
              splitLine: { length: 8, lineStyle: { width: 1 } },
              axisLabel: { distance: 16 },
              pointer: { width: 4 },
              detail: {
                valueAnimation: true,
                formatter: "{value}",
                fontSize: 24,
                color: "#111827",
              },
              title: {
                show: true,
                offsetCenter: [0, "72%"],
                color: "#6b7280",
                fontSize: 12,
              },
              data: [{ value: 0, name: input.title }],
            },
          ],
        },
        slots: [
          { id: "value", path: "series[0].data[0].value", value_kind: "scalar", required: true },
        ],
      },
      bindings: [
        { slot_id: "value", field_role: "value", value_kind: "scalar", required: true },
      ],
      layout: {
        desktop: { w: 4, h: 4 },
        mobile: { w: 4, h: 4 },
      },
    };
  },
};
