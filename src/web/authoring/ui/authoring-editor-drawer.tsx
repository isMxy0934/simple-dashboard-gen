"use client";

import { getBindingMode, isLiveBinding, isMockBinding } from "../../../domain/dashboard/bindings";
import { useI18n } from "../../i18n/i18n-context";
import type { Binding, BindingResults, DashboardView, QueryDef } from "../../../contracts";
import type { PreviewState } from "../state/preview-state";

interface AuthoringEditorDrawerProps {
  selectedView: DashboardView;
  selectedBinding: Binding | undefined;
  selectedBindingResult: BindingResults[string] | undefined;
  previewState: PreviewState;
  hasDataDraft: boolean;
  selectedIssues: Array<{ path: string; message: string }>;
  templateInput: string;
  setTemplateInput: (value: string) => void;
  templateError: string | null;
  onApplyTemplate: () => void;
  onResetTemplate: () => void;
  selectedQueryId: string | null;
  queryDefs: QueryDef[];
  onSelectQuery: (queryId: string | null) => void;
  onAddQuery: () => void;
  selectedQuery: QueryDef | undefined;
  queryParamsInput: string;
  setQueryParamsInput: (value: string) => void;
  querySchemaInput: string;
  setQuerySchemaInput: (value: string) => void;
  queryError: string | null;
  onQueryMetaChange: (
    field: "id" | "name" | "datasource_id" | "sql_template",
    value: string,
  ) => void;
  onApplyQueryShape: () => void;
  onCreateBinding: () => void;
  onViewMetaChange: (field: "title" | "description", value: string) => void;
  onBindingParamChange: (
    paramName: string,
    field: "source" | "value",
    value: string,
  ) => void;
  onSaveDashboard: () => Promise<void>;
  saveInFlight?: boolean;
  saveDisabled?: boolean;
  onClose: () => void;
  styles: Record<string, string>;
}

