import "server-only";

import type { QueryResultRow } from "pg";

export interface DatasourceColumnRow extends QueryResultRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
}
