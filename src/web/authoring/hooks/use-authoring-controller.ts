"use client";

import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AuthoringBreakpoint,
  type MobileLayoutMode,
} from "../state/authoring-state";
import {
  cloneDashboardDocument,
  createInitialAuthoringDocument,
  ensureLayoutMap,
  reconcileDashboardDocumentContract,
  reconcileDashboardDocumentLayouts,
} from "../../../domain/dashboard/document";
import {
  generateMobileLayout,
  reconcileLayout,
} from "../../../domain/dashboard/layout";
import {
  type PreviewState,
  formatPreviewCheckSummary,
} from "../state/preview-state";
import {
  dashboardDraftDocumentHash,
  PublishDashboardError,
  publishRemoteDashboard,
  saveRemoteDashboardDraft,
} from "../api/dashboard-api";
import {
  fetchAuthoringDatasources,
  type AuthoringDatasourceSummary,
} from "../api/datasource-api";
import { runDashboardPreview } from "../api/preview-api";
import {
  openAuthoringSession,
  saveAuthoringSession,
} from "../api/workspace-api";
import type { TranslateFn } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import type { AuthoringSessionPayload } from "@/contracts";
import type {
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
} from "../../../contracts";
import type { ValidationIssue } from "../../../contracts/validation";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";

const LOCAL_PERSIST_DEBOUNCE_MS = 450;
const PREVIEW_REFRESH_DEBOUNCE_MS = 350;

interface PreviewRefreshPlan {
  shouldRerun: boolean;
  affectedViewIds: string[];
  affectedBindingIds: string[];
}

