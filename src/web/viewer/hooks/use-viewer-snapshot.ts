import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "../../../contracts";
import { loadViewerSnapshot } from "../api/viewer-api";

export function useViewerSnapshot(dashboardId?: string | null) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">(
    dashboardId ? "loading" : "idle",
  );
  const [message, setMessage] = useState(
    dashboardId
      ? "Loading dashboard..."
      : "Open a saved dashboard from the management page.",
  );

  useEffect(() => {
    if (!dashboardId) {
      return;
    }

    const resolvedDashboardId = dashboardId;
    let active = true;

    async function loadSnapshot() {
      setStatus("loading");
      setMessage("Loading dashboard...");

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
          error instanceof Error ? error.message : "Unable to load dashboard.",
        );
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, [dashboardId]);

  return {
    snapshot,
    status,
    message,
  };
}
