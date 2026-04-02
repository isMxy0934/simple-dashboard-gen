import type { DashboardDocument } from "../../../contracts";
import {
  AUTHORING_DRAFT_STORAGE_KEY,
  type MobileLayoutMode,
  type PersistedAuthoringState,
} from "../state/authoring-state";
import {
  createInitialAuthoringDocument,
  ensureLayoutMap,
  reconcileDashboardDocumentContract,
} from "../../../domain/dashboard/document";
import { formatTimestamp } from "../../../shared/time";

export interface LoadedLocalAuthoringState {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  localSessionId: string;
  message: string;
}

function buildLocalSessionId() {
  return `local-${globalThis.crypto.randomUUID()}`;
}

export function loadLocalAuthoringState(): LoadedLocalAuthoringState {
  const raw = window.localStorage.getItem(AUTHORING_DRAFT_STORAGE_KEY);
  if (!raw) {
    const freshDashboard = ensureLayoutMap(createInitialAuthoringDocument());
    return {
      dashboard: freshDashboard,
      selectedViewId: freshDashboard.dashboard_spec.views[0]?.id ?? null,
      mobileLayoutMode: "auto",
      localSessionId: buildLocalSessionId(),
      message: "Started a fresh dashboard draft.",
    };
  }

  const persisted = JSON.parse(raw) as PersistedAuthoringState;
  if (!persisted || !persisted.dashboard) {
    const freshDashboard = ensureLayoutMap(createInitialAuthoringDocument());
    return {
      dashboard: freshDashboard,
      selectedViewId: freshDashboard.dashboard_spec.views[0]?.id ?? null,
      mobileLayoutMode: "auto",
      localSessionId: buildLocalSessionId(),
      message: "Started a fresh dashboard draft.",
    };
  }

  const mobileLayoutMode = persisted.mobileLayoutMode ?? "auto";
  const restoredDashboard = reconcileDashboardDocumentContract(
    persisted.dashboard,
    { mobileLayoutMode },
  );
  return {
    dashboard: restoredDashboard,
    selectedViewId:
      persisted.selectedViewId ?? restoredDashboard.dashboard_spec.views[0]?.id ?? null,
    mobileLayoutMode,
    localSessionId: persisted.localSessionId || buildLocalSessionId(),
    message: `Recovered local draft from ${formatTimestamp(persisted.updatedAt)}.`,
  };
}

export function persistLocalAuthoringState(input: {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  localSessionId: string;
}): string {
  const payload: PersistedAuthoringState = {
    dashboard: input.dashboard,
    selectedViewId: input.selectedViewId,
    mobileLayoutMode: input.mobileLayoutMode,
    localSessionId: input.localSessionId,
    updatedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(
    AUTHORING_DRAFT_STORAGE_KEY,
    JSON.stringify(payload),
  );

  return formatTimestamp(payload.updatedAt);
}
