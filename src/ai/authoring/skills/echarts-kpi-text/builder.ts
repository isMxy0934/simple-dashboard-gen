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
  if (!field) throw new Error(`stageChart kpi-text requires fields.${role}`);
  return field;
}

export const echartsKpiTextBuilder: StageChartBuilder = {
  skillId: "echarts-kpi-text",
  build(input): StageChartBuilderOutput {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          graphic: [
            { type: "text", left: "center", top: "middle", style: { text: "0", fontSize: 36, fontWeight: 700, fill: "#111827", textAlign: "center" } },
            { type: "text", left: "center", top: "68%", style: { text: input.title, fontSize: 13, fill: "#6b7280", textAlign: "center" } },
          ],
        },
        slots: [{ id: "value", path: "graphic[0].style.text", value_kind: "scalar", required: true, formatter: "integer" }],
      },
      bindings: [{ slot_id: "value", field_role: "value", value_kind: "scalar", required: true, formatter: "integer" }],
      layout: { desktop: { w: 4, h: 3 }, mobile: { w: 4, h: 3 } },
    };
  },
  buildQueryDef(input): QueryDef | null {
    const value = requiredField(input.fields, "value");
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
