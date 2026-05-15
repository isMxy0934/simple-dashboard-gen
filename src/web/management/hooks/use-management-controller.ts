"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import type { DashboardListMode, DashboardSummary } from "../../../contracts";
import { useI18n } from "../../i18n/i18n-context";
import {
  createManagementDashboard,
  deleteManagementDashboard,
  loadManagementCollections,
  unpublishManagementDashboard,
} from "../api/management-api";
import { fetchManagementDatasources } from "../api/datasource-api";
import {
  createEmptyCollections,
  createLoadingCollections,
  filterDashboards,
  createRecentDashboards,
  createOverviewStats,
  type DashboardCollectionState,
  type DashboardCollections,
  type DatasourceOverviewState,
  type ManagementSection,
  type OverviewStats,
  type ReportListTab,
} from "../state";

function managementHrefFor(entry: ManagementSection): string {
  return entry === "overview" ? "/" : `/?section=${entry}`;
}

function resolveSectionFromSearch(search: string): ManagementSection {
  const section = new URLSearchParams(search).get("section");

  if (section === "reports" || section === "authoring") {
    return "reports";
  }

  if (section === "viewer") {
    return "views";
  }

  if (
    section === "datasources" ||
    section === "views" ||
    section === "users" ||
    section === "settings"
  ) {
    return section;
  }

  return "overview";
}

export interface UseManagementControllerResult {
  section: ManagementSection;
  setSection: (section: ManagementSection) => void;
  reportTab: ReportListTab;
  setReportTab: Dispatch<SetStateAction<ReportListTab>>;
  collections: DashboardCollections;
  actionMessage: string;
  createInFlight: boolean;
  searchByMode: Record<DashboardListMode, string>;
  setSearchByMode: Dispatch<SetStateAction<Record<DashboardListMode, string>>>;
  overviewStats: OverviewStats;
  recentDashboards: DashboardSummary[];
  datasourceOverview: DatasourceOverviewState;
  activeCollection: DashboardCollectionState | null;
  filteredDashboards: DashboardSummary[];
  reloadCollections: () => Promise<void>;
  handleCreate: () => Promise<void>;
  handleDelete: (dashboardId: string) => Promise<void>;
  handleUnpublish: (dashboardId: string) => Promise<void>;
  handleSectionChange: (entry: ManagementSection) => void;
}