export function AuthoringEditorDrawer({
  selectedView,
  selectedBinding,
  selectedBindingResult,
  previewState,
  hasDataDraft,
  selectedIssues,
  templateInput,
  setTemplateInput,
  templateError,
  onApplyTemplate,
  onResetTemplate,
  selectedQueryId,
  queryDefs,
  onSelectQuery,
  onAddQuery,
  selectedQuery,
  queryParamsInput,
  setQueryParamsInput,
  querySchemaInput,
  setQuerySchemaInput,
  queryError,
  onQueryMetaChange,
  onApplyQueryShape,
  onCreateBinding,
  onViewMetaChange,
  onBindingParamChange,
  onSaveDashboard,
  saveInFlight = false,
  saveDisabled = false,
  onClose,
  styles,
}: AuthoringEditorDrawerProps) {
  const { t } = useI18n();
  const liveBinding = isLiveBinding(selectedBinding) ? selectedBinding : null;
  const mockBinding = isMockBinding(selectedBinding) ? selectedBinding : null;
  const viewStatus = getViewBadge(
    selectedBinding,
    selectedBindingResult,
    previewState,
    hasDataDraft,
  );

  return (
    <section className={styles.editorDrawer}>
      <div className={styles.editorDrawerHeader}>
        <div>
          <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.viewSummary")}</div>
          <h2>{selectedView.title}</h2>
          <p className={styles.editorDrawerSummary}>
            {t("authoring.editorDrawer.summary")}
          </p>
        </div>
        <div className={styles.drawerHeaderActions}>
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={saveDisabled || saveInFlight}
            onClick={() => void onSaveDashboard()}
          >
            {saveInFlight
              ? t("authoring.editorDrawer.savingDraft")
              : t("authoring.editorDrawer.saveDraft")}
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={onClose}
          >
            {t("authoring.editorDrawer.backToWorkspace")}
          </button>
        </div>
      </div>

      <div className={styles.metaStack}>
        <div className={styles.metaChip}>{formatViewStatusLabel(viewStatus, t)}</div>
        {liveBinding ? (
          <div className={styles.metaChip}>
            {t("authoring.editorDrawer.dataChip", {
              value: selectedQuery?.name ?? liveBinding.query_id,
            })}
          </div>
        ) : null}
      </div>

      {selectedBindingResult?.status === "error" ? (
        <div className={styles.errorBanner}>
          {selectedBindingResult.code}: {selectedBindingResult.message}
        </div>
      ) : null}

      <div className={styles.advancedSection}>
        <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.atAGlance")}</div>
        <p className={styles.bindingHint}>
          {getViewSummary(viewStatus, selectedBinding, selectedIssues.length, t)}
        </p>
        <label className={styles.fieldBlock}>
          <span>{t("authoring.editorDrawer.cardTitle")}</span>
          <input
            value={selectedView.title}
            onChange={(event) => onViewMetaChange("title", event.target.value)}
          />
        </label>

        <label className={styles.fieldBlock}>
          <span>{t("authoring.editorDrawer.cardDescription")}</span>
          <textarea
            rows={3}
            value={selectedView.description ?? ""}
            onChange={(event) => onViewMetaChange("description", event.target.value)}
          />
        </label>

        {selectedIssues.length > 0 ? (
          <div className={styles.issueListCompact}>
            {selectedIssues.map((issue) => (
              <div key={`${issue.path}-${issue.message}`} className={styles.issueItem}>
                <strong>{issue.message}</strong>
                <span>{issue.path}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.aiShortcuts")}</div>
        <p className={styles.bindingHint}>
          {t("authoring.editorDrawer.aiShortcutBody")}
        </p>
        <p className={styles.bindingHint}>
          {t("authoring.editorDrawer.aiShortcutExamples")}
        </p>
        <div className={styles.panelActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onClose}
          >
            {t("authoring.editorDrawer.continueInAi")}
          </button>
        </div>
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.dataSourceDetails")}</div>
        <div className={styles.querySelectRow}>
          <select
            className={styles.inlineSelect}
            value={selectedBinding?.query_id ?? selectedQueryId ?? ""}
            onChange={(event) => onSelectQuery(event.target.value || null)}
          >
            <option value="">{t("authoring.editorDrawer.chooseDataQuery")}</option>
            {queryDefs.map((query) => (
              <option key={query.id} value={query.id}>
                {query.name} ({query.id})
              </option>
            ))}
          </select>
          <button type="button" className={styles.secondaryAction} onClick={onAddQuery}>
            {t("authoring.editorDrawer.createQuery")}
          </button>
        </div>

        {selectedQuery ? (
          <>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.queryKey")}</span>
              <input
                value={selectedQuery.id}
                onChange={(event) => onQueryMetaChange("id", event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.queryLabel")}</span>
              <input
                value={selectedQuery.name}
                onChange={(event) => onQueryMetaChange("name", event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.sourceKey")}</span>
              <input
                value={selectedQuery.datasource_id}
                onChange={(event) =>
                  onQueryMetaChange("datasource_id", event.target.value)
                }
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.sql")}</span>
              <textarea
                rows={6}
                value={selectedQuery.sql_template}
                onChange={(event) =>
                  onQueryMetaChange("sql_template", event.target.value)
                }
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.paramsJson")}</span>
              <textarea
                rows={7}
                value={queryParamsInput}
                onChange={(event) => setQueryParamsInput(event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>{t("authoring.editorDrawer.outputJson")}</span>
              <textarea
                rows={7}
                value={querySchemaInput}
                onChange={(event) => setQuerySchemaInput(event.target.value)}
              />
            </label>
            {queryError ? <div className={styles.errorBanner}>{queryError}</div> : null}
            <div className={styles.panelActions}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onApplyQueryShape}
              >
                {t("authoring.editorDrawer.saveQueryDetails")}
              </button>
            </div>
          </>
        ) : (
          <p className={styles.bindingHint}>
            {t("authoring.editorDrawer.chooseQueryHint")}
          </p>
        )}
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.connectData")}</div>
        {!liveBinding ? (
          <div className={styles.bindingEmpty}>
            <p>
              {mockBinding
                ? t("authoring.editorDrawer.sampleDataState")
                : t("authoring.editorDrawer.noLiveBindingState")}
            </p>
            <div className={styles.panelActions}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onCreateBinding}
                disabled={!selectedQuery}
              >
                {t("authoring.editorDrawer.connectQuery")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.mappingSection}>
              <div className={styles.mappingTitle}>{t("authoring.editorDrawer.parameterMapping")}</div>
              {selectedQuery?.params.map((param) => {
                const mapping = liveBinding.param_mapping[param.name];
                return (
                  <div key={param.name} className={styles.mappingRow}>
                    <span>{param.name}</span>
                    <select
                      className={styles.inlineSelect}
                      value={String(mapping?.source ?? "constant")}
                      onChange={(event) =>
                        onBindingParamChange(param.name, "source", event.target.value)
                      }
                    >
                      <option value="filter">{t("authoring.editorDrawer.mappingFilter")}</option>
                      <option value="runtime_context">{t("authoring.editorDrawer.mappingRuntimeContext")}</option>
                      <option value="constant">{t("authoring.editorDrawer.mappingConstant")}</option>
                    </select>
                    <input
                      value={String(mapping?.value ?? "")}
                      onChange={(event) =>
                        onBindingParamChange(param.name, "value", event.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>{t("authoring.editorDrawer.chartDetails")}</div>
        <label className={styles.fieldBlock}>
          <span>{t("authoring.editorDrawer.chartConfigJson")}</span>
          <textarea
            rows={12}
            value={templateInput}
            onChange={(event) => setTemplateInput(event.target.value)}
          />
        </label>
        {templateError ? <div className={styles.errorBanner}>{templateError}</div> : null}
        <div className={styles.panelActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onApplyTemplate}
          >
            {t("authoring.editorDrawer.updateChart")}
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={onResetTemplate}
          >
            {t("authoring.editorDrawer.resetDraft")}
          </button>
        </div>
      </div>
    </section>
  );
}

function getViewBadge(
  binding: Binding | undefined,
  bindingResult: BindingResults[string] | undefined,
  previewState: PreviewState,
  hasDataDraft: boolean,
): string {
  if (bindingResult?.status === "error") {
    return "error";
  }

  if (bindingResult && (bindingResult.status === "ok" || bindingResult.status === "empty")) {
    return "preview_ok";
  }

  if (binding && getBindingMode(binding) === "mock") {
    return "mock";
  }

  if (binding) {
    return "bound";
  }

  if (previewState === "loading" || hasDataDraft) {
    return "no_binding";
  }

  return "draft";
}

function getViewSummary(
  viewStatus: string,
  binding: Binding | undefined,
  issueCount: number,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (viewStatus === "error") {
    return issueCount > 0
      ? t("authoring.editorDrawer.summaryErrorWithCount", { count: issueCount })
      : t("authoring.editorDrawer.summaryError");
  }

  if (binding && getBindingMode(binding) === "mock") {
    return t("authoring.editorDrawer.summaryMock");
  }

  if (binding) {
    return t("authoring.editorDrawer.summaryBound");
  }

  if (issueCount > 0) {
    return t("authoring.editorDrawer.summaryDraftWithCount", { count: issueCount });
  }

  return t("authoring.editorDrawer.summaryDraft");
}

function formatViewStatusLabel(
  viewStatus: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (viewStatus) {
    case "error":
      return t("authoring.canvas.badgeError");
    case "preview_ok":
      return t("authoring.canvas.badgePreviewOk");
    case "mock":
      return t("authoring.canvas.badgeMock");
    case "bound":
      return t("authoring.canvas.badgeBound");
    case "no_binding":
      return t("authoring.canvas.badgeNoBinding");
    default:
      return t("authoring.canvas.badgeDraft");
  }
}
