import type { DashboardView } from "../../contracts";
import {
  DEFAULT_SLOT_ID,
  DEFAULT_SLOT_PATH,
  getViewOptionTemplate,
} from "./contract-kernel";

export function createBlankView(seed: number): DashboardView {
  const optionTemplate = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [
      {
        type: "bar",
        encode: {
          x: "label",
          y: "value",
        },
      },
    ],
  };

  return {
    id: `v_custom_${seed}`,
    title: `Untitled View ${seed}`,
    description: "Describe the metric or story this card should tell.",
    option_template: optionTemplate,
    renderer: {
      kind: "echarts",
      option_template: optionTemplate,
      slots: [
        {
          id: DEFAULT_SLOT_ID,
          path: DEFAULT_SLOT_PATH,
          value_kind: "rows",
          required: true,
        },
      ],
    },
  };
}

export function collectTemplateFieldsFromView(view: DashboardView): string[] {
  const fields = new Set<string>();
  const optionTemplate = getViewOptionTemplate(view);

  (optionTemplate.series ?? []).forEach((series) => {
    if (!series.encode) {
      return;
    }

    Object.values(series.encode).forEach((value) => {
      if (typeof value === "string") {
        fields.add(value);
        return;
      }

      value.forEach((entry) => fields.add(entry));
    });
  });

  return [...fields];
}
