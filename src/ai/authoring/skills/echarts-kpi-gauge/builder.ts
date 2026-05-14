import type { QueryDef } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
import { buildEChartsKpiGaugeRecipe } from "@/renderers/echarts/recipes/stage-chart-recipes";
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
  build(input) {
    return buildEChartsKpiGaugeRecipe(input);
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
