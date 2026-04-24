"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDatasource,
  DatasourceDeleteError,
  deleteDatasource,
  fetchDatasourceSchema,
  fetchManagementDatasources,
  type DatasourceSchemaResponse,
  type ManagementDatasourceSummary,
  type ManagementEngineKind,
} from "../api/datasource-api";
import type { TranslateFn } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

type PanelView = "list" | "detail" | "add";

interface DatasourcePanelProps {
  actionMessage: string;
}

function formatDatasourceDeleteError(
  error: DatasourceDeleteError,
  t: TranslateFn,
): string {
  const summary = t("management.datasources.deleteInUse", {
    count: error.referenceCount,
  });
  if (error.dashboardIds.length === 0) {
    return summary;
  }

  return `${summary}\n${t("management.datasources.deleteInUseDashboards", {
    ids: error.dashboardIds.join(", "),
  })}`;
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
  const [searchValue, setSearchValue] = useState("");

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

  const filteredList = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return list;
    return list.filter((entry) => {
      if (entry.label.toLowerCase().includes(q)) return true;
      if (entry.description.toLowerCase().includes(q)) return true;
      if (entry.datasource_id.toLowerCase().includes(q)) return true;
      if (entry.engine_kind.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [list, searchValue]);

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
    setListError("");
    try {
      await deleteDatasource(id);
      if (view === "detail" && selectedEntry?.datasource_id === id) {
        goBack();
      }
      await reload();
    } catch (error) {
      setListError(
        error instanceof DatasourceDeleteError
          ? formatDatasourceDeleteError(error, t)
          : t("management.datasources.deleteFailed"),
      );
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
      <section className={styles.listPanel}>
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
                <span className={styles.confirmLabel}>{t("management.datasources.confirmDelete")}</span>
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

        {listError ? (
          <p className={styles.datasourceError} role="alert">{listError}</p>
        ) : null}

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
      </section>
    );
  }

  if (view === "add") {
    return (
      <section className={styles.listPanel}>
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
              className={styles.primaryAction}
              disabled={createBusy || !canSubmit}
              onClick={() => void handleCreate()}
            >
              {createBusy ? t("management.datasources.creating") : t("management.datasources.create")}
            </button>
          </div>
        </div>
      </div>
      </section>
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  const bannerText = listError || actionMessage.trim();
  const showToolbarNote = Boolean(bannerText);

  return (
    <section className={styles.listPanel}>
      {showToolbarNote ? (
        <div className={styles.listHeaderBanner} role={listError ? "alert" : "status"}>
          <span className={listError ? styles.datasourceError : styles.listMetaNote}>
            {bannerText}
          </span>
        </div>
      ) : null}

      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>{t("management.datasources.title")}</h2>
        <div className={styles.listToolbar}>
          <input
            type="search"
            className={styles.searchInput}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("management.datasources.searchPlaceholder")}
          />
          <button type="button" className={styles.primaryAction} onClick={openAdd}>
            {t("management.datasources.addTitle")}
          </button>
        </div>
      </div>

      <div className={styles.listViewport}>
        <div className={styles.listHeaderRow}>
          <span>{t("management.list.colName")}</span>
          <span>{t("management.datasources.colEngine")}</span>
          <span>{t("management.datasources.colId")}</span>
          <span className={styles.listHeaderRowActions}>{t("management.list.colActions")}</span>
        </div>
        <div className={styles.listRows}>
          {listStatus === "loading" ? (
            <div className={styles.emptyState}>
              <strong>{t("management.datasources.loading")}</strong>
            </div>
          ) : list.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{t("management.datasources.emptyTitle")}</strong>
              <p>{t("management.datasources.emptyHint")}</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{t("management.list.noMatchTitle")}</strong>
              <p>{t("management.list.noMatchHint")}</p>
            </div>
          ) : (
            filteredList.map((entry) => (
              <article
                key={entry.datasource_id}
                className={`${styles.listRow} ${styles.dsListRow}`}
                onClick={() => openDetail(entry)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetail(entry);
                  }
                }}
              >
                <div className={styles.listRowMain}>
                  <strong>{entry.label}</strong>
                  <span>{entry.description || t("common.noDescription")}</span>
                </div>
                <div className={styles.listRowStatus}>
                  <span className={styles.metaChip}>{engineLabel(entry.engine_kind)}</span>
                </div>
                <span className={styles.updatedAt} title={entry.datasource_id}>
                  <code className={styles.dsListRowId}>{entry.datasource_id}</code>
                </span>
                <div
                  className={styles.actions}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {pendingDeleteId === entry.datasource_id ? (
                    <>
                      <span className={styles.confirmLabel}>
                        {t("management.datasources.confirmDelete")}
                      </span>
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
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.dangerAction}
                      onClick={() => setPendingDeleteId(entry.datasource_id)}
                    >
                      {t("management.datasources.delete")}
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
