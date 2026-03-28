import type { DashboardView } from "../../contracts";

export function createBlankView(seed: number): DashboardView {
  return {
    id: `v_custom_${seed}`,
    title: `Untitled View ${seed}`,
    description: "Describe the metric or story this card should tell.",
    option_template: {
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
    },
  };
}

export function collectTemplateFieldsFromView(view: DashboardView): string[] {
  const fields = new Set<string>();

  view.option_template.series.forEach((series) => {
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
