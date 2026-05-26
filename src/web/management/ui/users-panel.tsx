"use client";

import type { WorkspaceMember, WorkspaceRole, WorkspaceRoleId } from "@/contracts";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

const ROLE_LABEL_KEYS: Record<WorkspaceRoleId, string> = {
  viewer: "management.users.viewerRole",
  editor: "management.users.editorRole",
  admin: "management.users.adminRole",
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

function getUserInitials(user: WorkspaceMember): string {
  const nameParts = user.name.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  const fallback = user.email ?? user.user_id;
  return fallback.slice(0, 2).toUpperCase();
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
  const roleTotals = users.reduce<Record<WorkspaceRoleId, number>>(
    (totals, user) => ({
      ...totals,
      [user.role_id]: totals[user.role_id] + 1,
    }),
    { viewer: 0, editor: 0, admin: 0 },
  );

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

      <div className={styles.memberDirectory}>
        <div className={styles.memberSummaryRow} aria-label={t("management.users.roleSummaryAria")}>
          <div className={styles.memberSummaryItem}>
            <span>{t("management.users.totalMembers")}</span>
            <strong>{users.length}</strong>
          </div>
          {(["admin", "editor", "viewer"] as WorkspaceRoleId[]).map((roleId) => (
            <div key={roleId} className={styles.memberSummaryItem}>
              <span>{t(ROLE_LABEL_KEYS[roleId])}</span>
              <strong>{roleTotals[roleId]}</strong>
            </div>
          ))}
        </div>

        <section className={styles.memberTable} aria-labelledby="members-heading">
          <div className={styles.memberTableHeader}>
            <h3 id="members-heading">{t("management.users.members")}</h3>
            <span>{t("management.users.statusColumn")}</span>
          </div>
          {users.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{t("management.users.emptyTitle")}</strong>
              <p>{t("management.users.emptyHint")}</p>
            </div>
          ) : (
            <div className={styles.memberTableBody}>
              {users.map((user) => {
                const updating = roleUpdatingUserId === user.user_id;
                return (
                  <article key={user.user_id} className={styles.memberTableRow}>
                    <div className={styles.memberIdentityCell}>
                      <span className={styles.memberAvatar} aria-hidden="true">
                        {getUserInitials(user)}
                      </span>
                      <div className={styles.memberIdentityBlock}>
                        <strong>{user.name}</strong>
                        <span>{user.email ?? user.user_id}</span>
                        <code>{user.user_id}</code>
                      </div>
                    </div>
                    <div className={styles.memberStateCell}>
                      {user.user_id === currentUserId ? (
                        <span className={styles.metaChip}>
                          {t("management.users.currentLogin")}
                        </span>
                      ) : null}
                      {canManageRoles ? (
                        <label className={styles.memberRoleSelectWrap}>
                          <span className={styles.memberSelectLabel}>
                            {t("management.users.roleControlAria", {
                              name: user.name,
                            })}
                          </span>
                          <select
                            className={styles.memberRoleSelect}
                            value={user.role_id}
                            disabled={updating}
                            onChange={(event) => {
                              const nextRoleId = event.currentTarget.value as WorkspaceRoleId;
                              if (nextRoleId !== user.role_id) {
                                onRoleChange(user.user_id, nextRoleId);
                              }
                            }}
                          >
                            {visibleRoles.map((role) => (
                              <option key={role.role_id} value={role.role_id}>
                                {t(ROLE_LABEL_KEYS[role.role_id])}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span className={styles.memberRoleStatic}>
                          {t(ROLE_LABEL_KEYS[user.role_id])}
                        </span>
                      )}
                      {updating ? (
                        <span className={`${styles.metaChip} ${styles.metaChipWarning}`}>
                          {t("management.users.updatingRole")}
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
