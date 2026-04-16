"use client";

import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import type { DashboardDocument } from "@/contracts";
import type { AuthoringBreakpoint } from "../state/authoring-state";

interface AuthoringTopbarProps {
  dashboard: DashboardDocument;
  storageMessage: string;
  workspaceLoading: boolean;
  workspaceError: string;
  workspaceName: string;
  selectedUserName: string | null;
  sessionId: string;
  editingPresenceNames: string[];
  breakpoint: AuthoringBreakpoint;
  setBreakpoint: Dispatch<SetStateAction<AuthoringBreakpoint>>;
  undoDepth: number;
  hydrated: boolean;
  saveInFlight: boolean;
  publishInFlight: boolean;
  dashboardId?: string | null;
  inlinePreviewOpen: boolean;
  embedded: boolean;
  embeddedMenuCollapsed: boolean;
  styles: Record<string, string>;
  t: (key: string, values?: Record<string, string | number>) => string;
  onDashboardNameChange: (value: string) => void;
  onUndo: () => void;
  onRunCheck: () => void;
  onSave: () => void;
  onPublish: () => void;
  onToggleInlinePreview: () => void;
  onToggleEmbeddedMenu?: () => void;
}

export function AuthoringTopbar({
  dashboard,
  storageMessage,
  workspaceLoading,
  workspaceError,
  workspaceName,
  selectedUserName,
  sessionId,
  editingPresenceNames,
  breakpoint,
  setBreakpoint,
  undoDepth,
  hydrated,
  saveInFlight,
  publishInFlight,
  dashboardId,
  inlinePreviewOpen,
  embedded,
  embeddedMenuCollapsed,
  styles,
  t,
  onDashboardNameChange,
  onUndo,
  onRunCheck,
  onSave,
  onPublish,
  onToggleInlinePreview,
  onToggleEmbeddedMenu,
}: AuthoringTopbarProps) {
  return (
    <header className={`${styles.topbar} ${embedded ? styles.topbarEmbedded : ""}`}>
      <div className={styles.brandBlock}>
        <input
          className={styles.dashboardNameInput}
          value={dashboard.dashboard_spec.dashboard.name}
          onChange={(event) => onDashboardNameChange(event.target.value)}
          aria-label={t("authoring.topbar.dashboardNameAria")}
        />
        <div className={styles.statusLine}>{storageMessage}</div>
        <div className={styles.statusLine}>
          {workspaceLoading
            ? "Loading workspace context..."
            : workspaceError
              ? workspaceError
              : `${workspaceName} · ${selectedUserName ?? "No user selected"} · ${sessionId}`}
        </div>
        {editingPresenceNames.length > 0 ? (
          <div className={styles.statusLine}>
            Editing now: {editingPresenceNames.join(", ") || "nobody"}
          </div>
        ) : null}
      </div>

      <div className={styles.topbarActions}>
        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupSubtools}`}>
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

        <div className={`${styles.toolbarGroup} ${styles.toolbarGroupWorkspace}`}>
          <button
            type="button"
            className={`${styles.secondaryAction} ${styles.workspaceAction}`}
            disabled={!undoDepth}
            onClick={onUndo}
          >
            {t("authoring.topbar.undo")}
          </button>
          <button
            type="button"
            className={`${styles.secondaryAction} ${styles.workspaceAction}`}
            disabled={!hydrated}
            onClick={onRunCheck}
          >
            {t("authoring.canvas.runCheck")}
          </button>
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
          <button
            type="button"
            className={`${styles.secondaryAction} ${styles.workspaceAction}`}
            disabled={!hydrated}
            onClick={onToggleInlinePreview}
          >
            {inlinePreviewOpen
              ? t("authoring.topbar.closePreview")
              : t("authoring.topbar.openPreview")}
          </button>
          <Link
            href="/"
            className={`${styles.secondaryAction} ${styles.navAction}`}
          >
            {t("authoring.topbar.backHome")}
          </Link>
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
      </div>
    </header>
  );
}
