import type { QueryDef } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartBuilderOutput,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
import {
  selectAlias,
  shortName,
  quoteSqlIdentifier,
} from "@/ai/authoring/tools/datasource-schema-utils";

function requiredField(fields: StageChartSqlInput["fields"], role: StageChartFieldRole) {
  const field = fields[role];
  if (!field) throw new Error(`stageChart gauge requires fields.${role}`);
  return field;
}

export const echartsKpiGaugeBuilder: StageChartBuilder = {
  skillId: "echarts-kpi-gauge",
  build(input): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          series: [{
            type: "gauge", min: 0, max: 100,
            progress: { show: true, width: 12 },
            axisLine: { lineStyle: { width: 12 } },
            axisTick: { show: false },
            splitLine: { length: 8, lineStyle: { width: 1 } },
            axisLabel: { distance: 16 },
            pointer: { width: 4 },
            detail: { valueAnimation: true, formatter: "{value}", fontSize: 24, color: "#111827" },
            title: { show: true, offsetCenter: [0, "72%"], color: "#6b7280", fontSize: 12 },
            data: [{ value: 0, name: input.title }],
          }],
        },
        slots: [{ id: "value", path: "series[0].data[0].value", value_kind: "scalar", required: true }],
      },
      bindings: [{ slot_id: "value", field_role: "value", value_kind: "scalar", required: true }],
      layout: { desktop: { w: 4, h: 4 }, mobile: { w: 4, h: 4 } },
    };
  },
  buildQueryDef(input): QueryDef | null {
    const value = requiredField(input.fields, "value");
    if (!input.fields.value) return null;
    const agg = value.aggregation?.toLowerCase() ?? "sum";
    const src = quoteSqlIdentifier(shortName(value.source_field));
    const expr = agg === "count" ? `count(${src})` : `${agg}(${src})`;
    return {
      id: input.queryId,
      name: input.title,
      datasource_id: input.datasourceId,
      sql_template: `select ${selectAlias(expr, "metric_value")} from ${input.tableName}${input.whereClause}`,
      params: [],
      output: { kind: "scalar", value_type: "number" },
    };
  },
};
