import "server-only";

import {
  decryptConnectionSecretJson,
  getDatasourceConnectionById,
} from "./datasource-connection-repository";
import type { DatasourceEngineKind } from "./datasource-types";

export async function resolveDatasourceSecretForExecution(datasourceId: string): Promise<{
  kind: DatasourceEngineKind;
  secretJson: string;
}> {
  const row = await getDatasourceConnectionById(datasourceId);
  if (!row) {
    throw new Error("Datasource not found.");
  }
  return {
    kind: row.kind,
    secretJson: decryptConnectionSecretJson(row),
  };
}
