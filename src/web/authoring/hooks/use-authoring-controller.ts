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
import { formatTimestamp } from "../../utils/time";
import {
  type PreviewState,
  formatPreviewCheckSummary,
} from "../state/preview-state";
import {
  loadRemoteAuthoringState,
  publishRemoteDashboard,
  saveRemoteDashboardDraft,
} from "../api/dashboard-api";
import {
  loadPerDashboardAuthoringPersisted,
  persistPerDashboardAuthoringState,
  resolveAuthoringHydration,
} from "../api/per-dashboard-local-draft";
import {
  loadLocalAuthoringState,
  persistLocalAuthoringState,
} from "../api/local-draft-storage";
import { runDashboardPreview } from "../api/preview-api";
import { useI18n } from "../../i18n/i18n-context";
import { randomUuid } from "../../utils/random-uuid";
import type {
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
} from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";

const LOCAL_PERSIST_DEBOUNCE_MS = 450;
const PREVIEW_REFRESH_DEBOUNCE_MS = 350;

interface PreviewRefreshPlan {
  shouldRerun: boolean;
  affectedViewIds: string[];
  affectedBindingIds: string[];
}

interface UseAuthoringControllerInput {
  dashboardId?: string | null;
  breakpoint: AuthoringBreakpoint;
  selectedViewId: string | null;
  onSelectedViewIdChange: (viewId: string | null) => void;
  onSaved?: () => void;
}

