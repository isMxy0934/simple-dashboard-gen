"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadDashboardPreview } from "../api/preview-link-storage";
import { ViewerApp } from "./viewer-app";
import styles from "./viewer.module.css";

interface PreviewViewerAppProps {
  previewKey?: string | null;
}

export function PreviewViewerApp({ previewKey }: PreviewViewerAppProps) {
  const [document, setDocument] = useState<ReturnType<typeof loadDashboardPreview> | null>(null);
  const [message, setMessage] = useState(
    previewKey ? "Loading draft preview..." : "Preview link is missing.",
  );

  useEffect(() => {
    if (!previewKey) {
      return;
    }

    const nextDocument = loadDashboardPreview(previewKey);
    if (!nextDocument) {
      setMessage("Preview draft is no longer available. Re-open preview from creator.");
      return;
    }

    setDocument(nextDocument);
  }, [previewKey]);

  if (!document) {
    return (
      <div className={styles.emptyShell}>
        <div className={styles.emptyCard}>
          <div className={styles.emptyEyebrow}>Preview</div>
          <h1 className={styles.emptyTitle}>Open draft preview</h1>
          <p className={styles.emptyBodyStandalone}>{message}</p>
          <Link href="/" className={styles.emptyLink}>
            Back to workspace
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
