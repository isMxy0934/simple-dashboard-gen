"use client";

import Link from "next/link";
import type { DashboardSnapshot } from "../../../contracts";
import { useViewerSnapshot } from "../hooks/use-viewer-snapshot";
import { ViewerDashboard } from "./viewer-dashboard";
import styles from "./viewer.module.css";

interface ViewerAppProps {
  dashboardId?: string | null;
  previewDocument?: DashboardSnapshot["document"] | null;
  previewUpdatedAt?: string | null;
}

export function ViewerApp({
  dashboardId,
  previewDocument,
  previewUpdatedAt,
}: ViewerAppProps) {
  const { snapshot, status, message } = useViewerSnapshot(dashboardId);

  if (previewDocument) {
    return (
      <ViewerDashboard
        dashboardId="preview"
        version={0}
        dashboard={previewDocument}
        updatedAt={previewUpdatedAt ?? new Date().toISOString()}
        previewMode
      />
    );
  }

  if (!dashboardId) {
    return <ViewerEmptyState message={message} />;
  }

  if (status === "loading" || !snapshot) {
    return <ViewerEmptyState message={message} />;
  }

  return (
    <ViewerDashboard
      dashboardId={snapshot.dashboard_id}
      version={snapshot.version}
      dashboard={snapshot.document}
      updatedAt={snapshot.updated_at}
    />
  );
}

function ViewerEmptyState({ message }: { message: string }) {
  return (
    <div className={styles.emptyShell}>
      <div className={styles.emptyCard}>
        <div className={styles.emptyEyebrow}>Viewer</div>
        <h1 className={styles.emptyTitle}>Open a dashboard</h1>
        <p className={styles.emptyBodyStandalone}>{message}</p>
        <Link href="/" className={styles.emptyLink}>
          Back to workspace
        </Link>
      </div>
    </div>
  );
}
