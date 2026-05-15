"use client";

import type { WorkspaceMember } from "@/contracts";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

interface SettingsPanelProps {
  workspaceName: string;
  users: WorkspaceMember[];
  selectedUserId: string;
  verbose: boolean;
  loading: boolean;
  error: string;
  onSelectUser: (userId: string) => void;
  onToggleVerbose: (nextVerbose: boolean) => void;
}

export function SettingsPanel({
  workspaceName,
  users,
  selectedUserId,
  verbose,
  loading,
  error,
  onSelectUser,
  onToggleVerbose,
}: SettingsPanelProps) {
  const { t } = useI18n();

  return (
    <section className={styles.pageCard}>
      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.settings.title")}</h2>
          <span>{error || (loading ? t("management.settings.loading") : t("management.settings.description"))}</span>
        </div>
        <div className={styles.chipRow}>
          <span className={styles.chip}>{t("management.settings.memberCount", { count: users.length })}</span>
          <span className={`${styles.chip} ${styles.chipPlum}`}>
            {t("management.settings.defaultTheme")}
          </span>
        </div>
      </header>

      <div className={styles.settingsGridV6}>
        <section className={styles.settingsCardV6}>
          <h3>{t("management.settings.workspace")}</h3>
          <label className={styles.settingsField}>
            <span>{t("management.settings.name")}</span>
            <input value={workspaceName} readOnly />
          </label>
          <label className={styles.settingsField}>
            <span>{t("management.settings.actingUser")}</span>
            <select
              value={selectedUserId}
              onChange={(event) => onSelectUser(event.target.value)}
            >
              {users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.toggleRowV6}>
            <span>
              <strong>{t("management.settings.requestContext")}</strong>
              <span>{t("management.settings.requestContextHint")}</span>
            </span>
            <span className={`${styles.chip} ${styles.chipTeal}`}>On</span>
          </div>
        </section>

        <section className={styles.settingsCardV6}>
          <h3>{t("management.settings.members")}</h3>
          <div className={styles.memberList}>
            {users.map((user) => (
              <article key={user.user_id} className={styles.memberRow}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.user_id}</span>
                </div>
                <span className={styles.metaChip}>
                  {user.user_id === selectedUserId
                    ? t("management.settings.current")
                    : t("management.settings.member")}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.settingsCardV6}>
          <h3>{t("management.settings.brandTheme")}</h3>
          <p>{t("management.settings.brandThemeHint")}</p>
          <div className={styles.themeSwatches} aria-hidden>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div className={styles.toggleRowV6}>
            <span>
              <strong>{t("management.settings.applyToNewReports")}</strong>
              <span>{t("management.settings.applyToNewReportsHint")}</span>
            </span>
            <span className={styles.toggleV6}></span>
          </div>
        </section>

        <section className={styles.settingsCardV6}>
          <h3>{t("management.settings.agentControls")}</h3>
          <label className={styles.toggleRowV6}>
            <span>
              <strong>{t("management.settings.verboseTrace")}</strong>
              <span>{t("management.settings.verboseTraceHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={verbose}
              onChange={(event) => onToggleVerbose(event.target.checked)}
            />
          </label>
          <div className={styles.toggleRowV6}>
            <span>
              <strong>{t("management.settings.atomicPatchCommit")}</strong>
              <span>{t("management.settings.serverVerifiedApply")}</span>
            </span>
            <span className={`${styles.chip} ${styles.chipGold}`}>{t("management.settings.next")}</span>
          </div>
          <div className={styles.toggleRowV6}>
            <span>
              <strong>{t("management.settings.streamRecovery")}</strong>
              <span>{t("management.settings.streamRecoveryHint")}</span>
            </span>
            <span className={`${styles.chip} ${styles.chipGold}`}>{t("management.settings.next")}</span>
          </div>
        </section>
      </div>
    </section>
  );
}
