import "server-only";

import type { BindingRow, JsonValue, QueryDef } from "../../contracts";
import type { IntrospectedSchema } from "./postgres-introspect";
import type { DatasourceEngineKind } from "./datasource-types";

export interface DatasourceEngine {
  readonly kind: DatasourceEngineKind;
  testConnection(secretJson: string): Promise<void>;
  introspectSchema(secretJson: string): Promise<IntrospectedSchema[]>;
  executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
  ): Promise<BindingRow[]>;
}
