"use client";

import { getBindingMode, isLiveBinding, isMockBinding } from "../../../domain/dashboard/bindings";
import { getQueryOutput } from "../../../domain/dashboard/contract-kernel";
import { useI18n } from "../../shared/i18n/i18n-context";
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
  onFieldMappingChange: (templateField: string, resultField: string) => void;
  selectedViewTemplateFields: string[];
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
  onFieldMappingChange,
  selectedViewTemplateFields,
  onSaveDashboard,
  saveInFlight = false,
  saveDisabled = false,
  onClose,
  styles,
}: AuthoringEditorDrawerProps) {
  const { t } = useI18n();
  const liveBinding = isLiveBinding(selectedBinding) ? selectedBinding : null;
  const mockBinding = isMockBinding(selectedBinding) ? selectedBinding : null;
  const queryOutput = selectedQuery ? getQueryOutput(selectedQuery) : null;
  const outputSchema = queryOutput?.kind === "rows" ? queryOutput.schema : [];

  return (
    <section className={styles.editorDrawer}>
      <div className={styles.editorDrawerHeader}>
        <div>
          <div className={styles.panelEyebrow}>Manual Fallback</div>
          <h2>{selectedView.title}</h2>
          <p className={styles.editorDrawerSummary}>
            Use this sheet only when a single view needs a precise contract or
            template correction outside the main AI flow.
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
            Return To Canvas
          </button>
        </div>
      </div>

      <div className={styles.metaStack}>
        <div className={styles.metaChip}>
          {getViewBadge(
            selectedBinding,
            selectedBindingResult,
            previewState,
            hasDataDraft,
          )}
        </div>
        {liveBinding ? (
          <div className={styles.metaChip}>{liveBinding.query_id}</div>
        ) : null}
      </div>

      {selectedBindingResult?.status === "error" ? (
        <div className={styles.errorBanner}>
          {selectedBindingResult.code}: {selectedBindingResult.message}
        </div>
      ) : null}

      <div className={styles.advancedSection}>
        <label className={styles.fieldBlock}>
          <span>Title</span>
          <input
            value={selectedView.title}
            onChange={(event) => onViewMetaChange("title", event.target.value)}
          />
        </label>

        <label className={styles.fieldBlock}>
          <span>Description</span>
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
                <strong>{issue.path}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>Template Layer</div>
        <label className={styles.fieldBlock}>
          <span>renderer.option_template JSON</span>
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
            Apply Template
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={onResetTemplate}
          >
            Revert JSON
          </button>
        </div>
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>Query Contract</div>
        <div className={styles.querySelectRow}>
          <select
            className={styles.inlineSelect}
            value={selectedBinding?.query_id ?? selectedQueryId ?? ""}
            onChange={(event) => onSelectQuery(event.target.value || null)}
          >
            <option value="">Select query</option>
            {queryDefs.map((query) => (
              <option key={query.id} value={query.id}>
                {query.name} ({query.id})
              </option>
            ))}
          </select>
          <button type="button" className={styles.secondaryAction} onClick={onAddQuery}>
            New Query
          </button>
        </div>

        {selectedQuery ? (
          <>
            <label className={styles.fieldBlock}>
              <span>Query ID</span>
              <input
                value={selectedQuery.id}
                onChange={(event) => onQueryMetaChange("id", event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>Query Name</span>
              <input
                value={selectedQuery.name}
                onChange={(event) => onQueryMetaChange("name", event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>Datasource ID</span>
              <input
                value={selectedQuery.datasource_id}
                onChange={(event) =>
                  onQueryMetaChange("datasource_id", event.target.value)
                }
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>SQL Template</span>
              <textarea
                rows={6}
                value={selectedQuery.sql_template}
                onChange={(event) =>
                  onQueryMetaChange("sql_template", event.target.value)
                }
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>Params JSON</span>
              <textarea
                rows={7}
                value={queryParamsInput}
                onChange={(event) => setQueryParamsInput(event.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span>Query Output JSON</span>
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
                Apply Query Shape
              </button>
            </div>
          </>
        ) : (
          <p className={styles.bindingHint}>
            Select or create a query to enter advanced editing mode.
          </p>
        )}
      </div>

      <div className={styles.bindingBlock}>
        <div className={styles.panelEyebrow}>Binding Contract</div>
        {!liveBinding ? (
          <div className={styles.bindingEmpty}>
            <p>
              {mockBinding
                ? "This view is currently using mock rows."
                : "This view has no live binding yet."}
            </p>
            <div className={styles.panelActions}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onCreateBinding}
                disabled={!selectedQuery}
              >
                Create Binding
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.mappingSection}>
              <div className={styles.mappingTitle}>Param Mapping</div>
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
                      <option value="filter">filter</option>
                      <option value="runtime_context">runtime_context</option>
                      <option value="constant">constant</option>
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

            <div className={styles.mappingSection}>
              <div className={styles.mappingTitle}>Field Mapping</div>
              {selectedViewTemplateFields.map((templateField) => (
                <div key={templateField} className={styles.mappingRow}>
                  <span>{templateField}</span>
                  <select
                    className={styles.inlineSelect}
                    value={liveBinding.field_mapping?.[templateField] ?? ""}
                    onChange={(event) =>
                      onFieldMappingChange(templateField, event.target.value)
                    }
                  >
                    <option value="">Select field</option>
                    {outputSchema.map((field) => (
                      <option key={field.name} value={field.name}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}
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
    return "Error";
  }

  if (bindingResult && (bindingResult.status === "ok" || bindingResult.status === "empty")) {
    return "Preview OK";
  }

  if (binding && getBindingMode(binding) === "mock") {
    return "Mock";
  }

  if (binding) {
    return "Bound";
  }

  if (previewState === "loading" || hasDataDraft) {
    return "No Binding";
  }

  return "Draft";
}
