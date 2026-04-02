import type { DashboardDocument } from "../../../contracts";
import {
  cloneDashboardDocument,
  reconcileDashboardDocumentContract,
} from "../../../domain/dashboard/document";
import { formatTimestamp } from "../../utils/time";
import type { MobileLayoutMode } from "../state/authoring-state";

const STORAGE_KEY_PREFIX = "ai-dashboard-studio.authoring-draft.by-dashboard.v1:";

export interface PerDashboardAuthoringPersisted {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  /** Server draft version last seen on load or after successful save */
  serverDraftVersion: number;
  /** Client draft revision; higher than server baseline means unsaved local edits */
  localDraftVersion: number;
  updatedAt: string;
}

function keyFor(dashboardId: string) {
  return `${STORAGE_KEY_PREFIX}${dashboardId}`;
}

export function loadPerDashboardAuthoringPersisted(
  dashboardId: string,
): PerDashboardAuthoringPersisted | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(keyFor(dashboardId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PerDashboardAuthoringPersisted>;
    if (!parsed || typeof parsed.dashboard !== "object") {
      return null;
    }
    const serverDraftVersion = Number(parsed.serverDraftVersion);
    const localDraftVersion = Number(parsed.localDraftVersion);
    if (!Number.isFinite(serverDraftVersion) || !Number.isFinite(localDraftVersion)) {
      return null;
    }
    return {
      dashboard: reconcileDashboardDocumentContract(
        cloneDashboardDocument(parsed.dashboard as DashboardDocument),
        {
          mobileLayoutMode: parsed.mobileLayoutMode === "custom" ? "custom" : "auto",
        },
      ),
      selectedViewId: parsed.selectedViewId ?? null,
      mobileLayoutMode: parsed.mobileLayoutMode === "custom" ? "custom" : "auto",
      serverDraftVersion,
      localDraftVersion,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function persistPerDashboardAuthoringState(
  dashboardId: string,
  input: {
    dashboard: DashboardDocument;
    selectedViewId: string | null;
    mobileLayoutMode: MobileLayoutMode;
    serverDraftVersion: number;
    localDraftVersion: number;
  },
): string {
  const updatedAt = new Date().toISOString();
  const payload: PerDashboardAuthoringPersisted = {
    dashboard: input.dashboard,
    selectedViewId: input.selectedViewId,
    mobileLayoutMode: input.mobileLayoutMode,
    serverDraftVersion: input.serverDraftVersion,
    localDraftVersion: input.localDraftVersion,
    updatedAt,
  };
  window.localStorage.setItem(keyFor(dashboardId), JSON.stringify(payload));
  return formatTimestamp(updatedAt);
}

export function resolveAuthoringHydration(input: {
  remoteVersion: number;
  remoteDocument: DashboardDocument;
  remoteUpdatedAt: string;
  local: PerDashboardAuthoringPersisted | null;
}): {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  serverDraftVersion: number;
  localDraftVersion: number;
  message: string;
} {
  const remoteDoc = reconcileDashboardDocumentContract(
    cloneDashboardDocument(input.remoteDocument),
    { mobileLayoutMode: "auto" },
  );
  const { local } = input;

  if (
    local &&
    local.localDraftVersion > input.remoteVersion
  ) {
    const dashboard = reconcileDashboardDocumentContract(
      cloneDashboardDocument(local.dashboard),
      { mobileLayoutMode: local.mobileLayoutMode ?? "auto" },
    );
    return {
      dashboard,
      selectedViewId:
        local.selectedViewId ?? dashboard.dashboard_spec.views[0]?.id ?? null,
      mobileLayoutMode: local.mobileLayoutMode ?? "auto",
      serverDraftVersion: input.remoteVersion,
      localDraftVersion: local.localDraftVersion,
      message: `Restored local draft v${local.localDraftVersion} (server v${input.remoteVersion}, saved ${formatTimestamp(local.updatedAt)}).`,
    };
  }

  const selectedViewId =
    remoteDoc.dashboard_spec.views[0]?.id ?? null;
  return {
    dashboard: remoteDoc,
    selectedViewId,
    mobileLayoutMode: "auto",
    serverDraftVersion: input.remoteVersion,
    localDraftVersion: input.remoteVersion,
    message: `Loaded dashboard v${input.remoteVersion} from ${formatTimestamp(input.remoteUpdatedAt)}.`,
  };
}
