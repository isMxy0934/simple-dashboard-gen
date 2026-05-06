import type {
  StageChartBuilder,
  StageChartBuilderOutput,
} from "@/ai/authoring/skills/contract";

export const echartsKpiTextBuilder: StageChartBuilder = {
  skillId: "echarts-kpi-text",
  build(input): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          graphic: [
            {
              type: "text",
              left: "center",
              top: "middle",
              style: {
                text: "0",
                fontSize: 36,
                fontWeight: 700,
                fill: "#111827",
                textAlign: "center",
              },
            },
            {
              type: "text",
              left: "center",
              top: "68%",
              style: {
                text: input.title,
                fontSize: 13,
                fill: "#6b7280",
                textAlign: "center",
              },
            },
          ],
        },
        slots: [
          {
            id: "value",
            path: "graphic[0].style.text",
            value_kind: "scalar",
            required: true,
            formatter: "integer",
          },
        ],
      },
      bindings: [
        { slot_id: "value", field_role: "value", value_kind: "scalar", required: true, formatter: "integer" },
      ],
      layout: {
        desktop: { w: 4, h: 3 },
        mobile: { w: 4, h: 3 },
      },
    };
  },
};
