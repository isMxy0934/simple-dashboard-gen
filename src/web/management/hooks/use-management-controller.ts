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
import {
  createEmptyCollections,
  createLoadingCollections,
  describeCollection,
  filterDashboards,
  createRecentDashboards,
  createOverviewStats,
  type CollectionMeta,
  type DashboardCollectionState,
  type DashboardCollections,
  type ManagementSection,
  type OverviewStats,
  type ReportListTab,
} from "../state";

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
  activeCollection: DashboardCollectionState | null;
  activeCollectionMeta: CollectionMeta | null;
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
  const [actionMessage, setActionMessage] = useState("");
  const [createInFlight, setCreateInFlight] = useState(false);
  const [searchByMode, setSearchByMode] = useState<Record<DashboardListMode, string>>({
    authoring: "",
    viewer: "",
  });

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

  function handleSectionChange(entry: ManagementSection) {
    setSection(entry);
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
  const activeCollection =
    section !== "reports"
      ? null
      : collections[reportTab];
  const activeCollectionMeta =
    section !== "reports"
      ? null
      : describeCollection(reportTab, collections[reportTab]);
  const filteredDashboards =
    section !== "reports" || !activeCollection
      ? []
      : filterDashboards(activeCollection.dashboards, searchByMode[reportTab]);

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
    activeCollection,
    activeCollectionMeta,
    filteredDashboards,
    reloadCollections,
    handleCreate,
    handleDelete,
    handleUnpublish,
    handleSectionChange,
  };
}
