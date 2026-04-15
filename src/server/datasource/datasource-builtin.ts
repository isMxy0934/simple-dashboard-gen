import "server-only";

const BUILTIN_IDS = new Set(["ds_sales_weekly"]);

export function isBuiltinDatasourceId(id: string): boolean {
  return BUILTIN_IDS.has(id);
}
