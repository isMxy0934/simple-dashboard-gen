"use client";

import Link from "next/link";
import type { Dispatch, MouseEvent, SetStateAction } from "react";
import type { AuthoringBreakpoint } from "../state/authoring-state";
import { formatReportDisplayName } from "../../i18n/report-display-name";

interface AuthoringTopbarProps {
  breakpoint: AuthoringBreakpoint;
  setBreakpoint: Dispatch<SetStateAction<AuthoringBreakpoint>>;
  undoDepth: number;
  hydrated: boolean;
  saveInFlight: boolean;
  publishInFlight: boolean;
  hasUnsavedChanges: boolean;
  dashboardId?: string | null;
  dashboardTitle: string;
  previewHref: string;
  embedded: boolean;
  embeddedMenuCollapsed: boolean;
  copilotCollapsed: boolean;
  copilotAttention: boolean;
  styles: Record<string, string>;
  t: (key: string, values?: Record<string, string | number>) => string;
  onUndo: () => void;
  onSave: () => void;
  onPublish: () => void;
  onOpenPreview: (event: MouseEvent<HTMLAnchorElement>) => void;
  onToggleCopilot: () => void;
  onToggleEmbeddedMenu?: () => void;
}

export function AuthoringTopbar({
  breakpoint,
  setBreakpoint,
  undoDepth,
  hydrated,
  saveInFlight,
  publishInFlight,
  hasUnsavedChanges,
  dashboardId,
  dashboardTitle,
  previewHref,
  embedded,
  embeddedMenuCollapsed,
  copilotCollapsed,
  copilotAttention,
  styles,
  t,
  onUndo,
  onSave,
  onPublish,
  onOpenPreview,
  onToggleCopilot,
  onToggleEmbeddedMenu,
}: AuthoringTopbarProps) {
  const reportTitle = formatReportDisplayName(dashboardTitle);
  const statusLabel = publishInFlight
    ? t("authoring.topbar.publishingStatus")
    : saveInFlight
      ? t("authoring.topbar.savingStatus")
      : hasUnsavedChanges
        ? t("authoring.topbar.unsavedStatus")
        : hydrated && dashboardId
          ? t("authoring.topbar.savedStatus")
          : dashboardId
            ? t("common.loading")
            : t("authoring.topbar.draftStatus");

  return (
    <header className={`${styles.topbar} ${embedded ? styles.topbarEmbedded : ""}`}>
      <div className={styles.topbarIdentity}>
        <Link
          href="/?section=reports&tab=drafts"
          className={`${styles.secondaryAction} ${styles.navAction}`}
        >
          {t("authoring.topbar.backReports")}
        </Link>
        <div className={styles.topbarTitleBlock}>
          <div className={styles.panelEyebrow}>{t("authoring.topbar.eyebrow")}</div>
          <h1 className={styles.topbarTitle}>{reportTitle}</h1>
        </div>
        <span className={styles.topbarStatus}>{statusLabel}</span>
      </div>

      <div className={styles.topbarActions}>
        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupView}`}>
          <div className={styles.segmented}>
            {(["desktop", "mobile"] as AuthoringBreakpoint[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={breakpoint === mode ? styles.segmentedActive : ""}
                onClick={() => setBreakpoint(mode)}
              >
                {mode === "desktop"
                  ? t("authoring.topbar.desktop")
                  : t("authoring.topbar.mobile")}
              </button>
            ))}
          </div>
        </div>

        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupEdit}`}>
          <button
            type="button"
            className={`${styles.secondaryAction} ${styles.workspaceAction}`}
            disabled={!undoDepth}
            onClick={onUndo}
          >
            {t("authoring.topbar.undo")}
          </button>
        </div>

        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupDelivery}`}>
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className={`${styles.secondaryAction} ${styles.workspaceAction}`}
            aria-disabled={!hydrated}
            tabIndex={hydrated ? undefined : -1}
            onClick={onOpenPreview}
          >
            {t("authoring.topbar.openPreview")}
          </a>
          <button
            type="button"
            className={`${styles.primaryAction} ${styles.saveAction}`}
            disabled={!hydrated || saveInFlight || publishInFlight}
            onClick={onSave}
          >
            {saveInFlight ? t("common.loading") : t("authoring.topbar.save")}
          </button>
          <button
            type="button"
            className={styles.publishAction}
            disabled={!hydrated || saveInFlight || publishInFlight || !dashboardId}
            onClick={onPublish}
          >
            {publishInFlight ? t("common.loading") : t("authoring.topbar.publish")}
          </button>
          {embedded ? (
            <button
              type="button"
              className={`${styles.secondaryAction} ${styles.navAction}`}
              onClick={onToggleEmbeddedMenu}
            >
              {embeddedMenuCollapsed
                ? t("authoring.topbar.showMenu")
                : t("authoring.topbar.hideMenu")}
            </button>
          ) : null}
        </div>

        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupAi}`}>
          <button
            type="button"
            className={`${styles.secondaryAction} ${styles.workspaceAction} ${styles.topbarCopilotAction} ${
              copilotCollapsed ? "" : styles.topbarCopilotActionActive
            }`}
            aria-pressed={!copilotCollapsed}
            aria-label={
              copilotCollapsed
                ? t("authoring.topbar.openCopilot")
                : t("authoring.topbar.closeCopilot")
            }
            onClick={onToggleCopilot}
          >
            <span>{t("authoring.topbar.aiCopilot")}</span>
            {copilotAttention ? (
              <span className={styles.topbarCopilotDot} aria-hidden="true" />
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}
