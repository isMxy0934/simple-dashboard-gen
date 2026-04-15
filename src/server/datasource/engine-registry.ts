import "server-only";

import type { DatasourceEngineKind } from "./datasource-types";
import type { DatasourceEngine } from "./datasource-engine";
import { athenaEngine } from "./engines/athena-engine";
import { postgresEngine } from "./engines/postgres-engine";

const engines: Record<DatasourceEngineKind, DatasourceEngine> = {
  postgres: postgresEngine,
  athena: athenaEngine,
};

export function resolveEngine(kind: DatasourceEngineKind): DatasourceEngine {
  return engines[kind];
}
