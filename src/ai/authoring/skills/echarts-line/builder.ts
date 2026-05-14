import type { QueryDef, QueryParamType } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartBuilderInput,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
import { buildEChartsLineRecipe } from "@/renderers/echarts/recipes/stage-chart-recipes";
import {
  selectAlias,
  outputField,
  shortName,
  standardQueryType,
  quoteSqlIdentifier,
} from "@/ai/authoring/tools/datasource-schema-utils";

function requiredField(fields: StageChartSqlInput["fields"], role: StageChartFieldRole) {
  const field = fields[role];
  if (!field) throw new Error(`stageChart line requires fields.${role}`);
  return field;
}

export const echartsLineBuilder: StageChartBuilder = {
  skillId: "echarts-line",
  build(input: StageChartBuilderInput) {
    return buildEChartsLineRecipe(input);
  },
  buildQueryDef(input): QueryDef | null {
    const time = requiredField(input.fields, "time");
    const metric = requiredField(input.fields, "metric");
    const timeSrc = quoteSqlIdentifier(shortName(time.source_field));
    let timeSql: string;
    let timeType: QueryParamType;
    if (input.timeGrain && input.timeGrain !== "day") {
      if (input.schema.dialect !== "postgres") {
        throw new Error(`time_grain "${input.timeGrain}" is only supported for postgres.`);
      }
      timeSql = `date_trunc('${input.timeGrain}', ${timeSrc})::date`;
      timeType = "date";
    } else {
      timeSql = timeSrc;
      timeType = standardQueryType({ name: time.source_field, type: time.type ?? "string" });
    }
    const agg = metric.aggregation?.toLowerCase() ?? "sum";
    const metricSrc = quoteSqlIdentifier(shortName(metric.source_field));
    const metricSql = agg === "count" ? `count(${metricSrc})` : `${agg}(${metricSrc})`;

    const seriesField = input.fields.series;
    if (seriesField) {
      const seriesSrc = quoteSqlIdentifier(shortName(seriesField.source_field));
      return {
        id: input.queryId,
        name: input.title,
        datasource_id: input.datasourceId,
        sql_template: `select ${selectAlias(timeSql, "time_value")}, ${selectAlias(seriesSrc, "series_value")}, ${selectAlias(metricSql, "metric_value")} from ${input.tableName}${input.whereClause} group by 1, 2 order by 1 ${input.sort?.direction ?? "asc"}${input.limit ? ` limit ${input.limit}` : ""}`,
        params: [],
        output: {
          kind: "rows",
          schema: [
            outputField({ name: "time_value", type: timeType, nullable: true }),
            outputField({ name: "series_value", type: standardQueryType({ name: seriesField.source_field, type: seriesField.type ?? "string" }), nullable: true }),
            outputField({ name: "metric_value", type: "number", nullable: true }),
          ],
        },
      };
    }

    return {
      id: input.queryId,
      name: input.title,
      datasource_id: input.datasourceId,
      sql_template: `select ${selectAlias(timeSql, "time_value")}, ${selectAlias(metricSql, "metric_value")} from ${input.tableName}${input.whereClause} group by 1 order by 1 ${input.sort?.direction ?? "asc"}${input.limit ? ` limit ${input.limit}` : ""}`,
      params: [],
      output: { kind: "rows", schema: [outputField({ name: "time_value", type: timeType, nullable: true }), outputField({ name: "metric_value", type: "number", nullable: true })] },
    };
  },
};
