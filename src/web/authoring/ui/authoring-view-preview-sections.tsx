"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  Binding,
  BindingResults,
  BindingRow,
  DashboardDocument,
  DashboardView,
  QueryDef,
} from "../../../contracts";
import { isLiveBinding, isMockBinding } from "../../../domain/dashboard/bindings";
import { getPrimarySlotId } from "../../../domain/dashboard/contract-kernel";
import { generateMockRowsFromQueryOutput } from "../utils/mock-query-table";
import type { AuthoringBreakpoint } from "../state/authoring-state";
import { useAuthoringViewLivePreview } from "../hooks/use-query-preview";
import { useI18n } from "../../i18n/i18n-context";

interface AuthoringViewPreviewSectionsProps {
  view: DashboardView;
  dashboard: DashboardDocument;
  breakpoint: AuthoringBreakpoint;
  dashboardId?: string | null;
  bindings: Binding[];
  queryDefs: QueryDef[];
  previewResults: BindingResults;
  styles: Record<string, string>;
}

function findPrimaryBindingForView(
  view: DashboardView,
  bindings: Binding[],
): Binding | undefined {
  const forView = bindings.filter((b) => b.view_id === view.id);
  if (forView.length === 0) {
    return undefined;
  }
  const primarySlot = getPrimarySlotId(view);
  return forView.find((b) => b.slot_id === primarySlot) ?? forView[0];
}

function resolveQueryForBinding(
  binding: Binding | undefined,
  queryDefs: QueryDef[],
): QueryDef | null {
  if (!binding || !isLiveBinding(binding)) {
    return null;
  }
  return queryDefs.find((q) => q.id === binding.query_id) ?? null;
}

export function AuthoringViewPreviewSections({
  view,
  dashboard,
  breakpoint,
  dashboardId,
  bindings,
  queryDefs,
  previewResults,
  styles,
}: AuthoringViewPreviewSectionsProps) {
  const viewId = view.id;
  const { t } = useI18n();
  const [sqlOpen, setSqlOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataMode, setDataMode] = useState<"mock" | "live">("mock");
  const { run: runLivePreview, loading: liveLoading, error: liveFetchError } =
    useAuthoringViewLivePreview();
  const [liveSnapshot, setLiveSnapshot] = useState<BindingResults | null>(null);

  const binding = useMemo(
    () => findPrimaryBindingForView(view, bindings),
    [view, bindings],
  );

  const query = useMemo(
    () => resolveQueryForBinding(binding, queryDefs),
    [binding, queryDefs],
  );

  const sqlText = query?.sql_template?.trim() ?? "";

  const mockRows = useMemo((): BindingRow[] => {
    if (isMockBinding(binding) && binding.mock_data?.rows?.length) {
      return binding.mock_data.rows;
    }
    if (query?.output) {
      return generateMockRowsFromQueryOutput(query.output);
    }
    return [];
  }, [binding, query]);

  const cachedLiveRows = useMemo(() => {
    if (!binding || !isLiveBinding(binding)) {
      return null;
    }
    const result = previewResults[binding.id];
    if (!result || result.status === "error") {
      return null;
    }
    if (result.status === "empty") {
      return [] as BindingRow[];
    }
    const value = result.data.value;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return value as BindingRow[];
    }
    const rows = result.data.rows;
    if (Array.isArray(rows)) {
      return rows as BindingRow[];
    }
    return null;
  }, [binding, previewResults]);

  const liveRowsFromSnapshot = useMemo(() => {
    if (!binding || !liveSnapshot) {
      return null;
    }
    const result = liveSnapshot[binding.id];
    if (!result || result.status === "error") {
      return null;
    }
    if (result.status === "empty") {
      return [] as BindingRow[];
    }
    const value = result.data.value;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return value as BindingRow[];
    }
    const rows = result.data.rows;
    if (Array.isArray(rows)) {
      return rows as BindingRow[];
    }
    return null;
  }, [binding, liveSnapshot]);

  const runLiveFetch = useCallback(async () => {
    const next = await runLivePreview({
      dashboard,
      breakpoint,
      dashboardId,
      viewId,
    });
    if (next) {
      setLiveSnapshot(next);
    }
  }, [dashboard, breakpoint, dashboardId, viewId, runLivePreview]);

  const displayRows =
    dataMode === "mock"
      ? mockRows
      : liveRowsFromSnapshot ?? cachedLiveRows ?? [];

  const showSqlEmpty = !sqlText;

  return (
    <div className={styles.viewPreviewSections}>
      <div className={styles.viewPreviewSection}>
        <button
          type="button"
          className={styles.viewPreviewSectionToggle}
          onClick={(event) => {
            event.stopPropagation();
            setSqlOpen((open) => !open);
          }}
        >
          <span>{sqlOpen ? "▼" : "▶"}</span>
          <span>{t("authoring.canvas.previewSqlToggle")}</span>
        </button>
        {sqlOpen ? (
          <div className={styles.viewPreviewSqlBlock}>
            {showSqlEmpty ? (
              <p className={styles.viewPreviewEmpty}>{t("authoring.canvas.previewSqlEmpty")}</p>
            ) : (
              <pre className={styles.viewPreviewPre}>{sqlText}</pre>
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.viewPreviewSection}>
        <button
          type="button"
          className={styles.viewPreviewSectionToggle}
          onClick={(event) => {
            event.stopPropagation();
            setDataOpen((open) => !open);
          }}
        >
          <span>{dataOpen ? "▼" : "▶"}</span>
          <span>{t("authoring.canvas.previewDataToggle")}</span>
        </button>
        {dataOpen ? (
          <div className={styles.viewPreviewDataBlock}>
            <div className={styles.viewPreviewDataModeRow}>
              <button
                type="button"
                className={`${styles.viewPreviewModeButton} ${
                  dataMode === "mock" ? styles.viewPreviewModeButtonActive : ""
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  setDataMode("mock");
                }}
              >
                {t("authoring.canvas.previewDataMock")}
              </button>
              <button
                type="button"
                className={`${styles.viewPreviewModeButton} ${
                  dataMode === "live" ? styles.viewPreviewModeButtonActive : ""
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  setDataMode("live");
                }}
              >
                {t("authoring.canvas.previewDataLive")}
              </button>
              {dataMode === "live" ? (
                <button
                  type="button"
                  className={styles.viewPreviewRunButton}
                  disabled={liveLoading}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runLiveFetch();
                  }}
                >
                  {liveLoading
                    ? t("authoring.canvas.previewDataRunning")
                    : t("authoring.canvas.previewDataRun")}
                </button>
              ) : null}
            </div>
            {liveFetchError ? (
              <p className={styles.viewPreviewError}>{liveFetchError}</p>
            ) : null}
            {displayRows.length === 0 && dataMode === "mock" ? (
              <p className={styles.viewPreviewEmpty}>{t("authoring.canvas.previewDataEmptyMock")}</p>
            ) : displayRows.length === 0 && dataMode === "live" ? (
              <p className={styles.viewPreviewEmpty}>
                {cachedLiveRows === null && liveRowsFromSnapshot === null
                  ? t("authoring.canvas.previewDataEmptyLiveHint")
                  : t("authoring.canvas.previewDataEmpty")}
              </p>
            ) : (
              <div className={styles.viewPreviewTableWrap}>
                <table className={styles.viewPreviewTable}>
                  <thead>
                    <tr>
                      {Object.keys(displayRows[0] ?? {}).map((key) => (
                        <th key={key}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.slice(0, 20).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {Object.values(row).map((cell, cellIndex) => (
                          <td key={cellIndex}>{formatCell(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
