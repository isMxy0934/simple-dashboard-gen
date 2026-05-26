"use client";

import type { WorkspaceMember, WorkspaceRole, WorkspaceRoleId } from "@/contracts";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

const ROLE_LABEL_KEYS: Record<WorkspaceRoleId, string> = {
  viewer: "management.users.viewerRole",
  editor: "management.users.editorRole",
  admin: "management.users.adminRole",
};

const ROLE_HINT_KEYS: Record<WorkspaceRoleId, string> = {
  viewer: "management.users.viewerRoleHint",
  editor: "management.users.editorRoleHint",
  admin: "management.users.adminRoleHint",
};

interface UsersPanelProps {
  users: WorkspaceMember[];
  roles: WorkspaceRole[];
  currentUserId: string;
  canManageRoles: boolean;
  loading: boolean;
  error: string;
  actionMessage: string;
  roleUpdatingUserId: string;
  onRoleChange: (userId: string, roleId: WorkspaceRoleId) => void;
}

export function UsersPanel({
  users,
  roles,
  currentUserId,
  canManageRoles,
  loading,
  error,
  actionMessage,
  roleUpdatingUserId,
  onRoleChange,
}: UsersPanelProps) {
  const { t } = useI18n();
  const statusText = loading ? t("management.users.loading") : t("management.users.description");
  const visibleRoles = roles.length > 0
    ? roles
    : (["viewer", "editor", "admin"] as WorkspaceRoleId[]).map((roleId) => ({
        role_id: roleId,
        name: t(ROLE_LABEL_KEYS[roleId]),
        permissions: [],
      }));

  return (
    <section className={styles.pageCard}>
      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.users.title")}</h2>
          <span>{statusText}</span>
        </div>
        <div className={styles.chipRow}>
          <span className={styles.chip}>
            {t("management.settings.memberCount", { count: users.length })}
          </span>
          {!canManageRoles ? (
            <span className={`${styles.metaChip} ${styles.metaChipWarning}`}>
              {t("management.users.readOnly")}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.secondaryAction}
            disabled
            title={t("management.common.comingSoon")}
          >
            {t("management.users.invite")}
          </button>
        </div>
      </header>

      {error ? (
        <div className={`${styles.noticeBanner} ${styles.noticeBannerError}`} role="alert">
          <span className={styles.noticeMark} aria-hidden="true">
            !
          </span>
          <span className={styles.noticeBody}>
            <strong>{error}</strong>
            <span>{t("management.users.loadFailedHint")}</span>
          </span>
        </div>
      ) : null}

      {actionMessage ? (
        <div className={`${styles.noticeBanner} ${styles.noticeBannerInfo}`} role="status">
          <span className={styles.noticeMark} aria-hidden="true">
            i
          </span>
          <span className={styles.noticeBody}>
            <strong>{actionMessage}</strong>
          </span>
        </div>
      ) : null}

      <div className={styles.usersGrid}>
        <section className={styles.pageSubPanel} aria-labelledby="members-heading">
          <div className={styles.panelHeading}>
            <h3 id="members-heading">{t("management.users.members")}</h3>
            <span className={styles.metaChip}>{t("management.users.connected")}</span>
          </div>
          <div className={styles.memberList}>
            {users.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>{t("management.users.emptyTitle")}</strong>
                <p>{t("management.users.emptyHint")}</p>
              </div>
            ) : (
              users.map((user) => (
                <article key={user.user_id} className={styles.memberRow}>
                  <div className={styles.memberIdentity}>
                    <strong>{user.name}</strong>
                    <span>{user.email ?? user.user_id}</span>
                    <span>{user.user_id}</span>
                  </div>
                  <div className={styles.memberRoleSection}>
                    <div className={styles.memberMeta}>
                      {user.user_id === currentUserId ? (
                        <span className={styles.metaChip}>
                          {t("management.users.currentLogin")}
                        </span>
                      ) : null}
                      <span className={styles.metaChip}>
                        {user.role_name || t(ROLE_LABEL_KEYS[user.role_id])}
                      </span>
                    </div>
                    <div
                      className={styles.roleSegment}
                      role="group"
                      aria-label={t("management.users.roleControlAria", {
                        name: user.name,
                      })}
                    >
                      {visibleRoles.map((role) => {
                        const selected = user.role_id === role.role_id;
                        const updating = roleUpdatingUserId === user.user_id;
                        return (
                          <button
                            key={role.role_id}
                            type="button"
                            className={`${styles.roleOption} ${
                              selected ? styles.roleOptionActive : ""
                            }`}
                            aria-pressed={selected}
                            disabled={!canManageRoles || updating}
                            onClick={() => {
                              if (!selected) {
                                onRoleChange(user.user_id, role.role_id);
                              }
                            }}
                          >
                            {t(ROLE_LABEL_KEYS[role.role_id])}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <aside className={styles.pageSubPanel} aria-labelledby="roles-heading">
          <div className={styles.panelHeading}>
            <h3 id="roles-heading">{t("management.users.roles")}</h3>
            <span className={styles.metaChip}>
              {t("management.users.reloginRequired")}
            </span>
          </div>
          <div className={styles.roleCatalog}>
            {visibleRoles.map((role) => (
              <div key={role.role_id} className={styles.roleCatalogItem}>
                <strong>{t(ROLE_LABEL_KEYS[role.role_id])}</strong>
                <span>{t(ROLE_HINT_KEYS[role.role_id])}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
