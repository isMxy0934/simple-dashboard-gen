import type { QueryDef, QueryParamType } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartBuilderInput,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
import { buildRegisteredStageChartRecipe } from "@/ai/authoring/skills/recipe-build";
import {
  selectAlias,
  outputField,
  shortName,
  standardQueryType,
  quoteSqlIdentifier,
} from "@/ai/authoring/tools/datasource-schema-utils";

function requiredField(fields: StageChartSqlInput["fields"], role: StageChartFieldRole) {
  const field = fields[role];
  if (!field) throw new Error(`compiled bar chart requires fields.${role}`);
  return field;
}

export const echartsBarBuilder: StageChartBuilder = {
  skillId: "echarts-bar",
  build(input: StageChartBuilderInput) {
    return buildRegisteredStageChartRecipe("echarts-bar", input);
  },
  buildQueryDef(input): QueryDef | null {
    const category = requiredField(input.fields, "category");
    const metric = requiredField(input.fields, "metric");
    const catSrc = quoteSqlIdentifier(shortName(category.source_field));
    const agg = metric.aggregation?.toLowerCase() ?? "sum";
    const metricSrc = quoteSqlIdentifier(shortName(metric.source_field));
    const metricSql = agg === "count" ? `count(${metricSrc})` : `${agg}(${metricSrc})`;
    const direction = input.sort?.direction ?? "desc";
    const limit = input.limit ?? 10;
    return {
      id: input.queryId,
      name: input.title,
      datasource_id: input.datasourceId,
      sql_template: `select ${selectAlias(catSrc, "category_name")}, ${selectAlias(metricSql, "metric_value")} from ${input.tableName}${input.whereClause} group by 1 order by 2 ${direction} limit ${limit}`,
      params: [],
      output: { kind: "rows", schema: [outputField({ name: "category_name", type: standardQueryType({ name: category.source_field, type: category.type ?? "string" }) }), outputField({ name: "metric_value", type: "number", nullable: true })] },
    };
  },
};
