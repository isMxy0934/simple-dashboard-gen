import "server-only";

import type { Pool } from "pg";

export interface IntrospectedColumn {
  name: string;
  data_type: string;
  nullable?: boolean;
  comment?: string;
  primary_key?: boolean;
  indexed?: boolean;
}

export interface IntrospectedTable {
  name: string;
  comment?: string;
  columns: IntrospectedColumn[];
}

export interface IntrospectedSchema {
  name: string;
  tables: IntrospectedTable[];
}

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  table_comment: string | null;
  column_comment: string | null;
  is_primary_key: boolean;
  is_indexed: boolean;
}

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

/**
 * Introspect Postgres schemas/tables/columns for management UI (read-only).
 */
export async function introspectPostgresSchemas(pool: Pool): Promise<IntrospectedSchema[]> {
  const result = await pool.query<ColumnRow>(
    `
      select
        table_schema,
        table_name,
        column_name,
        data_type,
        is_nullable,
        obj_description(cls.oid, 'pg_class') as table_comment,
        col_description(cls.oid, attr.attnum) as column_comment,
        exists (
          select 1
          from pg_index idx
          where idx.indrelid = cls.oid
            and idx.indisprimary
            and attr.attnum = any(idx.indkey)
        ) as is_primary_key,
        exists (
          select 1
          from pg_index idx
          where idx.indrelid = cls.oid
            and attr.attnum = any(idx.indkey)
        ) as is_indexed
      from information_schema.columns
      left join pg_namespace ns
        on ns.nspname = table_schema
      left join pg_class cls
        on cls.relnamespace = ns.oid
       and cls.relname = table_name
      left join pg_attribute attr
        on attr.attrelid = cls.oid
       and attr.attname = column_name
      where table_schema not in ('information_schema', 'pg_catalog', 'pg_toast')
        and table_schema not like 'pg_%'
      order by table_schema asc, table_name asc, ordinal_position asc
    `,
  );

  const schemaMap = new Map<string, Map<string, { comment?: string; columns: IntrospectedColumn[] }>>();

  for (const row of result.rows) {
    if (SYSTEM_SCHEMAS.has(row.table_schema)) {
      continue;
    }
    let tables = schemaMap.get(row.table_schema);
    if (!tables) {
      tables = new Map();
      schemaMap.set(row.table_schema, tables);
    }
    let table = tables.get(row.table_name);
    if (!table) {
      table = {
        ...(row.table_comment ? { comment: row.table_comment } : {}),
        columns: [],
      };
      tables.set(row.table_name, table);
    }
    table.columns.push({
      name: row.column_name,
      data_type: row.data_type,
      nullable: row.is_nullable === "YES",
      ...(row.column_comment ? { comment: row.column_comment } : {}),
      primary_key: row.is_primary_key,
      indexed: row.is_indexed,
    });
  }

  const schemas: IntrospectedSchema[] = [];
  for (const [schemaName, tableMap] of [...schemaMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const tables: IntrospectedTable[] = [];
    for (const [tableName, table] of [...tableMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      tables.push({
        name: tableName,
        ...(table.comment ? { comment: table.comment } : {}),
        columns: table.columns,
      });
    }
    schemas.push({ name: schemaName, tables });
  }

  return schemas;
}
