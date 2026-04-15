"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createDatasource,
  deleteDatasource,
  fetchDatasourceSchema,
  fetchManagementDatasources,
  type DatasourceSchemaResponse,
  type ManagementDatasourceSummary,
  type ManagementEngineKind,
} from "../api/datasource-api";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

interface DatasourcePanelProps {
  actionMessage: string;
}

export function DatasourcePanel({ actionMessage }: DatasourcePanelProps) {
  const { t } = useI18n();
  const [list, setList] = useState<ManagementDatasourceSummary[]>([]);
  const [listStatus, setListStatus] = useState<"idle" | "loading" | "error">("loading");
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState<DatasourceSchemaResponse | null>(null);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "loading" | "error">("idle");
  const [schemaError, setSchemaError] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  const [formLabel, setFormLabel] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formEngine, setFormEngine] = useState<ManagementEngineKind>("postgres");
  const [formUrl, setFormUrl] = useState("");
  const [formRegion, setFormRegion] = useState("");
  const [formDatabase, setFormDatabase] = useState("");
  const [formOutputLocation, setFormOutputLocation] = useState("");
  const [formWorkgroup, setFormWorkgroup] = useState("");
  const [formCatalog, setFormCatalog] = useState("");
  const [formAccessKeyId, setFormAccessKeyId] = useState("");
  const [formSecretAccessKey, setFormSecretAccessKey] = useState("");
  const [formSessionToken, setFormSessionToken] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setListStatus("loading");
    setListError("");
    try {
      const next = await fetchManagementDatasources();
      setList(next);
      setListStatus("idle");
      setSelectedId((previous) => {
        if (next.length === 0) {
          return null;
        }
        if (previous && next.some((entry) => entry.datasource_id === previous)) {
          return previous;
        }
        return next[0].datasource_id;
      });
    } catch (error) {
      setListStatus("error");
      setListError(error instanceof Error ? error.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedId) {
      setSchema(null);
      return;
    }

    let cancelled = false;
    setSchemaStatus("loading");
    setSchemaError("");
    void fetchDatasourceSchema(selectedId)
      .then((data) => {
        if (!cancelled) {
          setSchema(data);
          setSchemaStatus("idle");
          setExpandedSchemas({});
          setExpandedTables({});
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSchemaStatus("error");
          setSchemaError(error instanceof Error ? error.message : "Schema failed");
          setSchema(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const canSubmit =
    formLabel.trim() &&
    (formEngine === "postgres"
      ? formUrl.trim()
      : formRegion.trim() && formDatabase.trim() && formOutputLocation.trim());

  async function handleCreate() {
    setCreateBusy(true);
    try {
      if (formEngine === "postgres") {
        await createDatasource({
          label: formLabel,
          description: formDescription,
          engine_kind: "postgres",
          postgres_url: formUrl,
        });
      } else {
        await createDatasource({
          label: formLabel,
          description: formDescription,
          engine_kind: "athena",
          athena: {
            region: formRegion.trim(),
            database: formDatabase.trim(),
            outputLocation: formOutputLocation.trim(),
            workgroup: formWorkgroup.trim() || undefined,
            catalog: formCatalog.trim() || undefined,
            accessKeyId: formAccessKeyId.trim() || undefined,
            secretAccessKey: formSecretAccessKey.trim() || undefined,
            sessionToken: formSessionToken.trim() || undefined,
          },
        });
      }
      setFormLabel("");
      setFormDescription("");
      setFormUrl("");
      setFormRegion("");
      setFormDatabase("");
      setFormOutputLocation("");
      setFormWorkgroup("");
      setFormCatalog("");
      setFormAccessKeyId("");
      setFormSecretAccessKey("");
      setFormSessionToken("");
      await reload();
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("management.datasources.confirmDelete"))) {
      return;
    }
    setDeleteBusyId(id);
    try {
      await deleteDatasource(id);
      if (selectedId === id) {
        setSelectedId(null);
      }
      await reload();
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeleteBusyId(null);
    }
  }

  function toggleSchema(name: string) {
    setExpandedSchemas((current) => ({
      ...current,
      [name]: !current[name],
    }));
  }

  function toggleTable(schemaName: string, tableName: string) {
    const key = `${schemaName}.${tableName}`;
    setExpandedTables((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function engineLabel(kind: ManagementEngineKind) {
    return kind === "postgres"
      ? t("management.datasources.enginePostgres")
      : t("management.datasources.engineAthena");
  }

  return (
    <div className={styles.datasourceShell}>
      <header className={styles.datasourceHeader}>
        <div>
          <div className={styles.headerEyebrow}>{t("management.datasources.eyebrow")}</div>
          <h2 className={styles.datasourceTitle}>{t("management.datasources.title")}</h2>
          <p className={styles.datasourceLead}>{t("management.datasources.lead")}</p>
        </div>
        {actionMessage.trim() ? (
          <p className={styles.inlineNote} role="status">
            {actionMessage}
          </p>
        ) : null}
      </header>

      {listError ? (
        <p className={styles.datasourceError} role="alert">
          {listError}
        </p>
      ) : null}

      <div className={styles.datasourceGrid}>
        <section className={styles.datasourceCard}>
          <h3 className={styles.datasourceCardTitle}>{t("management.datasources.listTitle")}</h3>
          {listStatus === "loading" ? (
            <p className={styles.muted}>{t("management.datasources.loading")}</p>
          ) : (
            <ul className={styles.datasourceList}>
              {list.map((entry) => (
                <li key={entry.datasource_id}>
                  <button
                    type="button"
                    className={`${styles.datasourceRow} ${
                      selectedId === entry.datasource_id ? styles.datasourceRowActive : ""
                    }`}
                    onClick={() => setSelectedId(entry.datasource_id)}
                  >
                    <span className={styles.datasourceRowLabel}>{entry.label}</span>
                    <span className={styles.datasourceRowMeta}>
                      {entry.kind === "builtin"
                        ? t("management.datasources.kindBuiltin")
                        : t("management.datasources.kindCustom")}
                      {" · "}
                      {engineLabel(entry.engine_kind)}
                    </span>
                  </button>
                  {entry.kind === "custom" ? (
                    <button
                      type="button"
                      className={styles.datasourceDelete}
                      disabled={deleteBusyId === entry.datasource_id}
                      onClick={() => void handleDelete(entry.datasource_id)}
                    >
                      {t("management.datasources.delete")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.datasourceCard}>
          <h3 className={styles.datasourceCardTitle}>{t("management.datasources.schemaTitle")}</h3>
          {schemaStatus === "loading" ? (
            <p className={styles.muted}>{t("management.datasources.schemaLoading")}</p>
          ) : schemaStatus === "error" ? (
            <p className={styles.datasourceError} role="alert">
              {schemaError}
            </p>
          ) : schema && schema.schemas.length > 0 ? (
            <div className={styles.schemaTree}>
              {schema.schemas.map((schemaNode) => (
                <div key={schemaNode.name} className={styles.schemaBlock}>
                  <button
                    type="button"
                    className={styles.schemaToggle}
                    onClick={() => toggleSchema(schemaNode.name)}
                  >
                    {expandedSchemas[schemaNode.name] ? "▼" : "▶"} 📂 {schemaNode.name}
                  </button>
                  {expandedSchemas[schemaNode.name] ? (
                    <div className={styles.tableList}>
                      {schemaNode.tables.map((table) => {
                        const tk = `${schemaNode.name}.${table.name}`;
                        return (
                          <div key={tk} className={styles.tableBlock}>
                            <button
                              type="button"
                              className={styles.tableToggle}
                              onClick={() => toggleTable(schemaNode.name, table.name)}
                            >
                              {expandedTables[tk] ? "▼" : "▶"} 📄 {table.name}
                            </button>
                            {expandedTables[tk] ? (
                              <ul className={styles.columnList}>
                                {table.columns.map((col) => (
                                  <li key={col.name}>
                                    <code>{col.name}</code>{" "}
                                    <span className={styles.columnType}>{col.data_type}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>{t("management.datasources.schemaEmpty")}</p>
          )}
        </section>

        <section className={`${styles.datasourceCard} ${styles.datasourceCardWide}`}>
          <h3 className={styles.datasourceCardTitle}>{t("management.datasources.addTitle")}</h3>
          <p className={styles.muted}>{t("management.datasources.addHint")}</p>
          <div className={styles.datasourceForm}>
            <label className={styles.fieldLabel}>
              {t("management.datasources.fieldEngine")}
              <select
                className={styles.fieldInput}
                value={formEngine}
                onChange={(event) =>
                  setFormEngine(event.target.value as ManagementEngineKind)
                }
              >
                <option value="postgres">{t("management.datasources.enginePostgres")}</option>
                <option value="athena">{t("management.datasources.engineAthena")}</option>
              </select>
            </label>
            <label className={styles.fieldLabel}>
              {t("management.datasources.fieldLabel")}
              <input
                className={styles.fieldInput}
                value={formLabel}
                onChange={(event) => setFormLabel(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={styles.fieldLabel}>
              {t("management.datasources.fieldDescription")}
              <input
                className={styles.fieldInput}
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                autoComplete="off"
              />
            </label>
            {formEngine === "postgres" ? (
              <label className={styles.fieldLabel}>
                {t("management.datasources.fieldUrl")}
                <input
                  className={styles.fieldInput}
                  value={formUrl}
                  onChange={(event) => setFormUrl(event.target.value)}
                  autoComplete="off"
                  placeholder="postgres://..."
                />
              </label>
            ) : (
              <>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldRegion")}
                  <input
                    className={styles.fieldInput}
                    value={formRegion}
                    onChange={(event) => setFormRegion(event.target.value)}
                    autoComplete="off"
                    placeholder="us-east-1"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldDatabase")}
                  <input
                    className={styles.fieldInput}
                    value={formDatabase}
                    onChange={(event) => setFormDatabase(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldOutputLocation")}
                  <input
                    className={styles.fieldInput}
                    value={formOutputLocation}
                    onChange={(event) => setFormOutputLocation(event.target.value)}
                    autoComplete="off"
                    placeholder="s3://bucket/prefix/"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldWorkgroup")}
                  <input
                    className={styles.fieldInput}
                    value={formWorkgroup}
                    onChange={(event) => setFormWorkgroup(event.target.value)}
                    autoComplete="off"
                    placeholder="primary"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldCatalog")}
                  <input
                    className={styles.fieldInput}
                    value={formCatalog}
                    onChange={(event) => setFormCatalog(event.target.value)}
                    autoComplete="off"
                    placeholder="AwsDataCatalog"
                  />
                </label>
                <p className={styles.muted}>{t("management.datasources.athenaAwsHint")}</p>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldAccessKeyId")}
                  <input
                    className={styles.fieldInput}
                    value={formAccessKeyId}
                    onChange={(event) => setFormAccessKeyId(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldSecretAccessKey")}
                  <input
                    className={styles.fieldInput}
                    type="password"
                    value={formSecretAccessKey}
                    onChange={(event) => setFormSecretAccessKey(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldSessionToken")}
                  <input
                    className={styles.fieldInput}
                    value={formSessionToken}
                    onChange={(event) => setFormSessionToken(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            <button
              type="button"
              className={styles.primaryButton}
              disabled={createBusy || !canSubmit}
              onClick={() => void handleCreate()}
            >
              {createBusy
                ? t("management.datasources.creating")
                : t("management.datasources.create")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
