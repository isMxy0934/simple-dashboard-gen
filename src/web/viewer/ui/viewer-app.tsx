"use client";

import Link from "next/link";
import type { DashboardSnapshot } from "../../../contracts";
import { useViewerSnapshot } from "../hooks/use-viewer-snapshot";
import { ViewerDashboard } from "./viewer-dashboard";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./viewer.module.css";

interface ViewerAppProps {
  dashboardId?: string | null;
  workspaceId?: string | null;
  previewDocument?: DashboardSnapshot["document"] | null;
  previewUpdatedAt?: string | null;
}

export function ViewerApp({
  dashboardId,
  workspaceId,
  previewDocument,
  previewUpdatedAt,
}: ViewerAppProps) {
  const { t } = useI18n();
  const { snapshot, status, message } = useViewerSnapshot(dashboardId, workspaceId);

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
      workspaceId={snapshot.workspace_id ?? workspaceId ?? null}
      version={snapshot.version}
      dashboard={snapshot.document}
      updatedAt={snapshot.updated_at}
    />
  );
}

function ViewerEmptyState({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.emptyShell}>
      <div className={styles.emptyCard}>
        <div className={styles.emptyEyebrow}>{t("viewer.empty.eyebrow")}</div>
        <h1 className={styles.emptyTitle}>{t("viewer.empty.title")}</h1>
        <p className={styles.emptyBodyStandalone}>{message}</p>
        <Link href="/" className={styles.emptyLink}>
          {t("viewer.empty.back")}
        </Link>
      </div>
    </div>
  );
}
