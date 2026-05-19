import type { QueryDef } from "@/contracts";
import type {
  StageChartFieldRole,
  StageChartSqlInput,
} from "@/ai/authoring/skills/contract";
import {
  outputField,
  quoteSqlIdentifier,
  selectAlias,
  shortName,
  standardQueryType,
} from "@/ai/authoring/tools/datasource-schema-utils";

function requiredField(
  fields: StageChartSqlInput["fields"],
  role: StageChartFieldRole,
  skillId: string,
) {
  const field = fields[role];
  if (!field) throw new Error(`stageChart ${skillId} requires fields.${role}`);
  return field;
}

export function buildCategoryMetricQueryDef(
  input: StageChartSqlInput,
  skillId: string,
): QueryDef {
  const category = requiredField(input.fields, "category", skillId);
  const metric = requiredField(input.fields, "metric", skillId);
  const categorySql = quoteSqlIdentifier(shortName(category.source_field));
  const metricSource = quoteSqlIdentifier(shortName(metric.source_field));
  const aggregation = metric.aggregation?.toLowerCase() ?? "sum";
  const metricSql =
    aggregation === "count"
      ? `count(${metricSource})`
      : `${aggregation}(${metricSource})`;
  const direction = input.sort?.direction ?? "desc";
  const limit = input.limit ?? 10;

  return {
    id: input.queryId,
    name: input.title,
    datasource_id: input.datasourceId,
    sql_template: `select ${selectAlias(categorySql, "category_name")}, ${selectAlias(metricSql, "metric_value")} from ${input.tableName}${input.whereClause} group by 1 order by 2 ${direction} limit ${limit}`,
    params: [],
    output: {
      kind: "rows",
      schema: [
        outputField({
          name: "category_name",
          type: standardQueryType({
            name: category.source_field,
            type: category.type ?? "string",
          }),
          nullable: true,
        }),
        outputField({ name: "metric_value", type: "number", nullable: true }),
      ],
    },
  };
}
