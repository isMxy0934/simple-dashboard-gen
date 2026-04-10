import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "../../../contracts";
import { loadViewerSnapshot } from "../api/viewer-api";
import { useI18n } from "../../i18n/i18n-context";

export function useViewerSnapshot(dashboardId?: string | null) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">(
    dashboardId ? "loading" : "idle",
  );
  const [message, setMessage] = useState(
    dashboardId
      ? t("viewer.empty.loadingDashboard")
      : t("viewer.empty.openSaved"),
  );

  useEffect(() => {
    if (!dashboardId) {
      return;
    }

    const resolvedDashboardId = dashboardId;
    let active = true;

    async function loadSnapshot() {
      setStatus("loading");
      setMessage(t("viewer.empty.loadingDashboard"));

      try {
        const nextSnapshot = await loadViewerSnapshot(resolvedDashboardId);
        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
        setStatus("idle");
      } catch (error) {
        if (!active) {
          return;
        }

        setSnapshot(null);
        setStatus("error");
        setMessage(
          error instanceof Error
            ? normalizeViewerSnapshotError(error.message, t)
            : t("viewer.empty.loadFailed"),
        );
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, [dashboardId, t]);

  return {
    snapshot,
    status,
    message,
  };
}

function normalizeViewerSnapshotError(
  message: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (message === "Unable to load dashboard.") {
    return t("viewer.empty.loadFailed");
  }

  return message;
}