export interface PreviewRunResult {
  state: PreviewState;
  message: string;
  publishIssues: ValidationIssue[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function previewErrorDetails(input: {
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
}) {
  const bindingErrors = Object.entries(input.bindingResults)
    .flatMap(([bindingId, result]) =>
      result.status === "error"
        ? [
            {
              bindingId,
              viewId: result.view_id,
              slotId: result.slot_id,
              queryId: result.query_id,
              code: result.code,
              message: result.message,
            },
          ]
        : [],
    );
  const rendererErrors = Object.entries(input.rendererChecks).flatMap(
    ([viewId, checks]) =>
      (["server", "browser"] as const)
        .map((target) => {
          const check = checks[target];
          if (!check || check.status !== "error") {
            return null;
          }
          return {
            viewId,
            target,
            reason: check.message ?? check.reason,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  );

  return {
    bindingErrors,
    rendererErrors,
    publishIssues: input.publishIssues.slice(0, 5),
  };
}

function logPreviewIssue(input: {
  event: "preview_result_error" | "preview_request_error";
  dashboardId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  breakpoint: AuthoringBreakpoint;
  message: string;
  details?: ReturnType<typeof previewErrorDetails>;
  error?: unknown;
}) {
  if (input.event === "preview_request_error") {
    console.error("[authoring-preview] preview request failed", {
      dashboardId: input.dashboardId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      breakpoint: input.breakpoint,
      message: input.message,
      error: input.error,
    });
    return;
  }

  console.warn("[authoring-preview] preview completed with errors", {
    dashboardId: input.dashboardId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    breakpoint: input.breakpoint,
    message: input.message,
    details: input.details,
  });
}

interface UseAuthoringControllerInput {
  workspaceId: string;
  userId: string;
  sessionId: string;
  dashboardId?: string | null;
  breakpoint: AuthoringBreakpoint;
  selectedViewId: string | null;
  onSelectedViewIdChange: (viewId: string | null) => void;
  onSaved?: () => void;
}

function joinSummaryAndDetails(summary: string, details: string[]): string {
  const trimmedDetails = details.map((entry) => entry.trim()).filter(Boolean);
  return trimmedDetails.length > 0
    ? `${summary}\n${trimmedDetails.join("\n")}`
    : summary;
}

function formatPublishDashboardError(
  error: PublishDashboardError,
  t: TranslateFn,
): string {
  if (error.kind === "invalid-document") {
    return joinSummaryAndDetails(
      t("authoring.persistence.publishInvalidDocument", {
        count: error.issueCount,
      }),
      error.details,
    );
  }

  return joinSummaryAndDetails(
    t("authoring.persistence.publishCheckFailed", {
      bindingErrorCount: error.bindingErrorCount,
      rendererErrorCount: error.rendererErrorCount,
    }),
    error.details,
  );
}

export function useAuthoringController({
  workspaceId,
  userId,
  sessionId,
  dashboardId,
  breakpoint,
  selectedViewId,
  onSelectedViewIdChange,
  onSaved,
}: UseAuthoringControllerInput) {
  const { t } = useI18n();
  const { message } = App.useApp();

  const initialDashboardRef = useRef<DashboardDocument | null>(null);
  if (!initialDashboardRef.current) {
    initialDashboardRef.current = ensureLayoutMap(createInitialAuthoringDocument());
  }

  const dashboardRef = useRef<DashboardDocument>(initialDashboardRef.current);
  const mobileLayoutModeRef = useRef<MobileLayoutMode>("auto");
  const onSelectedViewIdChangeRef = useRef(onSelectedViewIdChange);
  const onSavedRef = useRef(onSaved);
  const messageRef = useRef(message);
  const translateRef = useRef(t);
  const dashboardIdRef = useRef(dashboardId);
  const serverDraftVersionRef = useRef(0);
  const baseVersionRef = useRef(0);
  const baseDocumentHashRef = useRef("");
  const sessionRevisionRef = useRef(0);
  const sessionDocumentHashRef = useRef("");
  const dirtySessionRef = useRef(false);
  const previewResultsRef = useRef<BindingResults>({});
  const previewRendererChecksRef = useRef<RendererChecksByView>({});
  const previewPublishIssuesRef = useRef<ValidationIssue[]>([]);
  const sessionPayloadRef = useRef<AuthoringSessionPayload | null>(null);
  const previewRefreshTimerRef = useRef<number | null>(null);
  const previewRefreshRequestRef = useRef(0);
  const initialPreviewHashRef = useRef<string | null>(null);
  const undoStackRef = useRef<
    Array<{
      dashboard: DashboardDocument;
      selectedViewId: string | null;
      mobileLayoutMode: MobileLayoutMode;
    }>
  >([]);

  const [dashboard, setDashboard] = useState<DashboardDocument>(
    initialDashboardRef.current,
  );
  const [mobileLayoutMode, setMobileLayoutMode] =
    useState<MobileLayoutMode>("auto");
  const [sessionPayload, setSessionPayload] =
    useState<AuthoringSessionPayload | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewMessage, setPreviewMessage] = useState<string>(
    t("authoring.persistence.runCheckHint"),
  );
  const [previewResults, setPreviewResults] = useState<BindingResults>({});
  const [previewRendererChecks, setPreviewRendererChecks] =
    useState<RendererChecksByView>({});
  const [previewPublishIssues, setPreviewPublishIssues] = useState<ValidationIssue[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [publishInFlight, setPublishInFlight] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [datasources, setDatasources] = useState<AuthoringDatasourceSummary[]>([]);
  const [datasourcesStatus, setDatasourcesStatus] = useState<
    "idle" | "loading" | "error"
  >("loading");
  const [datasourcesMessage, setDatasourcesMessage] = useState("");

  useEffect(() => {
    onSelectedViewIdChangeRef.current = onSelectedViewIdChange;
  }, [onSelectedViewIdChange]);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    dashboardIdRef.current = dashboardId;
    initialPreviewHashRef.current = null;
  }, [dashboardId]);

  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

  useEffect(() => {
    mobileLayoutModeRef.current = mobileLayoutMode;
  }, [mobileLayoutMode]);

  useEffect(() => {
    previewResultsRef.current = previewResults;
  }, [previewResults]);

  useEffect(() => {
    previewRendererChecksRef.current = previewRendererChecks;
  }, [previewRendererChecks]);

  useEffect(() => {
    previewPublishIssuesRef.current = previewPublishIssues;
  }, [previewPublishIssues]);

  useEffect(() => {
    sessionPayloadRef.current = sessionPayload;
  }, [sessionPayload]);

  useEffect(() => {
    return () => {
      if (previewRefreshTimerRef.current !== null) {
        window.clearTimeout(previewRefreshTimerRef.current);
      }
    };
  }, []);

  const bumpLocalDraftVersion = useCallback(() => {
    if (!dashboardIdRef.current) {
      return;
    }
    dirtySessionRef.current = true;
  }, []);

  const pushUndoSnapshot = useCallback((document: DashboardDocument) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-4),
      {
        dashboard: cloneDashboardDocument(document),
        selectedViewId,
        mobileLayoutMode: mobileLayoutModeRef.current,
      },
    ];
    setUndoDepth(undoStackRef.current.length);
  }, [selectedViewId]);

