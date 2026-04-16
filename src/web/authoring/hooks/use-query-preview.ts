import { useCallback, useState } from "react";
import type { BindingResults, DashboardDocument } from "../../../contracts";
import { runDashboardPreview } from "../api/preview-api";
import type { AuthoringBreakpoint } from "../state/authoring-state";

/**
 * Run live preview for a single view (delegates to /api/preview with visible_view_ids).
 */
export function useAuthoringViewLivePreview() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (input: {
      dashboard: DashboardDocument;
      breakpoint: AuthoringBreakpoint;
      dashboardId?: string | null;
      workspaceId?: string | null;
      sessionId?: string | null;
      viewId: string;
    }): Promise<BindingResults | null> => {
      setLoading(true);
      setError(null);
      try {
        const { bindingResults } = await runDashboardPreview(
          input.dashboard,
          input.breakpoint,
          input.dashboardId,
          input.workspaceId,
          input.sessionId,
          { visibleViewIds: [input.viewId] },
        );
        return bindingResults;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { run, loading, error };
}
