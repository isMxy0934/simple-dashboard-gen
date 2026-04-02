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
import { getRowsOutputSchema } from "../../domain/dashboard/contract-kernel";
import { getPgPool } from "./postgres";

const DEFAULT_DATASOURCE_ID = "ds_sales_weekly";
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

interface DatasourceColumnRow extends QueryResultRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
}

export async function loadDatasourceContext(
  datasourceId = DEFAULT_DATASOURCE_ID,
): Promise<DatasourceContext> {
  if (datasourceId !== DEFAULT_DATASOURCE_ID) {
    throw new Error(`Unsupported datasource: ${datasourceId}`);
  }

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
  if (query.datasource_id !== DEFAULT_DATASOURCE_ID) {
    throw new Error(`Unsupported datasource_id: ${query.datasource_id}`);
  }

  const compiled = compileSqlTemplate(query.sql_template, params);
  assertReadOnlySql(compiled.text);

  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin read only");
    await client.query("set local statement_timeout = '5000ms'");
    const result = await client.query(compiled.text, compiled.values);
    await client.query("rollback");
    return result.rows.map((row) => normalizeQueryRow(row, query));
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // noop
    }
    throw error;
  } finally {
    client.release();
  }
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

function compileSqlTemplate(
  sqlTemplate: string,
  params: Record<string, JsonValue>,
): { text: string; values: JsonValue[] } {
  const values: JsonValue[] = [];
  const text = sqlTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, paramName) => {
    if (!(paramName in params)) {
      throw new Error(`Missing SQL param: ${paramName}`);
    }
    values.push(params[paramName]);
    return `$${values.length}`;
  });

  return { text, values };
}

function assertReadOnlySql(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    throw new Error("Only SELECT or WITH queries are allowed.");
  }

  if (normalized.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do)\b/i.test(normalized)) {
    throw new Error("Only read-only SQL is allowed.");
  }
}

function normalizeQueryRow(row: QueryResultRow, query: QueryDef): BindingRow {
  const normalized: BindingRow = {};
  const schemaByField = new Map(
    getRowsOutputSchema(query).map((field) => [field.name, field]),
  );

  Object.entries(row).forEach(([key, value]) => {
    normalized[key] = normalizeFieldValue(value, schemaByField.get(key)?.type);
  });

  return normalized;
}

function normalizeFieldValue(
  value: unknown,
  expectedType?: ReturnType<typeof getRowsOutputSchema>[number]["type"],
): BindingRow[string] {
  if (value === null) {
    return null;
  }

  if (expectedType === "number") {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = Number(value);
      return Number.isFinite(normalized) ? normalized : value;
    }
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}
