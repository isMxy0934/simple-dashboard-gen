"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadDashboardPreview } from "../api/preview-link-storage";
import { ViewerApp } from "./viewer-app";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./viewer.module.css";

interface PreviewViewerAppProps {
  previewKey?: string | null;
}

export function PreviewViewerApp({ previewKey }: PreviewViewerAppProps) {
  const { t } = useI18n();
  const [document, setDocument] = useState<ReturnType<typeof loadDashboardPreview> | null>(null);
  const [message, setMessage] = useState(
    previewKey ? t("viewer.empty.loadingDraftPreview") : t("viewer.empty.previewMissing"),
  );

  useEffect(() => {
    if (!previewKey) {
      return;
    }

    const nextDocument = loadDashboardPreview(previewKey);
    if (!nextDocument) {
      setMessage(t("viewer.empty.previewExpired"));
      return;
    }

    setDocument(nextDocument);
  }, [previewKey, t]);

  if (!document) {
    return (
      <div className={styles.emptyShell}>
        <div className={styles.emptyCard}>
          <div className={styles.emptyEyebrow}>{t("viewer.empty.previewEyebrow")}</div>
          <h1 className={styles.emptyTitle}>{t("viewer.empty.previewTitle")}</h1>
          <p className={styles.emptyBodyStandalone}>{message}</p>
          <Link href="/" className={styles.emptyLink}>
            {t("viewer.empty.back")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ViewerApp
      previewDocument={document.dashboard}
      previewUpdatedAt={document.savedAt}
    />
  );
}