export function useAuthoringController({
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
  const dashboardIdRef = useRef(dashboardId);
  const serverDraftVersionRef = useRef(0);
  const localDraftVersionRef = useRef(0);
  const previewResultsRef = useRef<BindingResults>({});
  const previewRendererChecksRef = useRef<RendererChecksByView>({});
  const previewRefreshTimerRef = useRef<number | null>(null);
  const previewRefreshRequestRef = useRef(0);

  const [dashboard, setDashboard] = useState<DashboardDocument>(
    initialDashboardRef.current,
  );
  const [mobileLayoutMode, setMobileLayoutMode] =
    useState<MobileLayoutMode>("auto");
  const [localSessionId, setLocalSessionId] = useState<string>(() => randomUuid());
  const [storageMessage, setStorageMessage] = useState<string>(
    dashboardId ? "Loading dashboard..." : "Local draft is ready.",
  );
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewMessage, setPreviewMessage] = useState<string>(
    "Run a runtime check after data bindings are ready.",
  );
  const [previewResults, setPreviewResults] = useState<BindingResults>({});
  const [previewRendererChecks, setPreviewRendererChecks] =
    useState<RendererChecksByView>({});
  const [hydrated, setHydrated] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [publishInFlight, setPublishInFlight] = useState(false);

  useEffect(() => {
    onSelectedViewIdChangeRef.current = onSelectedViewIdChange;
  }, [onSelectedViewIdChange]);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    dashboardIdRef.current = dashboardId;
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
    localDraftVersionRef.current =
      Math.max(localDraftVersionRef.current, serverDraftVersionRef.current) + 1;
  }, []);

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        if (!dashboardId) {
          const restored = loadLocalAuthoringState();
          if (!active) {
            return;
          }

          const normalizedLocal = reconcileDashboardDocumentLayouts(
            restored.dashboard,
            restored.mobileLayoutMode,
          );
          setDashboard(normalizedLocal);
          dashboardRef.current = normalizedLocal;
          setMobileLayoutMode(restored.mobileLayoutMode);
          setLocalSessionId(restored.localSessionId);
          onSelectedViewIdChangeRef.current(restored.selectedViewId);
          setStorageMessage(restored.message);
          return;
        }

        const remote = await loadRemoteAuthoringState(dashboardId);
        if (!active) {
          return;
        }

        const local = loadPerDashboardAuthoringPersisted(dashboardId);
        const resolved = resolveAuthoringHydration({
          remoteVersion: remote.version,
          remoteDocument: remote.dashboard,
          remoteUpdatedAt: remote.updatedAt,
          local,
        });

        const normalized = reconcileDashboardDocumentLayouts(
          resolved.dashboard,
          resolved.mobileLayoutMode,
        );
        setDashboard(normalized);
        dashboardRef.current = normalized;
        serverDraftVersionRef.current = resolved.serverDraftVersion;
        localDraftVersionRef.current = resolved.localDraftVersion;
        setMobileLayoutMode(resolved.mobileLayoutMode);
        onSelectedViewIdChangeRef.current(resolved.selectedViewId);
        setStorageMessage(resolved.message);

        persistPerDashboardAuthoringState(dashboardId, {
          dashboard: normalized,
          selectedViewId: resolved.selectedViewId,
          mobileLayoutMode: resolved.mobileLayoutMode,
          serverDraftVersion: resolved.serverDraftVersion,
          localDraftVersion: resolved.localDraftVersion,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        if (dashboardId) {
          setStorageMessage(
            error instanceof Error ? error.message : "Unable to load dashboard.",
          );
        } else {
          const fallback = ensureLayoutMap(createInitialAuthoringDocument());
          setDashboard(fallback);
          dashboardRef.current = fallback;
          onSelectedViewIdChangeRef.current(
            fallback.dashboard_spec.views[0]?.id ?? null,
          );
          setStorageMessage("Ignored an unreadable local draft and started fresh.");
        }
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
  }, [dashboardId]);

  useEffect(() => {
    if (!hydrated || dashboardId) {
      return;
    }

    const savedAt = persistLocalAuthoringState({
      dashboard,
      selectedViewId,
      mobileLayoutMode,
      localSessionId,
    });
    setStorageMessage(`Local draft saved at ${savedAt}.`);
  }, [dashboard, selectedViewId, mobileLayoutMode, localSessionId, hydrated, dashboardId]);

  useEffect(() => {
    if (!hydrated || !dashboardId) {
      return;
    }

    const id = window.setTimeout(() => {
      const savedAt = persistPerDashboardAuthoringState(dashboardId, {
        dashboard: dashboardRef.current,
        selectedViewId,
        mobileLayoutMode: mobileLayoutModeRef.current,
        serverDraftVersion: serverDraftVersionRef.current,
        localDraftVersion: localDraftVersionRef.current,
      });
      setStorageMessage(`Local copy saved at ${savedAt}.`);
    }, LOCAL_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [dashboard, selectedViewId, mobileLayoutMode, hydrated, dashboardId]);

  const commitPreviewSnapshot = useCallback((
    bindingResults: BindingResults,
    rendererChecks: RendererChecksByView,
    nextState?: PreviewState,
    nextMessage?: string,
  ) => {
    previewResultsRef.current = bindingResults;
    previewRendererChecksRef.current = rendererChecks;
    setPreviewResults(bindingResults);
    setPreviewRendererChecks(rendererChecks);
    const hasRendererError = Object.values(rendererChecks).some(
      (checks) => checks.browser?.status === "error" || checks.server?.status === "error",
    );
    const hasRuntimeError = Object.values(bindingResults).some(
      (result) => result.status === "error",
    );
    setPreviewState(
      nextState ?? (hasRendererError || hasRuntimeError ? "error" : "ready"),
    );
    setPreviewMessage(
      nextMessage ?? formatPreviewCheckSummary(bindingResults, rendererChecks),
    );
  }, []);

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
          ? "Refreshing 1 affected view..."
          : `Refreshing ${plan.affectedViewIds.length} affected views...`,
      );

      void runDashboardPreview(document, breakpoint, dashboardIdRef.current, {
        visibleViewIds: plan.affectedViewIds,
      })
        .then(({ bindingResults, rendererChecks }) => {
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

          commitPreviewSnapshot(mergedResults, mergedRendererChecks);
        })
        .catch((error) => {
          if (requestId !== previewRefreshRequestRef.current) {
            return;
          }

          setPreviewState("error");
          setPreviewMessage(
            error instanceof Error ? error.message : "Unknown preview failure.",
          );
        });
    }, PREVIEW_REFRESH_DEBOUNCE_MS);
  }, [breakpoint, commitPreviewSnapshot]);

  const resetPreview = useCallback(() => {
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    previewResultsRef.current = {};
    previewRendererChecksRef.current = {};
    setPreviewResults({});
    setPreviewRendererChecks({});
    setPreviewState("idle");
    setPreviewMessage("Run a runtime check after data bindings are ready.");
  }, []);

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
    dashboardRef.current = next;
    setDashboard(next);

    bumpLocalDraftVersion();

    prunePreviewCacheForDocument(next);
    schedulePreviewRefresh(next, previewPlan);
  }, [breakpoint, bumpLocalDraftVersion, prunePreviewCacheForDocument, schedulePreviewRefresh]);

  const replaceDashboard = useCallback((
    nextDashboard: DashboardDocument,
    clearPreview = true,
  ) => {
    const currentDashboard = dashboardRef.current;
    const reconciled = reconcileDashboardDocumentContract(nextDashboard, {
      mobileLayoutMode: mobileLayoutModeRef.current,
    });
    dashboardRef.current = reconciled;
    setDashboard(reconciled);
    bumpLocalDraftVersion();
    prunePreviewCacheForDocument(reconciled);

    const previewPlan = classifyPreviewRefresh({
      current: currentDashboard,
      next: reconciled,
      breakpoint,
    });
    if (!clearPreview) {
      schedulePreviewRefresh(reconciled, previewPlan);
    }
  }, [breakpoint, bumpLocalDraftVersion, prunePreviewCacheForDocument, schedulePreviewRefresh]);

  const applyDashboardMutation = useCallback((
    mutator: (current: DashboardDocument) => DashboardDocument,
  ) => {
    setDashboard((current) => {
      const next = mutator(current);
      dashboardRef.current = next;
      return next;
    });
  }, []);

  const persistDraft = useCallback((reason: string) => {
    const savedAt = persistLocalAuthoringState({
      dashboard: dashboardRef.current,
      selectedViewId,
      mobileLayoutMode: mobileLayoutModeRef.current,
      localSessionId,
    });
    setStorageMessage(`${reason} at ${savedAt}.`);
  }, [localSessionId, selectedViewId]);

  const handleSaveDashboard = useCallback(async () => {
    if (!dashboardId) {
      persistDraft("Local draft saved manually");
      message.success(t("authoring.persistence.savedLocal"));
      return true;
    }

    setSaveInFlight(true);
    setStorageMessage("Saving dashboard draft...");

    try {
      const saved = await saveRemoteDashboardDraft({
        dashboardId,
        dashboard: dashboardRef.current,
      });
      serverDraftVersionRef.current = saved.version;
      localDraftVersionRef.current = saved.version;
      persistPerDashboardAuthoringState(dashboardId, {
        dashboard: dashboardRef.current,
        selectedViewId,
        mobileLayoutMode: mobileLayoutModeRef.current,
        serverDraftVersion: saved.version,
        localDraftVersion: saved.version,
      });

      setStorageMessage(
        saved.changed
          ? `Saved dashboard v${saved.version} at ${formatTimestamp(saved.savedAt)}.`
          : `No changes to save. Current draft is still v${saved.version}.`,
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
      setStorageMessage(detail);
      message.error(detail);
      return false;
    } finally {
      setSaveInFlight(false);
    }
  }, [dashboardId, message, persistDraft, selectedViewId, t]);

  const handlePublishDashboard = useCallback(async () => {
    if (!dashboardId) {
      setStorageMessage(t("authoring.persistence.publishNeedsId"));
      message.warning(t("authoring.persistence.publishNeedsId"));
      return false;
    }

    setPublishInFlight(true);
    setStorageMessage("Publishing dashboard...");

    try {
      const published = await publishRemoteDashboard({
        dashboardId,
        dashboard: dashboardRef.current,
      });
      serverDraftVersionRef.current = published.version;
      localDraftVersionRef.current = published.version;
      persistPerDashboardAuthoringState(dashboardId, {
        dashboard: dashboardRef.current,
        selectedViewId,
        mobileLayoutMode: mobileLayoutModeRef.current,
        serverDraftVersion: published.version,
        localDraftVersion: published.version,
      });
      setStorageMessage(
        published.changed
          ? `Published dashboard v${published.version} at ${formatTimestamp(published.publishedAt)}.`
          : `No changes to publish. Current published version is still v${published.version}.`,
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
      const detail =
        error instanceof Error
          ? error.message
          : t("authoring.persistence.publishFailed");
      setStorageMessage(detail);
      message.error(detail);
      return false;
    } finally {
      setPublishInFlight(false);
    }
  }, [dashboardId, message, t]);

  const runPreviewForDocument = useCallback(async (document: DashboardDocument) => {
    if (previewRefreshTimerRef.current !== null) {
      window.clearTimeout(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    previewRefreshRequestRef.current += 1;
    setPreviewState("loading");
    setPreviewMessage("Running runtime check...");

    try {
      const { bindingResults, rendererChecks } = await runDashboardPreview(
        document,
        breakpoint,
        dashboardId,
      );
      commitPreviewSnapshot(bindingResults, rendererChecks);
    } catch (error) {
      previewResultsRef.current = {};
      previewRendererChecksRef.current = {};
      setPreviewResults({});
      setPreviewRendererChecks({});
      setPreviewState("error");
      setPreviewMessage(
        error instanceof Error ? error.message : "Unknown preview failure.",
      );
    }
  }, [breakpoint, commitPreviewSnapshot, dashboardId]);

  const setPreviewHint = useCallback((hint: string) => {
    setPreviewMessage(hint);
  }, []);

  return {
    dashboard,
    dashboardRef,
    mobileLayoutMode,
    localSessionId,
    setMobileLayoutMode,
    mobileLayoutModeRef,
    storageMessage,
    previewState,
    previewMessage,
    previewResults,
    previewRendererChecks,
    hydrated,
    saveInFlight,
    publishInFlight,
    bumpPersistedDraftVersion: bumpLocalDraftVersion,
    setPreviewHint,
    applyDashboardMutation,
    updateDashboard,
    replaceDashboard,
    handleSaveDashboard,
    handlePublishDashboard,
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
