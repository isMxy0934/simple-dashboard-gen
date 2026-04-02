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
import { formatTimestamp } from "../../../shared/time";
import {
  type PreviewState,
  formatRuntimeCheckSummary,
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
import { useI18n } from "../../shared/i18n/i18n-context";
import type {
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
} from "../../../contracts";

const LOCAL_PERSIST_DEBOUNCE_MS = 450;

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

  const [dashboard, setDashboard] = useState<DashboardDocument>(
    initialDashboardRef.current,
  );
  const [mobileLayoutMode, setMobileLayoutMode] =
    useState<MobileLayoutMode>("auto");
  const [localSessionId, setLocalSessionId] = useState<string>(() =>
    globalThis.crypto.randomUUID(),
  );
  const [storageMessage, setStorageMessage] = useState<string>(
    dashboardId ? "Loading dashboard..." : "Local draft is ready.",
  );
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewMessage, setPreviewMessage] = useState<string>(
    "Run a runtime check after data bindings are ready.",
  );
  const [previewResults, setPreviewResults] = useState<BindingResults>({});
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

  const resetPreview = useCallback(() => {
    setPreviewResults({});
    setPreviewState("idle");
    setPreviewMessage("Run a runtime check after data bindings are ready.");
  }, []);

  const updateDashboard = useCallback((
    updater: (next: DashboardDocument) => void,
    options?: {
      syncMobileFromDesktop?: boolean;
      reconcileBreakpoint?: AuthoringBreakpoint;
      anchoredViewId?: string;
      clearPreview?: boolean;
    },
  ) => {
    setDashboard((current) => {
      const next = cloneDashboardDocument(current);
      updater(next);

      if (options?.reconcileBreakpoint) {
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
        next.dashboard_spec.layout.mobile = generateMobileLayout(
          next.dashboard_spec.layout.desktop,
        );
      }

      dashboardRef.current = next;
      return next;
    });

    bumpLocalDraftVersion();

    if (options?.clearPreview !== false) {
      resetPreview();
    }
  }, [bumpLocalDraftVersion, resetPreview]);

  const replaceDashboard = useCallback((
    nextDashboard: DashboardDocument,
    clearPreview = true,
  ) => {
    const reconciled = reconcileDashboardDocumentContract(nextDashboard, {
      mobileLayoutMode: mobileLayoutModeRef.current,
    });
    dashboardRef.current = reconciled;
    setDashboard(reconciled);
    bumpLocalDraftVersion();

    if (clearPreview) {
      resetPreview();
    }
  }, [bumpLocalDraftVersion, resetPreview]);

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
    setPreviewState("loading");
    setPreviewMessage("Running runtime check...");

    try {
      const bindingResults = await runDashboardPreview(document, breakpoint);
      setPreviewResults(bindingResults);
      setPreviewState("ready");
      setPreviewMessage(formatRuntimeCheckSummary(bindingResults));
    } catch (error) {
      setPreviewResults({});
      setPreviewState("error");
      setPreviewMessage(
        error instanceof Error ? error.message : "Unknown preview failure.",
      );
    }
  }, [breakpoint]);

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
