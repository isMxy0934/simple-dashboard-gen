import "server-only";

import { isBuiltinDatasourceId } from "./datasource-builtin";
import {
  decryptConnectionSecretJson,
  getDatasourceConnectionById,
} from "./datasource-connection-repository";
import type { DatasourceEngineKind } from "./datasource-types";

const BUILTIN_POSTGRES_SECRET = JSON.stringify({ builtinPool: true });

export async function resolveDatasourceSecretForExecution(datasourceId: string): Promise<{
  kind: DatasourceEngineKind;
  secretJson: string;
}> {
  if (isBuiltinDatasourceId(datasourceId)) {
    if (datasourceId !== "ds_sales_weekly") {
      throw new Error("Unknown builtin datasource.");
    }
    return { kind: "postgres", secretJson: BUILTIN_POSTGRES_SECRET };
  }

  const row = await getDatasourceConnectionById(datasourceId);
  if (!row) {
    throw new Error("Datasource not found.");
  }

  return {
    kind: row.kind,
    secretJson: decryptConnectionSecretJson(row),
  };
}