export function useManagementController(input?: {
  workspaceId?: string;
  userId?: string;
  enabled?: boolean;
  initialSection?: ManagementSection;
  initialReportTab?: ReportListTab;
}): UseManagementControllerResult {
  const router = useRouter();
  const { t } = useI18n();
  const workspaceId = input?.workspaceId?.trim() ?? "";
  const userId = input?.userId?.trim() ?? "";
  const enabled = input?.enabled ?? Boolean(workspaceId);
  const [section, setSection] = useState<ManagementSection>(
    input?.initialSection ?? "overview",
  );
  const [reportTab, setReportTab] = useState<ReportListTab>(
    input?.initialReportTab ?? "authoring",
  );
  const [collections, setCollections] = useState<DashboardCollections>(
    createEmptyCollections(),
  );
  const [datasourceOverview, setDatasourceOverview] =
    useState<DatasourceOverviewState>({
      count: 0,
      status: "loading",
      message: "",
    });
  const [actionMessage, setActionMessage] = useState("");
  const [createInFlight, setCreateInFlight] = useState(false);
  const [searchByMode, setSearchByMode] = useState<Record<DashboardListMode, string>>({
    authoring: "",
    viewer: "",
  });

  useEffect(() => {
    setSection(input?.initialSection ?? "overview");
  }, [input?.initialSection]);

  useEffect(() => {
    setReportTab(input?.initialReportTab ?? "authoring");
  }, [input?.initialReportTab]);

  useEffect(() => {
    function handlePopState() {
      setSection(resolveSectionFromSearch(window.location.search));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const reloadCollections = useCallback(async () => {
    if (!enabled || !workspaceId) {
      setCollections(createEmptyCollections());
      return;
    }

    setCollections(createLoadingCollections());

    try {
      const nextCollections = await loadManagementCollections({ workspaceId });
      setCollections(nextCollections);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load reports.";
      setCollections({
        authoring: {
          dashboards: [],
          status: "error",
          message: `${t("management.collection.loadErrorAuthoringPrefix")} ${message}`,
        },
        viewer: {
          dashboards: [],
          status: "error",
          message: `${t("management.collection.loadErrorViewerPrefix")} ${message}`,
        },
      });
    }
  }, [enabled, t, workspaceId]);

  useEffect(() => {
    void reloadCollections();
  }, [reloadCollections]);

  const reloadDatasourceOverview = useCallback(async () => {
    if (!enabled) {
      setDatasourceOverview({ count: 0, status: "loading", message: "" });
      return;
    }

    setDatasourceOverview((current) => ({
      ...current,
      status: "loading",
      message: "",
    }));

    try {
      const datasources = await fetchManagementDatasources();
      setDatasourceOverview({
        count: datasources.length,
        status: "idle",
        message: "",
      });
    } catch (error) {
      setDatasourceOverview({
        count: 0,
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : t("management.datasources.loadFailed"),
      });
    }
  }, [enabled, t]);

  useEffect(() => {
    void reloadDatasourceOverview();
  }, [reloadDatasourceOverview]);

  function handleSectionChange(entry: ManagementSection) {
    setSection(entry);
    const nextHref = managementHrefFor(entry);

    if (
      typeof window !== "undefined" &&
      `${window.location.pathname}${window.location.search}` !== nextHref
    ) {
      window.history.pushState(window.history.state, "", nextHref);
    }
  }

  async function handleCreate() {
    if (!enabled || !workspaceId || !userId) {
      setActionMessage("Workspace user is still loading.");
      return;
    }

    setCreateInFlight(true);
    setActionMessage(t("management.action.creating"));

    try {
      const dashboardId = await createManagementDashboard({
        workspaceId,
        userId,
      });
      await reloadCollections();
      setActionMessage(t("management.action.created"));
      router.push(`/authoring/${encodeURIComponent(dashboardId)}`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to create report.",
      );
    } finally {
      setCreateInFlight(false);
    }
  }

  async function handleDelete(dashboardId: string) {
    if (!enabled || !workspaceId) {
      setActionMessage("Workspace is still loading.");
      return;
    }

    try {
      await deleteManagementDashboard({ workspaceId, dashboardId });
      await reloadCollections();
      setActionMessage(t("management.action.deleted"));
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to delete report.",
      );
    }
  }

  async function handleUnpublish(dashboardId: string) {
    if (!enabled || !workspaceId) {
      setActionMessage("Workspace is still loading.");
      return;
    }

    try {
      await unpublishManagementDashboard({ workspaceId, dashboardId });
      await reloadCollections();
      setActionMessage(t("management.action.unpublished"));
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to unpublish report.",
      );
    }
  }

  const overviewStats = useMemo(
    () => createOverviewStats(collections),
    [collections],
  );
  const recentDashboards = useMemo(
    () => createRecentDashboards(collections),
    [collections],
  );
  const activeListMode =
    section === "reports" ? "authoring" : section === "views" ? "viewer" : null;
  const activeCollection = activeListMode ? collections[activeListMode] : null;
  const filteredDashboards =
    !activeListMode || !activeCollection
      ? []
      : filterDashboards(activeCollection.dashboards, searchByMode[activeListMode]);

  return {
    section,
    setSection,
    reportTab,
    setReportTab,
    collections,
    actionMessage,
    createInFlight,
    searchByMode,
    setSearchByMode,
    overviewStats,
    recentDashboards,
    datasourceOverview,
    activeCollection,
    filteredDashboards,
    reloadCollections,
    handleCreate,
    handleDelete,
    handleUnpublish,
    handleSectionChange,
  };
}
