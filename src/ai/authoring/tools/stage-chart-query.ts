import type {
  Binding,
  DatasourceContext,
  DatasourceField,
  DatasourceTable,
  QueryDef,
} from "@/contracts";
import type { StageChartToolInput } from "@/ai/authoring/contracts/tool-io";
import type { StageChartSlotBindingTemplate } from "@/ai/authoring/skills/contract";
import { getStageChartBuilder } from "@/ai/authoring/skills/registry";
import {
  buildMissingFieldMessage,
  findDatasourceField,
  quoteQualifiedSqlName,
  quoteSqlIdentifier,
  shortName,
} from "@/ai/authoring/tools/datasource-schema-utils";
import {
  assertFieldExistsInQueryOutput,
  buildResultSelector,
  resolveField,
  slugify,
  type ResolvedStageChartFields,
} from "@/ai/authoring/tools/stage-chart-resolve";

function literalSql(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Filter value must be a finite number.");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function filterOperator(op: NonNullable<StageChartToolInput["filters"]>[number]["op"]): string {
  switch (op) {
    case "eq":
      return "=";
    case "neq":
      return "<>";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
  }
}

function buildWhereClause(input: {
  table: DatasourceTable;
  filters: StageChartToolInput["filters"];
}): string {
  if (!input.filters?.length) {
    return "";
  }
  const clauses = input.filters.map((filter) => {
    const field = findDatasourceField(input.table, filter.field);
    if (!field) {
      throw new Error(buildMissingFieldMessage(input.table, filter.field));
    }
    return `${quoteSqlIdentifier(shortName(field.name))} ${filterOperator(filter.op)} ${literalSql(filter.value)}`;
  });
  return ` where ${clauses.join(" and ")}`;
}

export function buildQuery(input: {
  toolInput: StageChartToolInput;
  queryId: string;
  schema: DatasourceContext;
  table: DatasourceTable;
  fields: ResolvedStageChartFields;
}): QueryDef | null {
  const mode = input.toolInput.data_mode ?? "live";
  if (mode === "mock") {
    return null;
  }
  const builder = getStageChartBuilder(input.toolInput.skill_id);
  if (!builder || !builder.buildQueryDef) {
    throw new Error(`Unsupported stageChart skill "${input.toolInput.skill_id}" for SQL generation.`);
  }
  const tableName = quoteQualifiedSqlName(input.table.name);
  const whereClause = buildWhereClause({
    table: input.table,
    filters: input.toolInput.filters,
  });
  return builder.buildQueryDef({
    queryId: input.queryId,
    title: input.toolInput.title,
    datasourceId: input.toolInput.datasource_id,
    tableName,
    whereClause,
    fields: input.fields,
    sort: input.toolInput.sort,
    timeGrain: input.toolInput.time_grain,
    limit: input.toolInput.limit,
    schema: { dialect: input.schema.dialect },
  });
}

export function buildBindings(input: {
  toolInput: StageChartToolInput;
  viewId: string;
  query: QueryDef | null;
  templates: StageChartSlotBindingTemplate[];
  fields: ResolvedStageChartFields;
}): Binding[] {
  const mode = input.toolInput.data_mode ?? (input.query ? "live" : "mock");
  if (mode === "live" && !input.query) {
    throw new Error("stageChart live mode requires runtime-generated query support for the selected chart skill.");
  }
  return input.templates.map((template) => {
    const field = resolveField(input.fields, template.field_role);
    if (!field) {
      throw new Error(
        `stageChart requires fields.${template.field_role}.source_field for skill slot "${template.slot_id}".`,
      );
    }
    assertFieldExistsInQueryOutput({
      query: input.query,
      bindingTemplate: template,
      field,
    });
    const bindingId = `b_${slugify(input.viewId)}_${slugify(template.slot_id)}`;
    if (mode === "mock") {
      return {
        id: bindingId,
        view_id: input.viewId,
        slot_id: template.slot_id,
        mode: "mock",
        ...(template.value_kind === "scalar"
          ? { mock_value: input.toolInput.mock_value ?? 0 }
          : {
              mock_data:
                input.toolInput.mock_data ?? {
                  rows: [{ [field.result_field]: template.value_kind === "array" ? "Sample" : 0 }],
                },
            }),
      };
    }
    return {
      id: bindingId,
      view_id: input.viewId,
      slot_id: template.slot_id,
      mode: "live",
      query_id: input.query?.id,
      param_mapping: {},
      result_selector: buildResultSelector({
        query: input.query as QueryDef,
        bindingTemplate: template,
        field,
      }),
    };
  });
}
