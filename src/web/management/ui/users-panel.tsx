"use client";

import type { WorkspaceMember } from "@/contracts";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

interface UsersPanelProps {
  users: WorkspaceMember[];
  selectedUserId: string;
  loading: boolean;
  error: string;
  onSelectUser: (userId: string) => void;
}

export function UsersPanel({
  users,
  selectedUserId,
  loading,
  error,
  onSelectUser,
}: UsersPanelProps) {
  const { t } = useI18n();
  const statusText = error || (loading ? t("management.users.loading") : t("management.users.description"));

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
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.user_id}</span>
                  </div>
                  {user.user_id === selectedUserId ? (
                    <span className={styles.metaChip}>
                      {t("management.settings.current")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => onSelectUser(user.user_id)}
                    >
                      {t("management.users.useAsCurrent")}
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
        </section>

        <aside className={styles.pageSubPanel} aria-labelledby="roles-heading">
          <div className={styles.panelHeading}>
            <h3 id="roles-heading">{t("management.users.roles")}</h3>
            <span className={`${styles.metaChip} ${styles.metaChipWarning}`}>
              {t("management.common.comingSoon")}
            </span>
          </div>
          <div className={styles.disabledFeatureList}>
            <button type="button" className={styles.disabledFeature} disabled>
              <strong>{t("management.users.adminRole")}</strong>
              <span>{t("management.users.adminRoleHint")}</span>
            </button>
            <button type="button" className={styles.disabledFeature} disabled>
              <strong>{t("management.users.builderRole")}</strong>
              <span>{t("management.users.builderRoleHint")}</span>
            </button>
            <button type="button" className={styles.disabledFeature} disabled>
              <strong>{t("management.users.viewerRole")}</strong>
              <span>{t("management.users.viewerRoleHint")}</span>
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
