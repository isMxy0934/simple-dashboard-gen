"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createDatasource,
  DatasourceRequestError,
  DatasourceDeleteError,
  deleteDatasource,
  fetchDatasourceSchema,
  fetchManagementDatasources,
  testDatasourceConnection,
  type DatasourceFailureDiagnostic,
  type DatasourceSchemaResponse,
  type ManagementDatasourceSummary,
  type ManagementEngineKind,
} from "../api/datasource-api";
import type { TranslateFn } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import { normalizeSchemaAllowlist } from "@/shared/datasource-schema-allowlist";
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
  const [deleteBlocker, setDeleteBlocker] = useState<DatasourceDeleteError | null>(null);
  const [deleteError, setDeleteError] = useState("");

  // ── detail / schema ───────────────────────────────────────────────────────
  const [schema, setSchema] = useState<DatasourceSchemaResponse | null>(null);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "loading" | "error">("idle");
  const [schemaError, setSchemaError] = useState("");
  const [schemaDiagnostic, setSchemaDiagnostic] = useState<DatasourceFailureDiagnostic | null>(null);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  // ── add form ──────────────────────────────────────────────────────────────
  const [formLabel, setFormLabel] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formEngine, setFormEngine] = useState<ManagementEngineKind>("postgres");
  const [formUrl, setFormUrl] = useState("");
  const [formSchemaAllowlist, setFormSchemaAllowlist] = useState("");
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
  const [createDiagnostic, setCreateDiagnostic] = useState<DatasourceFailureDiagnostic | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testDiagnostic, setTestDiagnostic] = useState<DatasourceFailureDiagnostic | null>(null);
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    setTestStatus("idle");
    setTestMessage("");
    setTestDiagnostic(null);
  }, [
    formAccessKeyId,
    formCatalog,
    formDatabase,
    formEngine,
    formOutputLocation,
    formRegion,
    formSchemaAllowlist,
    formSecretAccessKey,
    formSessionToken,
    formUrl,
    formWorkgroup,
  ]);

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
    setSchemaDiagnostic(null);
    setExpandedTables({});

    void fetchDatasourceSchema(selectedEntry.datasource_id)
      .then((data) => {
        if (!cancelled) {
          setSchema(data);
          setSchemaStatus("idle");
          // pre-expand all schemas, tables collapsed by default
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSchemaStatus("error");
          setSchemaDiagnostic(
            error instanceof DatasourceRequestError ? error.diagnostic : null,
          );
          setSchemaError(
            error instanceof Error ? error.message : t("management.datasources.schemaLoadFailed"),
          );
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
    setDeleteBlocker(null);
    setDeleteError("");
    setPendingDeleteId(null);
    setView("detail");
  }

  function openAdd() {
    setCreateError("");
    setCreateDiagnostic(null);
    setTestStatus("idle");
    setTestMessage("");
    setTestDiagnostic(null);
    setView("add");
  }

  function goBack() {
    setView("list");
    setSelectedEntry(null);
    setPendingDeleteId(null);
    setDeleteBlocker(null);
    setDeleteError("");
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
    setDeleteBlocker(null);
    setDeleteError("");
    try {
      await deleteDatasource(id);
      if (view === "detail" && selectedEntry?.datasource_id === id) {
        goBack();
      }
      await reload();
    } catch (error) {
      if (error instanceof DatasourceDeleteError) {
        setDeleteBlocker(error);
      } else {
        setDeleteError(t("management.datasources.deleteFailed"));
      }
    } finally {
      setDeleteBusyId(null);
    }
  }

  const canSubmit =
    formLabel.trim() &&
    (formEngine === "postgres"
      ? formUrl.trim()
      : formRegion.trim() && formDatabase.trim() && formOutputLocation.trim());
  const canTestConnection =
    formEngine === "postgres"
      ? Boolean(formUrl.trim())
      : Boolean(formRegion.trim() && formDatabase.trim() && formOutputLocation.trim());

  function buildDatasourceMutationInput() {
    if (formEngine === "postgres") {
      return {
        label: formLabel.trim() || "Connection test",
        description: formDescription,
        engine_kind: "postgres" as const,
        postgres: {
          connectionUrl: formUrl.trim(),
          schemaAllowlist: normalizeSchemaAllowlist(formSchemaAllowlist),
        },
      };
    }

    return {
      label: formLabel.trim() || "Connection test",
      description: formDescription,
      engine_kind: "athena" as const,
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
    };
  }

  async function handleTestConnection() {
    setTestBusy(true);
    setTestStatus("idle");
    setTestMessage("");
    setTestDiagnostic(null);
    setCreateError("");
    setCreateDiagnostic(null);
    try {
      await testDatasourceConnection(buildDatasourceMutationInput());
      setTestStatus("success");
      setTestMessage(t("management.datasources.testSucceeded"));
    } catch (error) {
      setTestStatus("error");
      setTestDiagnostic(
        error instanceof DatasourceRequestError ? error.diagnostic : null,
      );
      setTestMessage(
        error instanceof Error ? error.message : t("management.datasources.testFailed"),
      );
    } finally {
      setTestBusy(false);
    }
  }

  async function handleCreate() {
    setCreateBusy(true);
    setCreateError("");
    setCreateDiagnostic(null);
    try {
      await createDatasource({
        ...buildDatasourceMutationInput(),
        label: formLabel.trim(),
      });
      setFormLabel("");
      setFormDescription("");
      setFormUrl("");
      setFormSchemaAllowlist("");
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
      setCreateDiagnostic(
        error instanceof DatasourceRequestError ? error.diagnostic : null,
      );
      setCreateError(
        error instanceof Error ? error.message : t("management.datasources.createFailed"),
      );
    } finally {
      setCreateBusy(false);
    }
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || createBusy) {
      return;
    }
    void handleCreate();
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (view === "detail" && selectedEntry) {
    const schemaSummary = schema
      ? schema.schemas.reduce(
          (acc, schemaNode) => {
            acc.schemaCount += 1;
            acc.tableCount += schemaNode.tables.length;
            acc.columnCount += schemaNode.tables.reduce(
              (sum, table) => sum + table.columns.length,
              0,
            );
            return acc;
          },
          { schemaCount: 0, tableCount: 0, columnCount: 0 },
        )
      : { schemaCount: 0, tableCount: 0, columnCount: 0 };
    const statValue = (value: number) =>
      schemaStatus === "loading" ? "..." : schemaStatus === "error" ? "-" : value;
    const schemaStatusLabel =
      schemaStatus === "loading"
        ? t("management.datasources.schemaLoading")
        : schemaStatus === "error"
          ? t("management.datasources.schemaFailed")
          : schema
            ? t("management.datasources.schemaReady")
            : t("management.datasources.schemaEmpty");
    const dialectLabel = engineLabel(schema?.dialect ?? selectedEntry.engine_kind);

    return (
      <section className={styles.pageCard}>
        <header className={styles.dsDetailHeader}>
          <div className={styles.dsDetailHeaderMain}>
            <button type="button" className={styles.dsBackButton} onClick={goBack}>
              ← {t("management.datasources.back")}
            </button>
            <div className={styles.dsDetailMeta}>
              <h2 className={styles.dsDetailTitle}>{selectedEntry.label}</h2>
              <div className={styles.dsDetailBadges}>
                <span className={styles.dsBadge}>{engineLabel(selectedEntry.engine_kind)}</span>
                <span className={`${styles.chip} ${styles.chipTeal}`}>
                  {t("management.datasources.registered")}
                </span>
              </div>
              <p className={styles.dsDetailDescription}>
                {selectedEntry.description || t("common.noDescription")}
              </p>
            </div>
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

        {deleteBlocker ? (
          <DatasourceDeleteBlockedPanel blocker={deleteBlocker} t={t} />
        ) : deleteError ? (
          <p className={styles.datasourceError} role="alert">{deleteError}</p>
        ) : null}

        <div className={styles.tableSection}>
          <div className={styles.dsDetailMetrics}>
            <article className={styles.dsMetricCard}>
              <span>{t("management.datasources.detailStatus")}</span>
              <strong>{t("management.datasources.registered")}</strong>
              <small>{t("management.datasources.detailStatusHint")}</small>
            </article>
            <article className={styles.dsMetricCard}>
              <span>{t("management.datasources.statSchemas")}</span>
              <strong>{statValue(schemaSummary.schemaCount)}</strong>
              <small>{schemaStatusLabel}</small>
            </article>
            <article className={styles.dsMetricCard}>
              <span>{t("management.datasources.statTables")}</span>
              <strong>{statValue(schemaSummary.tableCount)}</strong>
              <small>{t("management.datasources.schemaTitle")}</small>
            </article>
            <article className={styles.dsMetricCard}>
              <span>{t("management.datasources.statColumns")}</span>
              <strong>{statValue(schemaSummary.columnCount)}</strong>
              <small>{t("management.datasources.schemaBrowserHint")}</small>
            </article>
          </div>

          <div className={styles.dsDetailGrid}>
            <section className={styles.dsSchemaCard}>
              <header className={styles.dsSubCardHeader}>
                <div>
                  <h3>{t("management.datasources.schemaBrowserTitle")}</h3>
                  <span>{t("management.datasources.schemaBrowserHint")}</span>
                </div>
                <span className={`${styles.chip} ${schemaStatus === "error" ? styles.chipRose : styles.chipTeal}`}>
                  {schemaStatusLabel}
                </span>
              </header>
              <div className={styles.dsSchemaPane}>
                {schemaStatus === "loading" ? (
                  <p className={styles.muted}>{t("management.datasources.schemaLoading")}</p>
                ) : schemaStatus === "error" ? (
                  <DatasourceDiagnosticPanel
                    diagnostic={schemaDiagnostic}
                    fallbackMessage={schemaError}
                    t={t}
                  />
                ) : schema && schema.schemas.length > 0 ? (
                  schema.schemas.map((schemaNode) => (
                    <div key={schemaNode.name} className={styles.dsSchemaGroup}>
                      <div className={styles.dsSchemaGroupLabel}>
                        <span>{schemaNode.name}</span>
                        <span className={styles.dsSchemaBadge}>
                          {t("management.datasources.tableCount", {
                            count: schemaNode.tables.length,
                          })}
                        </span>
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
                                aria-expanded={expanded}
                                onClick={() => toggleTable(schemaNode.name, table.name)}
                              >
                                <span className={styles.dsTableChevron}>{expanded ? "▾" : "▸"}</span>
                                <span className={styles.dsTableName}>{table.name}</span>
                                <span className={styles.dsTableColCount}>
                                  {t("management.datasources.columnCount", {
                                    count: table.columns.length,
                                  })}
                                </span>
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
            </section>

            <aside className={styles.dsSideStack}>
              <section className={styles.dsInfoCard}>
                <h3>{t("management.datasources.connectionTitle")}</h3>
                <dl className={styles.dsDefinitionList}>
                  <div>
                    <dt>{t("management.datasources.sourceId")}</dt>
                    <dd><code>{selectedEntry.datasource_id}</code></dd>
                  </div>
                  <div>
                    <dt>{t("management.datasources.colEngine")}</dt>
                    <dd>{dialectLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("management.datasources.detailStatus")}</dt>
                    <dd>{t("management.datasources.registered")}</dd>
                  </div>
                </dl>
                <p className={styles.dsInfoNote}>{t("management.datasources.credentialsHidden")}</p>
              </section>

              <section className={styles.dsInfoCard}>
                <h3>{t("management.datasources.authoringTitle")}</h3>
                <div className={styles.dsCapabilityList}>
                  <div>
                    <strong>{t("management.datasources.authoringPicker")}</strong>
                    <span>{t("management.datasources.authoringPickerHint")}</span>
                  </div>
                  <div>
                    <strong>{t("management.datasources.schemaAccess")}</strong>
                    <span>{schemaStatusLabel}</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    );
  }

  if (view === "add") {
    const hasBasicInfo = Boolean(formLabel.trim());
    const hasConnectionParams = Boolean(
      formEngine === "postgres"
        ? formUrl.trim()
        : formRegion.trim() && formDatabase.trim() && formOutputLocation.trim(),
    );
    const scopeLabel =
      formEngine === "postgres"
        ? t("management.datasources.fieldSchemaAllowlist")
        : t("management.datasources.fieldDatabase");
    const scopeValue =
      formEngine === "postgres"
        ? formSchemaAllowlist.trim() || t("management.datasources.scopeAllSchemas")
        : formDatabase.trim() || t("management.datasources.scopePending");

    const checklistItems = [
      {
        complete: hasBasicInfo,
        label: t("management.datasources.checkBasic"),
        hint: t("management.datasources.checkBasicHint"),
      },
      {
        complete: hasConnectionParams,
        label: t("management.datasources.checkConnection"),
        hint: t("management.datasources.checkConnectionHint"),
      },
      {
        complete: testStatus === "success",
        active: testStatus === "error" || hasConnectionParams,
        label: t("management.datasources.checkSaveTest"),
        hint: testBusy
          ? t("management.datasources.checkSaveTesting")
          : testStatus === "success"
            ? t("management.datasources.testSucceeded")
            : testStatus === "error"
              ? t("management.datasources.testFailed")
              : t("management.datasources.checkSaveTestHint"),
      },
      {
        complete: false,
        active: testStatus === "success",
        label: t("management.datasources.checkSchema"),
        hint: t("management.datasources.checkSchemaHint"),
      },
    ];

    return (
      <section className={styles.pageCard}>
        <header className={styles.pageHead}>
          <div className={styles.dsAddHeadMain}>
            <button type="button" className={styles.dsBackButton} onClick={goBack}>
              ← {t("management.datasources.back")}
            </button>
            <div className={styles.pageTitleInline}>
              <h2>{t("management.datasources.addTitle")}</h2>
              <span>{t("management.datasources.addLead")}</span>
            </div>
          </div>
          <div className={styles.chipRow}>
            <span className={`${styles.chip} ${styles.chipGold}`}>
              {t("management.common.notConnected")}
            </span>
            <button type="button" className={styles.secondaryAction} onClick={goBack}>
              {t("management.datasources.cancelAdd")}
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              disabled={testBusy || createBusy || !canTestConnection}
              onClick={() => void handleTestConnection()}
            >
              {testBusy ? t("management.datasources.testing") : t("management.datasources.testConnection")}
            </button>
            <button
              type="submit"
              form="datasource-create-form"
              className={styles.primaryAction}
              disabled={createBusy || !canSubmit}
            >
              {createBusy ? t("management.datasources.creating") : t("management.datasources.create")}
            </button>
          </div>
        </header>

        <div className={styles.dsAddLayout}>
          <form
            id="datasource-create-form"
            className={styles.dsAddFormStack}
            onSubmit={handleCreateSubmit}
          >
            {createError ? (
              <DatasourceDiagnosticPanel
                diagnostic={createDiagnostic}
                fallbackMessage={createError}
                t={t}
              />
            ) : null}

            {testStatus === "success" ? (
              <p className={styles.inlineNote} role="status">{testMessage}</p>
            ) : null}

            {testStatus === "error" ? (
              <DatasourceDiagnosticPanel
                diagnostic={testDiagnostic}
                fallbackMessage={testMessage}
                t={t}
              />
            ) : null}

            <section className={styles.dsFormSection}>
              <header className={styles.dsFormSectionHeader}>
                <div>
                  <h3>{t("management.datasources.connectionTypeTitle")}</h3>
                  <span>{t("management.datasources.connectionTypeHint")}</span>
                </div>
              </header>
              <div
                className={styles.dsEngineOptions}
                role="radiogroup"
                aria-label={t("management.datasources.fieldEngine")}
              >
                {(["postgres", "athena"] as ManagementEngineKind[]).map((engine) => (
                  <label
                    key={engine}
                    className={
                      formEngine === engine
                        ? styles.dsEngineOptionActive
                        : styles.dsEngineOption
                    }
                  >
                    <input
                      type="radio"
                      name="datasource-engine"
                      className={styles.dsEngineInput}
                      value={engine}
                      checked={formEngine === engine}
                      onChange={() => setFormEngine(engine)}
                    />
                    <strong>{engineLabel(engine)}</strong>
                    <span>
                      {engine === "postgres"
                        ? t("management.datasources.enginePostgresHint")
                        : t("management.datasources.engineAthenaHint")}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className={styles.dsFormSection}>
              <header className={styles.dsFormSectionHeader}>
                <div>
                  <h3>{t("management.datasources.basicInfoTitle")}</h3>
                  <span>{t("management.datasources.basicInfoHint")}</span>
                </div>
              </header>
              <div className={styles.dsFieldGrid}>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldLabel")}
                  <input
                    name="datasource-label"
                    className={styles.fieldInput}
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {t("management.datasources.fieldDescription")}
                  <input
                    name="datasource-description"
                    className={styles.fieldInput}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            </section>

            <section className={styles.dsFormSection}>
              <header className={styles.dsFormSectionHeader}>
                <div>
                  <h3>{t("management.datasources.connectionParamsTitle")}</h3>
                  <span>{t("management.datasources.connectionParamsHint")}</span>
                </div>
              </header>

              {formEngine === "postgres" ? (
                <div className={styles.dsFieldGrid}>
                  <label className={`${styles.fieldLabel} ${styles.dsFieldWide}`}>
                    {t("management.datasources.fieldUrl")}
                    <input
                      name="datasource-postgres-url"
                      className={styles.fieldInput}
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      autoComplete="off"
                      inputMode="url"
                      placeholder="postgres://..."
                    />
                    <span className={styles.fieldHint}>
                      {t("management.datasources.fieldUrlHint")}
                    </span>
                  </label>
                  <label className={`${styles.fieldLabel} ${styles.dsFieldWide}`}>
                    {t("management.datasources.fieldSchemaAllowlist")}
                    <input
                      name="datasource-schema-allowlist"
                      className={styles.fieldInput}
                      value={formSchemaAllowlist}
                      onChange={(e) => setFormSchemaAllowlist(e.target.value)}
                      autoComplete="off"
                      placeholder="public, analytics"
                    />
                    <span className={styles.fieldHint}>
                      {t("management.datasources.fieldSchemaAllowlistHint")}
                    </span>
                  </label>
                </div>
              ) : (
                <div className={styles.dsFieldGrid}>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldRegion")}
                    <input
                      name="datasource-athena-region"
                      className={styles.fieldInput}
                      value={formRegion}
                      onChange={(e) => setFormRegion(e.target.value)}
                      autoComplete="off"
                      placeholder="us-east-1"
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldDatabase")}
                    <input
                      name="datasource-athena-database"
                      className={styles.fieldInput}
                      value={formDatabase}
                      onChange={(e) => setFormDatabase(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className={`${styles.fieldLabel} ${styles.dsFieldWide}`}>
                    {t("management.datasources.fieldOutputLocation")}
                    <input
                      name="datasource-athena-output-location"
                      className={styles.fieldInput}
                      value={formOutputLocation}
                      onChange={(e) => setFormOutputLocation(e.target.value)}
                      autoComplete="off"
                      inputMode="url"
                      placeholder="s3://bucket/prefix/"
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldWorkgroup")}
                    <input
                      name="datasource-athena-workgroup"
                      className={styles.fieldInput}
                      value={formWorkgroup}
                      onChange={(e) => setFormWorkgroup(e.target.value)}
                      autoComplete="off"
                      placeholder="primary"
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldCatalog")}
                    <input
                      name="datasource-athena-catalog"
                      className={styles.fieldInput}
                      value={formCatalog}
                      onChange={(e) => setFormCatalog(e.target.value)}
                      autoComplete="off"
                      placeholder="AwsDataCatalog"
                    />
                  </label>
                </div>
              )}
            </section>

            {formEngine === "athena" ? (
              <details className={styles.dsAdvancedSection}>
                <summary>
                  <span>{t("management.datasources.advancedCredentialsTitle")}</span>
                  <small>{t("management.datasources.advancedCredentialsHint")}</small>
                </summary>
                <div className={styles.dsFieldGrid}>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldAccessKeyId")}
                    <input
                      name="datasource-athena-access-key-id"
                      className={styles.fieldInput}
                      value={formAccessKeyId}
                      onChange={(e) => setFormAccessKeyId(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t("management.datasources.fieldSecretAccessKey")}
                    <input
                      name="datasource-athena-secret-access-key"
                      className={styles.fieldInput}
                      type="password"
                      value={formSecretAccessKey}
                      onChange={(e) => setFormSecretAccessKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className={`${styles.fieldLabel} ${styles.dsFieldWide}`}>
                    {t("management.datasources.fieldSessionToken")}
                    <input
                      name="datasource-athena-session-token"
                      className={styles.fieldInput}
                      value={formSessionToken}
                      onChange={(e) => setFormSessionToken(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
              </details>
            ) : null}
          </form>

          <aside className={styles.dsAddRail}>
            <section className={styles.dsInfoCard}>
              <h3>{t("management.datasources.setupStatusTitle")}</h3>
              <ul className={styles.dsChecklist}>
                {checklistItems.map((item) => (
                  <li
                    key={item.label}
                    className={
                      item.complete
                        ? styles.dsChecklistDone
                        : item.active
                          ? styles.dsChecklistActive
                          : styles.dsChecklistTodo
                    }
                  >
                    <span>{item.complete ? "✓" : item.active ? "•" : "○"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.dsInfoCard}>
              <h3>{t("management.datasources.connectionSummaryTitle")}</h3>
              <dl className={styles.dsDefinitionList}>
                <div>
                  <dt>{t("management.datasources.colEngine")}</dt>
                  <dd>{engineLabel(formEngine)}</dd>
                </div>
                <div>
                  <dt>{scopeLabel}</dt>
                  <dd>{scopeValue}</dd>
                </div>
              </dl>
              <p className={styles.dsInfoNote}>{t("management.datasources.addHint")}</p>
            </section>

            <section className={styles.dsInfoCard}>
              <h3>{t("management.datasources.saveImpactTitle")}</h3>
              <div className={styles.dsCapabilityList}>
                <div>
                  <strong>{t("management.datasources.saveImpactReports")}</strong>
                  <span>{t("management.datasources.saveImpactReportsHint")}</span>
                </div>
                <div>
                  <strong>{t("management.datasources.saveImpactSchema")}</strong>
                  <span>{t("management.datasources.saveImpactSchemaHint")}</span>
                </div>
                <div>
                  <strong>{t("management.datasources.saveImpactSecrets")}</strong>
                  <span>{t("management.datasources.credentialsHidden")}</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  const bannerText = listError || actionMessage.trim();
  const showToolbarNote = Boolean(bannerText);

  return (
    <section className={styles.pageCard}>
      {showToolbarNote ? (
        <div className={styles.listHeaderBanner} role={listError ? "alert" : "status"}>
          <span className={listError ? styles.datasourceError : styles.listMetaNote}>
            {bannerText}
          </span>
        </div>
      ) : null}

      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.datasources.title")}</h2>
          <span>{t("management.datasources.lead")}</span>
        </div>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${styles.chipTeal}`}>
            {t("management.datasources.healthyCount", { count: list.length })}
          </span>
          <button type="button" className={styles.primaryAction} onClick={openAdd}>
            {t("management.datasources.addTitle")}
          </button>
        </div>
      </header>

      <div className={styles.tableSection}>
        <div className={styles.reportToolbar}>
          <input
            type="search"
            name="datasource-search"
            aria-label={t("management.datasources.searchPlaceholder")}
            autoComplete="off"
            className={styles.searchInput}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("management.datasources.searchPlaceholder")}
          />
        </div>

        <div className={`${styles.listViewport} ${styles.sourcesTable}`}>
          <div className={styles.listHeaderRow}>
            <span>{t("management.datasources.colSource")}</span>
            <span>{t("management.datasources.colEngine")}</span>
            <span>{t("management.datasources.colStatus")}</span>
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
                >
                  <div className={styles.rowTitle}>
                    <span className={`${styles.docMark} ${styles.docMarkTeal}`}>
                      {createInitials(entry.label)}
                    </span>
                    <span>
                      <strong>{entry.label}</strong>
                      <span>{entry.description || t("common.noDescription")}</span>
                    </span>
                  </div>
                  <span>{engineLabel(entry.engine_kind)}</span>
                  <span className={`${styles.chip} ${styles.chipTeal}`}>
                    {t("management.datasources.registered")}
                  </span>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => openDetail(entry)}
                    >
                      {t("management.datasources.detailsAction")}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DatasourceDeleteBlockedPanel({
  blocker,
  t,
}: {
  blocker: DatasourceDeleteError;
  t: TranslateFn;
}) {
  const hiddenCount = Math.max(0, blocker.referenceCount - blocker.dashboardIds.length);

  return (
    <section className={styles.dsDeleteBlockedPanel} role="alert">
      <div className={styles.dsDeleteBlockedMark} aria-hidden="true">
        !
      </div>
      <div className={styles.dsDeleteBlockedBody}>
        <header className={styles.dsDeleteBlockedHeader}>
          <div>
            <strong>{t("management.datasources.deleteBlockedTitle")}</strong>
            <span>{t("management.datasources.deleteBlockedLead")}</span>
          </div>
          <span className={`${styles.chip} ${styles.chipRose}`}>
            {t("management.datasources.deleteBlockedCount", {
              count: blocker.referenceCount,
            })}
          </span>
        </header>

        {blocker.dashboardIds.length > 0 ? (
          <div className={styles.dsDeleteReferenceList}>
            <span>{t("management.datasources.deleteBlockedReportsTitle")}</span>
            <ul>
              {blocker.dashboardIds.map((id) => (
                <li key={id}>
                  <code title={id}>{shortResourceId(id)}</code>
                </li>
              ))}
              {hiddenCount > 0 ? (
                <li>
                  <span>
                    {t("management.datasources.deleteBlockedMore", { count: hiddenCount })}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <div className={styles.dsDeleteBlockedActionRow}>
          <a className={styles.secondaryAction} href="/?section=reports">
            {t("management.datasources.deleteBlockedOpenReports")}
          </a>
          <span>{t("management.datasources.deleteBlockedActionHint")}</span>
        </div>
      </div>
    </section>
  );
}

function createInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "D";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function shortResourceId(id: string) {
  if (id.length <= 18) {
    return id;
  }
  return `${id.slice(0, 10)}...${id.slice(-6)}`;
}

function DatasourceDiagnosticPanel({
  diagnostic,
  fallbackMessage,
  t,
}: {
  diagnostic: DatasourceFailureDiagnostic | null;
  fallbackMessage: string;
  t: TranslateFn;
}) {
  const metadataEntries = Object.entries(diagnostic?.metadata ?? {});
  const diagnosticHints = getDatasourceDiagnosticHints(diagnostic, t);

  return (
    <section className={styles.dsDiagnosticPanel} role="alert">
      <header className={styles.dsDiagnosticHeader}>
        <span>{t("management.datasources.diagnosticTitle")}</span>
        {diagnostic?.code ? <code>{diagnostic.code}</code> : null}
      </header>
      <p>{diagnostic?.message || fallbackMessage}</p>

      {diagnostic ? (
        <dl className={styles.dsDiagnosticGrid}>
          <div>
            <dt>{t("management.datasources.diagnosticEngine")}</dt>
            <dd>{diagnostic.engine_kind ?? "-"}</dd>
          </div>
          <div>
            <dt>{t("management.datasources.diagnosticStage")}</dt>
            <dd>{diagnostic.stage ?? "-"}</dd>
          </div>
          {diagnostic.raw_code ? (
            <div>
              <dt>{t("management.datasources.diagnosticRawCode")}</dt>
              <dd>{diagnostic.raw_code}</dd>
            </div>
          ) : null}
          {typeof diagnostic.http_status === "number" ? (
            <div>
              <dt>{t("management.datasources.diagnosticHttpStatus")}</dt>
              <dd>{diagnostic.http_status}</dd>
            </div>
          ) : null}
          {metadataEntries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {diagnosticHints.length ? (
        <div className={styles.dsDiagnosticHints}>
          <strong>{t("management.datasources.diagnosticHints")}</strong>
          <ul>
            {diagnosticHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const diagnosticHintKeys: Record<string, string> = {
  POSTGRES_AUTH_FAILED: "management.datasources.diagnosticHintPostgresAuth",
  POSTGRES_DATABASE_NOT_FOUND: "management.datasources.diagnosticHintPostgresDatabase",
  POSTGRES_PERMISSION_DENIED: "management.datasources.diagnosticHintPostgresPermission",
  POSTGRES_NETWORK_FAILED: "management.datasources.diagnosticHintPostgresNetwork",
  POSTGRES_SCHEMA_NOT_FOUND: "management.datasources.diagnosticHintPostgresSchema",
  ATHENA_CREDENTIALS_INVALID: "management.datasources.diagnosticHintAthenaCredentials",
  ATHENA_CONFIGURATION_INCOMPLETE: "management.datasources.diagnosticHintAthenaConfig",
  ATHENA_PERMISSION_DENIED: "management.datasources.diagnosticHintAthenaPermission",
  ATHENA_OUTPUT_LOCATION_FAILED: "management.datasources.diagnosticHintAthenaS3",
  ATHENA_WORKGROUP_FAILED: "management.datasources.diagnosticHintAthenaWorkgroup",
  ATHENA_DATABASE_OR_CATALOG_FAILED: "management.datasources.diagnosticHintAthenaDatabase",
  ATHENA_REGION_FAILED: "management.datasources.diagnosticHintAthenaRegion",
  ATHENA_TIMEOUT: "management.datasources.diagnosticHintAthenaTimeout",
};

function getDatasourceDiagnosticHints(
  diagnostic: DatasourceFailureDiagnostic | null,
  t: TranslateFn,
) {
  if (!diagnostic) {
    return [];
  }

  const localizedHintKey = diagnostic.code ? diagnosticHintKeys[diagnostic.code] : undefined;
  if (localizedHintKey) {
    return [t(localizedHintKey)];
  }

  return diagnostic.hints ?? [];
}
