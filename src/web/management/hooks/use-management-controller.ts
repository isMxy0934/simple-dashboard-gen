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
} from "../state";

export interface UseManagementControllerResult {
  section: ManagementSection;
  setSection: (section: ManagementSection) => void;
  collections: DashboardCollections;
  actionMessage: string;
  createInFlight: boolean;
  activeAuthoringDashboardId: string | null;
  sidebarCollapsed: boolean;
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
  openEmbeddedAuthoring: (dashboardId: string) => void;
  closeEmbeddedAuthoring: () => void;
  handleSectionChange: (entry: ManagementSection) => void;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}

export function useManagementController(): UseManagementControllerResult {
  const router = useRouter();
  const { t } = useI18n();
  const [section, setSection] = useState<ManagementSection>("overview");
  const [collections, setCollections] = useState<DashboardCollections>(
    createEmptyCollections(),
  );
  const [actionMessage, setActionMessage] = useState("");
  const [createInFlight, setCreateInFlight] = useState(false);
  const [activeAuthoringDashboardId, setActiveAuthoringDashboardId] = useState<
    string | null
  >(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchByMode, setSearchByMode] = useState<Record<DashboardListMode, string>>({
    authoring: "",
    viewer: "",
  });

  const reloadCollections = useCallback(async () => {
    setCollections(createLoadingCollections());

    try {
      const nextCollections = await loadManagementCollections();
      setCollections(nextCollections);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load dashboards.";
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
  }, [t]);

  useEffect(() => {
    void reloadCollections();
  }, [reloadCollections]);

  function closeEmbeddedAuthoring() {
    setActiveAuthoringDashboardId(null);
    setSidebarCollapsed(false);
  }

  function openEmbeddedAuthoring(dashboardId: string) {
    setSection("authoring");
    setActiveAuthoringDashboardId(dashboardId);
    setSidebarCollapsed(true);
  }

  function handleSectionChange(entry: ManagementSection) {
    setSection(entry);

    if (entry === "authoring") {
      if (activeAuthoringDashboardId) {
        closeEmbeddedAuthoring();
      }
      return;
    }

    closeEmbeddedAuthoring();
  }

  async function handleCreate() {
    setCreateInFlight(true);
    setActionMessage(t("management.action.creating"));

    try {
      const dashboardId = await createManagementDashboard();
      await reloadCollections();
      setActionMessage(t("management.action.created"));
      router.push(`/authoring/${encodeURIComponent(dashboardId)}`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to create dashboard.",
      );
    } finally {
      setCreateInFlight(false);
    }
  }

  async function handleDelete(dashboardId: string) {
    try {
      await deleteManagementDashboard(dashboardId);
      await reloadCollections();
      if (activeAuthoringDashboardId === dashboardId) {
        closeEmbeddedAuthoring();
      }
      setActionMessage(t("management.action.deleted"));
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to delete dashboard.",
      );
    }
  }

  async function handleUnpublish(dashboardId: string) {
    try {
      await unpublishManagementDashboard(dashboardId);
      await reloadCollections();
      setActionMessage(t("management.action.unpublished"));
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to unpublish dashboard.",
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
    section === "overview" ? null : collections[section];
  const activeCollectionMeta =
    section === "overview" ? null : describeCollection(section, collections[section]);
  const filteredDashboards =
    section === "overview" || !activeCollection
      ? []
      : filterDashboards(activeCollection.dashboards, searchByMode[section]);

  return {
    section,
    setSection,
    collections,
    actionMessage,
    createInFlight,
    activeAuthoringDashboardId,
    sidebarCollapsed,
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
    openEmbeddedAuthoring,
    closeEmbeddedAuthoring,
    handleSectionChange,
    setSidebarCollapsed,
  };
}
