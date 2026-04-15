import "server-only";

import type { QueryResultRow } from "pg";
import type {
  BindingRow,
  DatasourceContext,
  DatasourceField,
  DatasourceMetric,
  JsonValue,
  QueryDef,
} from "../../contracts";
import { resolveEngine } from "./engine-registry";
import { buildDatasourceContextFromIntrospection } from "./datasource-context-builder";
import { resolveDatasourceSecretForExecution } from "./datasource-resolve";
import { postgresEngine } from "./engines/postgres-engine";
import { getPgPool } from "./postgres";

interface DatasourceColumnRow extends QueryResultRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
}

const DEFAULT_DATASOURCE_ID = "ds_sales_weekly";
const DATASOURCE_LABEL = "Weekly Sales";
const DATASOURCE_DESCRIPTION =
  "Weekly sales facts and quality metrics for dashboard authoring.";
const SUPPORTED_TABLES = ["sales_weekly_fact", "sales_quality"] as const;
const SUPPORTED_FIELDS = [
  "week_start",
  "region",
  "gmv",
  "orders",
  "channel",
  "conversion_rate",
] as const;

const TABLE_DESCRIPTIONS: Record<string, string> = {
  sales_weekly_fact: "Weekly sales fact table aggregated by week and region.",
  sales_quality: "Channel quality snapshot used for sales quality review.",
};

const FIELD_DESCRIPTIONS: Record<string, string> = {
  week_start: "Week bucket start date.",
  region: "Sales region.",
  gmv: "Gross merchandise value.",
  orders: "Order count.",
  channel: "Acquisition or engagement channel.",
  conversion_rate: "Conversion rate over the selected period.",
};

const METRICS: DatasourceMetric[] = [
  {
    id: "gmv",
    label: "GMV",
    description: "Gross merchandise value",
    default_aggregation: "sum",
  },
  {
    id: "orders",
    label: "Orders",
    description: "Order volume",
    default_aggregation: "sum",
  },
  {
    id: "conversion_rate",
    label: "Conversion Rate",
    description: "Average conversion rate",
    default_aggregation: "avg",
  },
];

export function listAvailableDatasourceDefinitions() {
  return [
    {
      datasource_id: DEFAULT_DATASOURCE_ID,
      label: DATASOURCE_LABEL,
      description: DATASOURCE_DESCRIPTION,
    },
  ];
}

export async function loadDatasourceContext(
  datasourceId = DEFAULT_DATASOURCE_ID,
): Promise<DatasourceContext> {
  if (datasourceId === DEFAULT_DATASOURCE_ID) {
    return loadBuiltinSalesWeeklyContext();
  }

  const { kind, secretJson } = await resolveDatasourceSecretForExecution(datasourceId);
  if (kind === "postgres") {
    const schemas = await postgresEngine.introspectSchema(secretJson);
    return buildDatasourceContextFromIntrospection(datasourceId, "postgres", schemas);
  }
  if (kind === "athena") {
    const engine = resolveEngine("athena");
    const schemas = await engine.introspectSchema(secretJson);
    return buildDatasourceContextFromIntrospection(datasourceId, "athena", schemas);
  }

  throw new Error(`Unsupported datasource kind: ${String(kind)}`);
}

async function loadBuiltinSalesWeeklyContext(): Promise<DatasourceContext> {
  const datasourceId = DEFAULT_DATASOURCE_ID;
  const pool = getPgPool();
  const result = await pool.query<DatasourceColumnRow>(
    `
      select
        table_name,
        column_name,
        data_type,
        udt_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name asc, ordinal_position asc
    `,
    [[...SUPPORTED_TABLES]],
  );

  if (result.rows.length === 0) {
    throw new Error("Datasource tables are unavailable in PostgreSQL.");
  }

  const tables = SUPPORTED_TABLES.map((tableName) => ({
    name: tableName,
    description: TABLE_DESCRIPTIONS[tableName],
    fields: result.rows
      .filter((row) => row.table_name === tableName)
      .map((row) => buildDatasourceField(row)),
  })).filter((table) => table.fields.length > 0);

  return {
    datasource_id: datasourceId,
    dialect: "postgres",
    tables,
    metrics: METRICS.filter((metric) =>
      tables.some((table) => table.fields.some((field) => field.name === metric.id)),
    ),
    visibility_scope: {
      allowed_tables: [...SUPPORTED_TABLES],
      allowed_fields: [...SUPPORTED_FIELDS],
    },
  };
}

export async function executeDatasourceQuery(
  query: QueryDef,
  params: Record<string, JsonValue>,
): Promise<BindingRow[]> {
  const { kind, secretJson } = await resolveDatasourceSecretForExecution(query.datasource_id);
  return resolveEngine(kind).executeReadOnlyQuery(secretJson, query, params);
}

function buildDatasourceField(row: DatasourceColumnRow): DatasourceField {
  const semanticType = inferSemanticType(row.column_name);
  const isMetric = semanticType === "metric";

  return {
    name: row.column_name,
    type: mapPostgresType(row.data_type, row.udt_name),
    semantic_type: semanticType,
    filterable: semanticType === "time" || semanticType === "dimension" || undefined,
    aggregations: isMetric ? aggregationsForField(row.column_name) : undefined,
    description: FIELD_DESCRIPTIONS[row.column_name],
  };
}

function inferSemanticType(
  columnName: string,
): "time" | "dimension" | "metric" | undefined {
  if (columnName === "week_start") {
    return "time";
  }

  if (columnName === "region" || columnName === "channel") {
    return "dimension";
  }

  if (columnName === "gmv" || columnName === "orders" || columnName === "conversion_rate") {
    return "metric";
  }

  return undefined;
}

function aggregationsForField(columnName: string): string[] | undefined {
  if (columnName === "conversion_rate") {
    return ["avg"];
  }

  if (columnName === "gmv" || columnName === "orders") {
    return ["sum", "avg"];
  }

  return undefined;
}

function mapPostgresType(dataType: string, udtName: string) {
  if (dataType === "date") {
    return "date";
  }

  if (dataType === "timestamp without time zone" || dataType === "timestamp with time zone") {
    return "datetime";
  }

  if (
    dataType === "integer" ||
    dataType === "bigint" ||
    dataType === "smallint" ||
    dataType === "double precision" ||
    dataType === "real" ||
    dataType === "numeric"
  ) {
    return "number";
  }

  if (dataType === "boolean") {
    return "boolean";
  }

  if (udtName === "json" || udtName === "jsonb") {
    return "string";
  }

  return "string";
}
