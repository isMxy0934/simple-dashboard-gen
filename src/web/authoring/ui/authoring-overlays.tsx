"use client";

import Link from "next/link";
import type { DashboardDocument } from "@/contracts";
import type { AuthoringBreakpoint } from "../state/authoring-state";
import { ViewerApp } from "../../viewer";

interface AuthoringOverlaysProps {
  publishedShareUrl: string | null;
  copiedShareLink: boolean;
  inlinePreview: {
    document: DashboardDocument;
    savedAt: string;
  } | null;
  previewViewMode: AuthoringBreakpoint;
  styles: Record<string, string>;
  t: (key: string) => string;
  onCopyShareLink: () => void;
  onClosePreview: () => void;
}

export function AuthoringOverlays({
  publishedShareUrl,
  copiedShareLink,
  inlinePreview,
  previewViewMode,
  styles,
  t,
  onCopyShareLink,
  onClosePreview,
}: AuthoringOverlaysProps) {
  return (
    <>
      {publishedShareUrl ? (
        <section className={styles.shareBanner}>
          <div className={styles.shareBannerCopy}>
            <div className={styles.panelEyebrow}>{t("authoring.topbar.shareEyebrow")}</div>
            <strong>{t("authoring.topbar.shareTitle")}</strong>
            <p>{publishedShareUrl}</p>
          </div>
          <div className={styles.shareBannerActions}>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              onClick={onCopyShareLink}
            >
              {copiedShareLink
                ? t("authoring.topbar.shareCopied")
                : t("authoring.topbar.copyLink")}
            </button>
            <Link
              href={publishedShareUrl}
              className={`${styles.secondaryAction} ${styles.navAction}`}
            >
              {t("authoring.topbar.openPublished")}
            </Link>
          </div>
        </section>
      ) : null}

      {inlinePreview ? (
        <section className={styles.previewOverlay}>
          <div className={styles.previewOverlayHeader}>
            <div className={styles.previewOverlayCopy}>
              <div className={styles.panelEyebrow}>{t("authoring.topbar.previewEyebrow")}</div>
            </div>
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.workspaceAction}`}
              onClick={onClosePreview}
            >
              {t("authoring.topbar.closePreview")}
            </button>
          </div>
          <div className={styles.previewOverlayFrame}>
            <ViewerApp
              previewDocument={inlinePreview.document}
              previewUpdatedAt={inlinePreview.savedAt}
              previewViewMode={previewViewMode}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}
