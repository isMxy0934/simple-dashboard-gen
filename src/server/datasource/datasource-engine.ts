import "server-only";

import type { BindingRow, JsonValue, QueryDef } from "../../contracts";
import type { IntrospectedSchema } from "./postgres-introspect";
import type { DatasourceEngineKind } from "./datasource-types";

export type DatasourceDiagnosticMetadata = Record<string, string | number | boolean | null | undefined>;

export class DatasourceEngineDiagnosticError extends Error {
  readonly code: string;
  readonly metadata: DatasourceDiagnosticMetadata;

  constructor(
    message: string,
    input: {
      code: string;
      metadata?: DatasourceDiagnosticMetadata;
    },
  ) {
    super(message);
    this.name = "DatasourceEngineDiagnosticError";
    this.code = input.code;
    this.metadata = input.metadata ?? {};
  }
}

export interface DatasourceEngine {
  readonly kind: DatasourceEngineKind;
  testConnection(secretJson: string): Promise<void>;
  introspectSchema(secretJson: string): Promise<IntrospectedSchema[]>;
  executeReadOnlyQuery(
    secretJson: string,
    query: QueryDef,
    params: Record<string, JsonValue>,
    options?: { rowLimit?: number },
  ): Promise<BindingRow[]>;
}
