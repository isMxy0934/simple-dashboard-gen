import "server-only";

export type DatasourceEngineKind = "postgres" | "athena";

export interface PostgresConnectionSecret {
  connectionUrl: string;
}

export interface AthenaConnectionSecret {
  region: string;
  workgroup?: string;
  database: string;
  catalog?: string;
  outputLocation: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export type DatasourceSecretPayload = PostgresConnectionSecret | AthenaConnectionSecret;

export interface ResolvedBuiltinPostgres {
  kind: "postgres";
  builtinId: "ds_sales_weekly";
}

export interface ResolvedDbDatasource {
  kind: DatasourceEngineKind;
  datasourceId: string;
  secret: DatasourceSecretPayload;
}

export type ResolvedDatasource = ResolvedBuiltinPostgres | ResolvedDbDatasource;