  useEffect(() => {
    let active = true;
    setHydrated(false);
    initialPreviewHashRef.current = null;
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    previewRefreshRequestRef.current += 1;
    previewResultsRef.current = {};
    previewRendererChecksRef.current = {};
    previewPublishIssuesRef.current = [];
    setPreviewResults({});
    setPreviewRendererChecks({});
    setPreviewPublishIssues([]);
    setPreviewState("idle");
    setPreviewMessage(translateRef.current("authoring.persistence.runCheckHint"));

    if (!userId) {
      return () => {
        active = false;
      };
    }

    async function restore() {
      try {
        if (!dashboardId) {
          const fallback = ensureLayoutMap(createInitialAuthoringDocument());
          setDashboard(fallback);
          dashboardRef.current = fallback;
          sessionRevisionRef.current = 0;
          sessionDocumentHashRef.current = dashboardDraftDocumentHash(fallback);
          undoStackRef.current = [];
          setUndoDepth(0);
          onSelectedViewIdChangeRef.current(null);
          return;
        }

        const session = await openAuthoringSession({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
        });
        if (!active) {
          return;
        }
        const restoredMobileLayoutMode =
          session.sessionPayload.mobileLayoutMode ?? "custom";
        const normalized = reconcileDashboardDocumentLayouts(
          session.sessionPayload.canonicalDraft,
          restoredMobileLayoutMode,
        );
        setDashboard(normalized);
        dashboardRef.current = normalized;
        mobileLayoutModeRef.current = restoredMobileLayoutMode;
        undoStackRef.current = [];
        setUndoDepth(0);
        serverDraftVersionRef.current = session.draftVersion ?? session.headVersion;
        baseVersionRef.current = session.sessionPayload.baseVersion;
        baseDocumentHashRef.current = session.documentHash;
        sessionRevisionRef.current = session.sessionRevision;
        sessionDocumentHashRef.current = dashboardDraftDocumentHash(normalized);
        dirtySessionRef.current = session.sessionPayload.dirty;
        setMobileLayoutMode(restoredMobileLayoutMode);
        setSessionPayload({
          ...session.sessionPayload,
          mobileLayoutMode: restoredMobileLayoutMode,
          canonicalDraft: normalized,
        });
        onSelectedViewIdChangeRef.current(null);
      } catch (error) {
        if (!active) {
          return;
        }

        messageRef.current.error(
          error instanceof Error
            ? error.message
            : translateRef.current("authoring.persistence.loadDashboardFailed"),
        );
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, [dashboardId, sessionId, userId, workspaceId]);

  useEffect(() => {
    let active = true;

    setDatasourcesStatus("loading");
    setDatasourcesMessage("");

    void fetchAuthoringDatasources()
      .then((nextDatasources) => {
        if (!active) {
          return;
        }

        setDatasources(nextDatasources);
        setDatasourcesStatus("idle");
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setDatasources([]);
        setDatasourcesStatus("error");
        setDatasourcesMessage(
          error instanceof Error ? error.message : "Unable to load datasources.",
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !dashboardId || !userId || !sessionPayloadRef.current) {
      return;
    }

    const id = window.setTimeout(() => {
      void saveAuthoringSession({
        expectedSessionRevision: sessionRevisionRef.current,
        expectedDocumentHash: sessionDocumentHashRef.current,
        payload: {
          ...sessionPayloadRef.current!,
          focusViewId: selectedViewId,
          canonicalDraft: dashboardRef.current,
          mobileLayoutMode: mobileLayoutModeRef.current,
          baseVersion: baseVersionRef.current,
          dirty: dirtySessionRef.current,
          stale: baseVersionRef.current < serverDraftVersionRef.current,
          updatedAt: new Date().toISOString(),
        },
      })
        .then((saved) => {
          sessionRevisionRef.current += 1;
          sessionDocumentHashRef.current = dashboardDraftDocumentHash(saved.canonicalDraft);
          setSessionPayload(saved);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : "";
          if (detail.includes("revision") || detail.includes("stale")) {
            messageRef.current.warning(
              "Authoring session changed elsewhere. Refresh this dashboard before continuing.",
            );
          }
        });
    }, LOCAL_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [dashboard, selectedViewId, mobileLayoutMode, hydrated, dashboardId, userId]);

  const commitPreviewSnapshot = useCallback((
    bindingResults: BindingResults,
    rendererChecks: RendererChecksByView,
    publishIssues: ValidationIssue[] = [],
    nextState?: PreviewState,
    nextMessage?: string,
  ): PreviewRunResult => {
    previewResultsRef.current = bindingResults;
    previewRendererChecksRef.current = rendererChecks;
    previewPublishIssuesRef.current = publishIssues;
    setPreviewResults(bindingResults);
    setPreviewRendererChecks(rendererChecks);
    setPreviewPublishIssues(publishIssues);
    const hasRendererError = Object.values(rendererChecks).some(
      (checks) => checks.browser?.status === "error" || checks.server?.status === "error",
    );
    const hasRuntimeError = Object.values(bindingResults).some(
      (result) => result.status === "error",
    );
    const resolvedState =
      nextState ?? (hasRendererError || hasRuntimeError ? "error" : "ready");
    const resolvedMessage =
      nextMessage ?? formatPreviewCheckSummary(bindingResults, rendererChecks, t);
    setPreviewState(
      resolvedState,
    );
    setPreviewMessage(
      resolvedMessage,
    );
    if (resolvedState === "error") {
      logPreviewIssue({
        event: "preview_result_error",
        dashboardId: dashboardIdRef.current,
        workspaceId,
        sessionId,
        breakpoint,
        message: resolvedMessage,
        details: previewErrorDetails({
          bindingResults,
          rendererChecks,
          publishIssues,
        }),
      });
    }
    return {
      state: resolvedState,
      message: resolvedMessage,
      publishIssues,
    };
  }, [breakpoint, sessionId, t, workspaceId]);

  const prunePreviewCacheForDocument = useCallback((document: DashboardDocument) => {
    const bindingIds = new Set(document.bindings.map((binding) => binding.id));
    const viewIds = new Set(document.dashboard_spec.views.map((view) => view.id));

    const nextResults = Object.fromEntries(
      Object.entries(previewResultsRef.current).filter(([bindingId]) =>
        bindingIds.has(bindingId),
      ),
    );
    const nextRendererChecks = Object.fromEntries(
      Object.entries(previewRendererChecksRef.current).filter(([viewId]) =>
        viewIds.has(viewId),
      ),
    );

    previewResultsRef.current = nextResults;
    previewRendererChecksRef.current = nextRendererChecks;
    setPreviewResults(nextResults);
    setPreviewRendererChecks(nextRendererChecks);
  }, []);

  const schedulePreviewRefresh = useCallback((
    document: DashboardDocument,
    plan: PreviewRefreshPlan,
  ) => {
    if (!plan.shouldRerun || plan.affectedViewIds.length === 0) {
      return;
    }

    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
    }

    previewRefreshTimerRef.current = window.setTimeout(() => {
      previewRefreshTimerRef.current = null;
      const requestId = ++previewRefreshRequestRef.current;
      setPreviewState("loading");
      setPreviewMessage(
        plan.affectedViewIds.length === 1
          ? t("authoring.persistence.refreshOneAffectedView")
          : t("authoring.persistence.refreshManyAffectedViews", {
              count: plan.affectedViewIds.length,
            }),
      );

      void runDashboardPreview(
        document,
        breakpoint,
        dashboardIdRef.current,
        workspaceId,
        sessionId,
        {
          userId,
          visibleViewIds: plan.affectedViewIds,
        },
      )
        .then(({ bindingResults, rendererChecks, publishIssues }) => {
          if (requestId !== previewRefreshRequestRef.current) {
            return;
          }

          const affectedBindingIds = new Set(plan.affectedBindingIds);
          const affectedViewIds = new Set(plan.affectedViewIds);
          const mergedResults = {
            ...Object.fromEntries(
              Object.entries(previewResultsRef.current).filter(
                ([bindingId]) => !affectedBindingIds.has(bindingId),
              ),
            ),
            ...bindingResults,
          };
          const mergedRendererChecks = {
            ...Object.fromEntries(
              Object.entries(previewRendererChecksRef.current).filter(
                ([viewId]) => !affectedViewIds.has(viewId),
              ),
            ),
            ...rendererChecks,
          };

          commitPreviewSnapshot(mergedResults, mergedRendererChecks, publishIssues);
        })
        .catch((error) => {
          if (requestId !== previewRefreshRequestRef.current) {
            return;
          }

          const detail = errorMessage(error);
          logPreviewIssue({
            event: "preview_request_error",
            dashboardId: dashboardIdRef.current,
            workspaceId,
            sessionId,
            breakpoint,
            message: detail,
            error,
          });
          setPreviewState("error");
          setPreviewMessage(
            detail || t("authoring.persistence.unknownPreviewFailure"),
          );
        });
    }, PREVIEW_REFRESH_DEBOUNCE_MS);
  }, [breakpoint, commitPreviewSnapshot, sessionId, t, workspaceId]);

  const resetPreview = useCallback(() => {
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    previewResultsRef.current = {};
    previewRendererChecksRef.current = {};
    previewPublishIssuesRef.current = [];
    setPreviewResults({});
    setPreviewRendererChecks({});
    setPreviewPublishIssues([]);
    setPreviewState("idle");
    setPreviewMessage(t("authoring.persistence.runCheckHint"));
  }, [t]);

  const updateDashboard = useCallback((
    updater: (current: DashboardDocument) => DashboardDocument,
    options?: {
      syncMobileFromDesktop?: boolean;
      reconcileBreakpoint?: AuthoringBreakpoint;
      anchoredViewId?: string;
      clearPreview?: boolean;
    },
  ) => {
    const current = dashboardRef.current;
    let next = updater(current);

    if (options?.reconcileBreakpoint) {
      next = cloneDashboardDocument(next);
      const layout = getAuthoringLayout(next, options.reconcileBreakpoint);
      next.dashboard_spec.layout[options.reconcileBreakpoint] = reconcileLayout(
        layout,
        options.anchoredViewId,
        { compactVertical: false },
      );
    }

    if (
      options?.syncMobileFromDesktop &&
      mobileLayoutModeRef.current === "auto" &&
      next.dashboard_spec.layout.desktop
    ) {
      next = cloneDashboardDocument(next);
      const desktopLayout = next.dashboard_spec.layout.desktop;
      if (desktopLayout) {
        next.dashboard_spec.layout.mobile = generateMobileLayout(desktopLayout);
      }
    }

    const previewPlan = classifyPreviewRefresh({
      current,
      next,
      breakpoint,
    });
    pushUndoSnapshot(current);
    dashboardRef.current = next;
    setDashboard(next);

    bumpLocalDraftVersion();

    prunePreviewCacheForDocument(next);
    schedulePreviewRefresh(next, previewPlan);
  }, [breakpoint, bumpLocalDraftVersion, prunePreviewCacheForDocument, pushUndoSnapshot, schedulePreviewRefresh]);

  const replaceDashboard = useCallback((
    nextDashboard: DashboardDocument,
    options?: {
      previewPolicy?: "reset" | "rerun" | "preserve";
    },
  ) => {
    const previewPolicy = options?.previewPolicy ?? "reset";
    const currentDashboard = dashboardRef.current;
    const reconciled = reconcileDashboardDocumentContract(nextDashboard, {
      mobileLayoutMode: mobileLayoutModeRef.current,
    });
    pushUndoSnapshot(currentDashboard);
    dashboardRef.current = reconciled;
    setDashboard(reconciled);
    bumpLocalDraftVersion();
    prunePreviewCacheForDocument(reconciled);

    const previewPlan = classifyPreviewRefresh({
      current: currentDashboard,
      next: reconciled,
      breakpoint,
    });
    if (previewPolicy === "reset") {
      resetPreview();
    } else if (previewPolicy === "rerun") {
      schedulePreviewRefresh(reconciled, previewPlan);
    }
  }, [
    breakpoint,
    bumpLocalDraftVersion,
    prunePreviewCacheForDocument,
    pushUndoSnapshot,
    resetPreview,
    schedulePreviewRefresh,
  ]);

  const applyDashboardMutation = useCallback((
    mutator: (current: DashboardDocument) => DashboardDocument,
  ) => {
    setDashboard((current) => {
      const next = mutator(current);
      dashboardRef.current = next;
      return next;
    });
  }, []);

  const commitDashboardMutation = useCallback((
    previous: DashboardDocument,
    next: DashboardDocument,
  ) => {
    pushUndoSnapshot(previous);
    bumpLocalDraftVersion();
    prunePreviewCacheForDocument(next);
    const previewPlan = classifyPreviewRefresh({
      current: previous,
      next,
      breakpoint,
    });
    schedulePreviewRefresh(next, previewPlan);
  }, [
    breakpoint,
    bumpLocalDraftVersion,
    prunePreviewCacheForDocument,
    pushUndoSnapshot,
    schedulePreviewRefresh,
  ]);

  const handleSaveDashboard = useCallback(async () => {
    if (!dashboardId || !userId) {
      message.warning("Dashboard id is required before cloud save.");
      return true;
    }

    setSaveInFlight(true);

    try {
      let saved;
      try {
        saved = await saveRemoteDashboardDraft({
          workspaceId,
          userId,
          dashboardId,
          sessionId,
          expectedDraftVersion: baseVersionRef.current,
          expectedDocumentHash: baseDocumentHashRef.current,
          dashboard: dashboardRef.current,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "DraftVersionConflictError" &&
          window.confirm("Cloud draft is newer. Overwrite with your session draft?")
        ) {
          saved = await saveRemoteDashboardDraft({
            workspaceId,
            userId,
            dashboardId,
            sessionId,
            expectedDraftVersion: baseVersionRef.current,
            expectedDocumentHash: baseDocumentHashRef.current,
            dashboard: dashboardRef.current,
            force: true,
          });
        } else {
          throw error;
        }
      }
      serverDraftVersionRef.current = saved.version;
      baseVersionRef.current = saved.version;
      baseDocumentHashRef.current = dashboardDraftDocumentHash(dashboardRef.current);
      sessionRevisionRef.current += 1;
      sessionDocumentHashRef.current = dashboardDraftDocumentHash(dashboardRef.current);
      dirtySessionRef.current = false;
      setSessionPayload((current) =>
        current
          ? {
              ...current,
              canonicalDraft: dashboardRef.current,
              focusViewId: selectedViewId,
              mobileLayoutMode: mobileLayoutModeRef.current,
              baseVersion: saved.version,
              dirty: false,
              stale: false,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );

      if (saved.changed) {
        message.success(
          t("authoring.persistence.saveSuccess", { version: saved.version }),
        );
      } else {
        message.info(
          t("authoring.persistence.saveNoChanges", { version: saved.version }),
        );
      }

      onSavedRef.current?.();
      return true;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : t("authoring.persistence.saveFailed");
      message.error(detail);
      return false;
    } finally {
      setSaveInFlight(false);
    }
  }, [dashboardId, message, selectedViewId, sessionId, t, userId, workspaceId]);

  const handlePublishDashboard = useCallback(async () => {
    if (!dashboardId || !userId) {
      message.warning(t("authoring.persistence.publishNeedsId"));
      return false;
    }

    if (dirtySessionRef.current) {
      const saved = await handleSaveDashboard();
      if (!saved) {
        return false;
      }
    }

    setPublishInFlight(true);

    try {
      const published = await publishRemoteDashboard({
        workspaceId,
        userId,
        dashboardId,
        sessionId,
        draftVersion: serverDraftVersionRef.current,
        documentHash: baseDocumentHashRef.current,
      });
      serverDraftVersionRef.current = published.version;
      baseVersionRef.current = published.version;
      baseDocumentHashRef.current = dashboardDraftDocumentHash(dashboardRef.current);
      sessionRevisionRef.current += 1;
      sessionDocumentHashRef.current = dashboardDraftDocumentHash(dashboardRef.current);
      dirtySessionRef.current = false;
      setSessionPayload((current) =>
        current
          ? {
              ...current,
              canonicalDraft: dashboardRef.current,
              focusViewId: selectedViewId,
              mobileLayoutMode: mobileLayoutModeRef.current,
              baseVersion: published.version,
              dirty: false,
              stale: false,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      if (published.changed) {
        message.success(
          t("authoring.persistence.publishSuccess", { version: published.version }),
        );
      } else {
        message.info(
          t("authoring.persistence.publishNoChanges", { version: published.version }),
        );
      }

      onSavedRef.current?.();
      return true;
    } catch (error) {
      let detail = t("authoring.persistence.publishFailed");
      if (error instanceof PublishDashboardError) {
        detail = formatPublishDashboardError(error, t);
      } else if (error instanceof Error) {
        detail = error.message;
      }
      message.error(detail);
      return false;
    } finally {
      setPublishInFlight(false);
    }
  }, [dashboardId, handleSaveDashboard, message, selectedViewId, t, userId, workspaceId]);

  const runPreviewForDocument = useCallback(async (
    document: DashboardDocument,
    options?: { persistChecks?: boolean },
  ): Promise<PreviewRunResult> => {
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    previewRefreshRequestRef.current += 1;
    setPreviewState("loading");
    setPreviewMessage(t("authoring.persistence.runningRuntimeCheck"));

    try {
      const { bindingResults, rendererChecks, publishIssues } = await runDashboardPreview(
        document,
        breakpoint,
        dashboardId,
        workspaceId,
        sessionId,
        { userId, persistChecks: options?.persistChecks ?? false },
      );
      return commitPreviewSnapshot(bindingResults, rendererChecks, publishIssues);
    } catch (error) {
      previewResultsRef.current = {};
      previewRendererChecksRef.current = {};
      previewPublishIssuesRef.current = [];
      setPreviewResults({});
      setPreviewRendererChecks({});
      setPreviewPublishIssues([]);
      setPreviewState("error");
      const message = errorMessage(error) || t("authoring.persistence.unknownPreviewFailure");
      logPreviewIssue({
        event: "preview_request_error",
        dashboardId,
        workspaceId,
        sessionId,
        breakpoint,
        message,
        error,
      });
      setPreviewMessage(message);
      return {
        state: "error",
        message,
        publishIssues: [],
      };
    }
  }, [breakpoint, commitPreviewSnapshot, dashboardId, sessionId, t, userId, workspaceId]);

  useEffect(() => {
    if (!hydrated || initialPreviewHashRef.current !== null) {
      return;
    }

    const documentHash = dashboardDraftDocumentHash(dashboard);
    initialPreviewHashRef.current = documentHash;
    if (dashboard.bindings.length > 0) {
      void runPreviewForDocument(dashboard);
    }
  }, [dashboard, hydrated, runPreviewForDocument]);

  const handleUndoLastChange = useCallback(async () => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) {
      return false;
    }

    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoDepth(undoStackRef.current.length);
    dashboardRef.current = cloneDashboardDocument(previous.dashboard);
    setDashboard(cloneDashboardDocument(previous.dashboard));
    setMobileLayoutMode(previous.mobileLayoutMode);
    dirtySessionRef.current = true;
    onSelectedViewIdChangeRef.current(previous.selectedViewId);
    prunePreviewCacheForDocument(previous.dashboard);
    if (previous.dashboard.bindings.length > 0) {
      void runPreviewForDocument(previous.dashboard);
    } else {
      resetPreview();
    }
    return true;
  }, [prunePreviewCacheForDocument, resetPreview, runPreviewForDocument, t]);

  const setPreviewHint = useCallback((hint: string) => {
    setPreviewMessage(hint);
  }, []);

  return {
    dashboard,
    dashboardRef,
    getBaseVersion: () => baseVersionRef.current,
    datasources,
    datasourcesStatus,
    datasourcesMessage,
    mobileLayoutMode,
    setMobileLayoutMode,
    mobileLayoutModeRef,
    previewState,
    previewMessage,
    previewResults,
    previewRendererChecks,
    previewPublishIssues,
    hydrated,
    saveInFlight,
    publishInFlight,
    undoDepth,
    bumpPersistedDraftVersion: bumpLocalDraftVersion,
    setPreviewHint,
    applyDashboardMutation,
    commitDashboardMutation,
    updateDashboard,
    replaceDashboard,
    handleSaveDashboard,
    handlePublishDashboard,
    handleUndoLastChange,
    runPreviewForDocument,
  };
}

export function getAuthoringLayout(
  dashboard: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
): DashboardBreakpointLayout {
  const layout =
    dashboard.dashboard_spec.layout[breakpoint] ??
    dashboard.dashboard_spec.layout.desktop ??
    dashboard.dashboard_spec.layout.mobile;

  if (!layout) {
    throw new Error("Authoring layout is missing.");
  }

  return layout;
}

function classifyPreviewRefresh(input: {
  current: DashboardDocument;
  next: DashboardDocument;
  breakpoint: AuthoringBreakpoint;
}): PreviewRefreshPlan {
  const currentViewMap = new Map(
    input.current.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const nextViewMap = new Map(
    input.next.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const currentQueryMap = new Map(
    input.current.query_defs.map((query) => [query.id, query]),
  );
  const nextQueryMap = new Map(
    input.next.query_defs.map((query) => [query.id, query]),
  );
  const currentBindingMap = new Map(
    input.current.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindingMap = new Map(
    input.next.bindings.map((binding) => [binding.id, binding]),
  );
  const visibleViewIds = new Set(
    collectVisibleViewIdsForBreakpoint(input.next, input.breakpoint),
  );

  const affectedViewIds = new Set<string>();

  const allViewIds = new Set([
    ...currentViewMap.keys(),
    ...nextViewMap.keys(),
  ]);
  for (const viewId of allViewIds) {
    const currentView = currentViewMap.get(viewId);
    const nextView = nextViewMap.get(viewId);

    if (!nextView || !visibleViewIds.has(viewId)) {
      continue;
    }

    if (!currentView) {
      affectedViewIds.add(viewId);
      continue;
    }

    if (JSON.stringify(currentView.renderer) !== JSON.stringify(nextView.renderer)) {
      affectedViewIds.add(viewId);
    }
  }

  const changedQueryIds = new Set<string>();
  const allQueryIds = new Set([
    ...currentQueryMap.keys(),
    ...nextQueryMap.keys(),
  ]);
  for (const queryId of allQueryIds) {
    const currentQuery = currentQueryMap.get(queryId);
    const nextQuery = nextQueryMap.get(queryId);
    if (JSON.stringify(currentQuery) !== JSON.stringify(nextQuery)) {
      changedQueryIds.add(queryId);
    }
  }

  const changedBindingViewIds = new Set<string>();
  const allBindingIds = new Set([
    ...currentBindingMap.keys(),
    ...nextBindingMap.keys(),
  ]);
  for (const bindingId of allBindingIds) {
    const currentBinding = currentBindingMap.get(bindingId);
    const nextBinding = nextBindingMap.get(bindingId);
    if (JSON.stringify(currentBinding) === JSON.stringify(nextBinding)) {
      continue;
    }

    const currentViewId = currentBinding?.view_id;
    const nextViewId = nextBinding?.view_id;
    if (currentViewId && visibleViewIds.has(currentViewId)) {
      changedBindingViewIds.add(currentViewId);
    }
    if (nextViewId && visibleViewIds.has(nextViewId)) {
      changedBindingViewIds.add(nextViewId);
    }
  }

  changedBindingViewIds.forEach((viewId) => affectedViewIds.add(viewId));

  if (changedQueryIds.size > 0) {
    for (const binding of [...input.current.bindings, ...input.next.bindings]) {
      if (
        binding.query_id &&
        changedQueryIds.has(binding.query_id) &&
        visibleViewIds.has(binding.view_id)
      ) {
        affectedViewIds.add(binding.view_id);
      }
    }
  }

  if (
    JSON.stringify(input.current.dashboard_spec.filters) !==
    JSON.stringify(input.next.dashboard_spec.filters)
  ) {
    visibleViewIds.forEach((viewId) => affectedViewIds.add(viewId));
  }

  const affectedBindingIds = buildBindingIdsForViews(
    input.current,
    input.next,
    [...affectedViewIds],
  );

  return {
    shouldRerun: affectedViewIds.size > 0,
    affectedViewIds: [...affectedViewIds],
    affectedBindingIds,
  };
}

function buildBindingIdsForViews(
  current: DashboardDocument,
  next: DashboardDocument,
  viewIds: string[],
): string[] {
  const viewIdSet = new Set(viewIds);
  return [...new Set(
    [...current.bindings, ...next.bindings]
      .filter((binding) => viewIdSet.has(binding.view_id))
      .map((binding) => binding.id),
  )];
}

function collectVisibleViewIdsForBreakpoint(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
): string[] {
  return document.dashboard_spec.layout[breakpoint]?.items.map((item) => item.view_id) ?? [];
}
