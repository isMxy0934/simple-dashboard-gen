import type { QueryDef, QueryParamType } from "@/contracts";
import type {
  StageChartBuilder,
  StageChartBuilderInput,
  StageChartBuilderOutput,
  StageChartSqlInput,
  StageChartFieldRole,
} from "@/ai/authoring/skills/contract";
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
  build(input: StageChartBuilderInput): StageChartBuilderOutput {
    if (input.fields.series) {
      return {
        renderer: {
          kind: "echarts",
          option_template: {
            tooltip: { trigger: "axis" },
            legend: {},
            grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
            dataset: { source: [] },
            xAxis: { type: "category" },
            yAxis: { type: "value" },
            series: [],
          },
          slots: [
            {
              id: "dataset",
              path: "dataset.source",
              value_kind: "rows",
              required: true,
            },
          ],
          transforms: [
            {
              id: "pivot_dataset",
              kind: "pivot_rows",
              source_slot: "dataset",
              row_key: "time_value",
              column_key: "series_value",
              value_field: "metric_value",
              target_path: "dataset.source",
            },
            {
              id: "dynamic_series",
              kind: "generate_series",
              source_transform: "pivot_dataset",
              target_path: "series",
              series_type: "line",
              encode_x: "time_value",
              defaults: { smooth: true, showSymbol: false },
            },
          ],
        },
        bindings: [
          { slot_id: "dataset", field_role: "series", value_kind: "rows", required: true },
        ],
        layout: { desktop: { w: 8, h: 6 }, mobile: { w: 4, h: 6 } },
      };
    }
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          tooltip: { trigger: "axis" },
          grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
          xAxis: { type: "category", data: [] },
          yAxis: { type: "value" },
          series: [{ type: "line", data: [], smooth: true, showSymbol: false }],
        },
        slots: [
          { id: "time", path: "xAxis.data", value_kind: "array", required: true },
          { id: "value", path: "series[0].data", value_kind: "array", required: true },
        ],
      },
      bindings: [
        { slot_id: "time", field_role: "time", value_kind: "array", required: true },
        { slot_id: "value", field_role: "metric", value_kind: "array", required: true },
      ],
      layout: { desktop: { w: 8, h: 6 }, mobile: { w: 4, h: 6 } },
    };
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
