"use client";

import Link from "next/link";

interface AuthoringOverlaysProps {
  publishedShareUrl: string | null;
  copiedShareLink: boolean;
  styles: Record<string, string>;
  t: (key: string) => string;
  onCopyShareLink: () => void;
}

export function AuthoringOverlays({
  publishedShareUrl,
  copiedShareLink,
  styles,
  t,
  onCopyShareLink,
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
              target="_blank"
              rel="noreferrer"
            >
              {t("authoring.topbar.openPublished")}
            </Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
