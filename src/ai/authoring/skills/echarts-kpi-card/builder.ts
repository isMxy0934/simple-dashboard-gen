import type { QueryDef } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
import { buildRegisteredStageChartRecipe } from "@/ai/authoring/skills/recipe-build";
import {
  selectAlias,
  shortName,
  quoteSqlIdentifier,
} from "@/ai/authoring/tools/datasource-schema-utils";

function requiredField(fields: StageChartSqlInput["fields"], role: StageChartFieldRole) {
  const field = fields[role];
  if (!field) throw new Error(`stageChart kpi-card requires fields.${role}`);
  return field;
}

export const echartsKpiCardBuilder: StageChartBuilder = {
  skillId: "echarts-kpi-card",
  build(input) {
    return buildRegisteredStageChartRecipe("echarts-kpi-card", input);
  },
  buildQueryDef(input): QueryDef | null {
    const value = requiredField(input.fields, "value");
    const aggregation = value.aggregation?.toLowerCase() ?? "sum";
    const source = quoteSqlIdentifier(shortName(value.source_field));
    const expression =
      aggregation === "count" ? `count(${source})` : `${aggregation}(${source})`;
    return {
      id: input.queryId,
      name: input.title,
      datasource_id: input.datasourceId,
      sql_template: `select ${selectAlias(expression, "metric_value")} from ${input.tableName}${input.whereClause}`,
      params: [],
      output: { kind: "scalar", value_type: "number" },
    };
  },
};
