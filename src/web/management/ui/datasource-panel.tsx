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

type PanelView = "list" | "detail" | "add";

interface DatasourcePanelProps {
  actionMessage: string;
}

export function DatasourcePanel({ actionMessage }: DatasourcePanelProps) {
  const { t } = useI18n();

  // ── navigation ────────────────────────────────────────────────────────────
  const [view, setView] = useState<PanelView>("list");
  const [selectedEntry, setSelectedEntry] = useState<ManagementDatasourceSummary | null>(null);

  // ── list ──────────────────────────────────────────────────────────────────
  const [list, setList] = useState<ManagementDatasourceSummary[]>([]);
  const [listStatus, setListStatus] = useState<"idle" | "loading" | "error">("loading");
  const [listError, setListError] = useState("");
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── detail / schema ───────────────────────────────────────────────────────
  const [schema, setSchema] = useState<DatasourceSchemaResponse | null>(null);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "loading" | "error">("idle");
  const [schemaError, setSchemaError] = useState("");
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  // ── add form ──────────────────────────────────────────────────────────────
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
  const [createError, setCreateError] = useState("");

  // ── data loading ──────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setListStatus("loading");
    setListError("");
    try {
      const next = await fetchManagementDatasources();
      setList(next);
      setListStatus("idle");
    } catch {
      setListStatus("error");
      setListError(t("management.datasources.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (view !== "detail" || !selectedEntry) {
      setSchema(null);
      return;
    }

    let cancelled = false;
    setSchemaStatus("loading");
    setSchemaError("");
    setExpandedTables({});

    void fetchDatasourceSchema(selectedEntry.datasource_id)
      .then((data) => {
        if (!cancelled) {
          setSchema(data);
          setSchemaStatus("idle");
          // pre-expand all schemas, tables collapsed by default
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSchemaStatus("error");
          setSchemaError(t("management.datasources.schemaLoadFailed"));
          setSchema(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [view, selectedEntry, t]);

  // ── actions ───────────────────────────────────────────────────────────────
  function openDetail(entry: ManagementDatasourceSummary) {
    setSelectedEntry(entry);
    setView("detail");
  }

  function openAdd() {
    setCreateError("");
    setView("add");
  }

  function goBack() {
    setView("list");
    setSelectedEntry(null);
    setPendingDeleteId(null);
  }

  function toggleTable(schemaName: string, tableName: string) {
    const key = `${schemaName}.${tableName}`;
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function engineLabel(kind: ManagementEngineKind) {
    return kind === "postgres"
      ? t("management.datasources.enginePostgres")
      : t("management.datasources.engineAthena");
  }

  async function handleDelete(id: string) {
    setDeleteBusyId(id);
    setPendingDeleteId(null);
    try {
      await deleteDatasource(id);
      if (view === "detail" && selectedEntry?.datasource_id === id) {
        goBack();
      }
      await reload();
    } catch {
      setListError(t("management.datasources.deleteFailed"));
    } finally {
      setDeleteBusyId(null);
    }
  }

  const canSubmit =
    formLabel.trim() &&
    (formEngine === "postgres"
      ? formUrl.trim()
      : formRegion.trim() && formDatabase.trim() && formOutputLocation.trim());

  async function handleCreate() {
    setCreateBusy(true);
    setCreateError("");
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
      setView("list");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t("management.datasources.createFailed"),
      );
    } finally {
      setCreateBusy(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (view === "detail" && selectedEntry) {
    return (
      <div className={styles.dsDetailShell}>
        <header className={styles.dsDetailHeader}>
          <button type="button" className={styles.dsBackButton} onClick={goBack}>
            ← {t("management.datasources.back")}
          </button>
          <div className={styles.dsDetailMeta}>
            <h2 className={styles.dsDetailTitle}>{selectedEntry.label}</h2>
            <div className={styles.dsDetailBadges}>
              <span className={styles.dsBadge}>{engineLabel(selectedEntry.engine_kind)}</span>
            </div>
            {selectedEntry.description ? (
              <p className={styles.dsDetailDescription}>{selectedEntry.description}</p>
            ) : null}
          </div>
          {pendingDeleteId === selectedEntry.datasource_id ? (
              <div className={styles.dsDetailDeleteConfirm}>
                <span className={styles.muted}>{t("management.datasources.confirmDelete")}</span>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => setPendingDeleteId(null)}
                >
                  {t("management.action.cancelDelete")}
                </button>
                <button
                  type="button"
                  className={styles.dangerAction}
                  disabled={deleteBusyId === selectedEntry.datasource_id}
                  onClick={() => void handleDelete(selectedEntry.datasource_id)}
                >
                  {t("management.action.confirmDelete")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.dangerAction}
                onClick={() => setPendingDeleteId(selectedEntry.datasource_id)}
              >
                {t("management.datasources.delete")}
              </button>
            )}
        </header>

        <div className={styles.dsSchemaPane}>
          {schemaStatus === "loading" ? (
            <p className={styles.muted}>{t("management.datasources.schemaLoading")}</p>
          ) : schemaStatus === "error" ? (
            <p className={styles.datasourceError} role="alert">{schemaError}</p>
          ) : schema && schema.schemas.length > 0 ? (
            schema.schemas.map((schemaNode) => (
              <div key={schemaNode.name} className={styles.dsSchemaGroup}>
                <div className={styles.dsSchemaGroupLabel}>
                  {schemaNode.name}
                  <span className={styles.dsSchemaBadge}>{schemaNode.tables.length}</span>
                </div>
                <div className={styles.dsTableList}>
                  {schemaNode.tables.map((table) => {
                    const key = `${schemaNode.name}.${table.name}`;
                    const expanded = expandedTables[key] ?? false;
                    return (
                      <div key={key} className={styles.dsTableBlock}>
                        <button
                          type="button"
                          className={`${styles.dsTableToggle} ${expanded ? styles.dsTableToggleExpanded : ""}`}
                          onClick={() => toggleTable(schemaNode.name, table.name)}
                        >
                          <span className={styles.dsTableChevron}>{expanded ? "▾" : "▸"}</span>
                          <span className={styles.dsTableName}>{table.name}</span>
                          <span className={styles.dsTableColCount}>{table.columns.length} cols</span>
                        </button>
                        {expanded ? (
                          <ul className={styles.dsColumnList}>
                            {table.columns.map((col) => (
                              <li key={col.name} className={styles.dsColumnRow}>
                                <code className={styles.dsColumnName}>{col.name}</code>
                                <span className={styles.dsColumnType}>{col.data_type}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <p className={styles.muted}>{t("management.datasources.schemaEmpty")}</p>
          )}
        </div>
      </div>
    );
  }

  if (view === "add") {
    return (
      <div className={styles.dsDetailShell}>
        <header className={styles.dsDetailHeader}>
          <button type="button" className={styles.dsBackButton} onClick={goBack}>
            ← {t("management.datasources.back")}
          </button>
          <h2 className={styles.dsDetailTitle}>{t("management.datasources.addTitle")}</h2>
        </header>

        <div className={styles.dsAddPane}>
          <p className={styles.muted}>{t("management.datasources.addHint")}</p>

          {createError ? (
            <p className={styles.datasourceError} role="alert">{createError}</p>
          ) : null}

          <div className={styles.datasourceForm}>
            <label className={styles.fieldLabel}>
              {t("management.datasources.fieldEngine")}
              <select
                className={styles.fieldInput}
                value={formEngine}
                onChange={(e) => setFormEngine(e.target.value as ManagementEngineKind)}
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
                onChange={(e) => setFormLabel(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={styles.fieldLabel}>
              {t("management.datasources.fieldDescription")}
              <input
                className={styles.fieldInput}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                autoComplete="off"
              />
            </label>

            {formEngine === "postgres" ? (
              <label className={styles.fieldLabel}>
                {t("management.datasources.fieldUrl")}
                <input
                  className={styles.fieldInput}
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  autoComplete="off"
                  placeholder="postgres://..."
                />
              </label>
            ) : (
              <>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldRegion")}
                  <input className={styles.fieldInput} value={formRegion} onChange={(e) => setFormRegion(e.target.value)} autoComplete="off" placeholder="us-east-1" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldDatabase")}
                  <input className={styles.fieldInput} value={formDatabase} onChange={(e) => setFormDatabase(e.target.value)} autoComplete="off" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldOutputLocation")}
                  <input className={styles.fieldInput} value={formOutputLocation} onChange={(e) => setFormOutputLocation(e.target.value)} autoComplete="off" placeholder="s3://bucket/prefix/" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldWorkgroup")}
                  <input className={styles.fieldInput} value={formWorkgroup} onChange={(e) => setFormWorkgroup(e.target.value)} autoComplete="off" placeholder="primary" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldCatalog")}
                  <input className={styles.fieldInput} value={formCatalog} onChange={(e) => setFormCatalog(e.target.value)} autoComplete="off" placeholder="AwsDataCatalog" />
                </label>
                <p className={styles.muted}>{t("management.datasources.athenaAwsHint")}</p>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldAccessKeyId")}
                  <input className={styles.fieldInput} value={formAccessKeyId} onChange={(e) => setFormAccessKeyId(e.target.value)} autoComplete="off" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldSecretAccessKey")}
                  <input className={styles.fieldInput} type="password" value={formSecretAccessKey} onChange={(e) => setFormSecretAccessKey(e.target.value)} autoComplete="off" />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldSessionToken")}
                  <input className={styles.fieldInput} value={formSessionToken} onChange={(e) => setFormSessionToken(e.target.value)} autoComplete="off" />
                </label>
              </>
            )}

            <button
              type="button"
              className={styles.primaryButton}
              disabled={createBusy || !canSubmit}
              onClick={() => void handleCreate()}
            >
              {createBusy ? t("management.datasources.creating") : t("management.datasources.create")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.dsListShell}>
      <header className={styles.listHeader}>
        <div>
          <div className={styles.headerEyebrow}>{t("management.datasources.eyebrow")}</div>
          <h2 className={styles.listTitle}>{t("management.datasources.title")}</h2>
        </div>
        <div className={styles.listToolbar}>
          {actionMessage.trim() ? (
            <span className={styles.listMetaNote} role="status">{actionMessage}</span>
          ) : null}
          <button type="button" className={styles.primaryAction} onClick={openAdd}>
            {t("management.datasources.addTitle")}
          </button>
        </div>
      </header>

      {listError ? (
        <p className={styles.datasourceError} role="alert">{listError}</p>
      ) : null}

      {listStatus === "loading" ? (
        <p className={styles.muted}>{t("management.datasources.loading")}</p>
      ) : list.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{t("management.datasources.emptyTitle")}</strong>
          <p>{t("management.datasources.emptyHint")}</p>
        </div>
      ) : (
        <div className={styles.dsCardGrid}>
          {list.map((entry) => (
            <article
              key={entry.datasource_id}
              className={styles.dsCard}
              onClick={() => openDetail(entry)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openDetail(entry);
              }}
            >
              <div className={styles.dsCardBody}>
                <strong className={styles.dsCardName}>{entry.label}</strong>
                {entry.description ? (
                  <p className={styles.dsCardDescription}>{entry.description}</p>
                ) : null}
              </div>
              <div className={styles.dsCardFooter}>
                <span className={styles.dsBadge}>{engineLabel(entry.engine_kind)}</span>
                {pendingDeleteId === entry.datasource_id ? (
                    <div className={styles.dsCardDeleteConfirm} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() => setPendingDeleteId(null)}
                      >
                        {t("management.action.cancelDelete")}
                      </button>
                      <button
                        type="button"
                        className={styles.dangerAction}
                        disabled={deleteBusyId === entry.datasource_id}
                        onClick={() => void handleDelete(entry.datasource_id)}
                      >
                        {t("management.action.confirmDelete")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.dsCardDeleteButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(entry.datasource_id);
                      }}
                    >
                      {t("management.datasources.delete")}
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
