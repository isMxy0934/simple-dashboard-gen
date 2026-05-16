"use client";

import { useRouter } from "next/navigation";
import { clearLocalAuthSession } from "@/web/auth";
import type { AppLocale } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import { LocaleSwitcher } from "./locale-switcher";
import styles from "./management.module.css";

interface SettingsPanelProps {
  locale: AppLocale;
  verbose: boolean;
  loading: boolean;
  error: string;
  onLocaleChange: (nextLocale: AppLocale) => void;
  onToggleVerbose: (nextVerbose: boolean) => void;
}

export function SettingsPanel({
  locale,
  verbose,
  loading,
  error,
  onLocaleChange,
  onToggleVerbose,
}: SettingsPanelProps) {
  const { t } = useI18n();
  const router = useRouter();

  function handleSignOut() {
    clearLocalAuthSession();
    router.replace("/login");
  }

  return (
    <section className={styles.pageCard}>
      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.settings.title")}</h2>
          <span>{loading ? t("management.settings.loading") : t("management.settings.description")}</span>
        </div>
      </header>

      {error ? (
        <div className={`${styles.noticeBanner} ${styles.noticeBannerError}`} role="alert">
          <span className={styles.noticeMark} aria-hidden="true">
            !
          </span>
          <span className={styles.noticeBody}>
            <strong>{error}</strong>
            <span>{t("management.settings.loadFailedHint")}</span>
          </span>
        </div>
      ) : null}

      <div className={styles.settingsStack}>
        <section className={styles.settingsBlock}>
          <h3>{t("management.settings.languageControls")}</h3>
          <div className={styles.settingsChoiceRow}>
            <span>
              <strong>{t("management.settings.languagePreference")}</strong>
              <span>{t("management.settings.languagePreferenceHint")}</span>
            </span>
            <LocaleSwitcher
              locale={locale}
              disabled={loading}
              onLocaleChange={onLocaleChange}
            />
          </div>
        </section>

        <section className={styles.settingsBlock}>
          <h3>{t("management.settings.agentControls")}</h3>
          <label className={styles.settingsToggleRow}>
            <span>
              <strong>{t("management.settings.verboseTrace")}</strong>
              <span>{t("management.settings.verboseTraceHint")}</span>
            </span>
            <input
              type="checkbox"
              name="verbose-agent-trace"
              checked={verbose}
              onChange={(event) => onToggleVerbose(event.target.checked)}
            />
          </label>
          <div className={styles.settingsToggleRow}>
            <span>
              <strong>{t("management.settings.atomicPatchCommit")}</strong>
              <span>
                {t("management.settings.serverVerifiedApply")} · {t("management.common.comingSoon")}
              </span>
            </span>
            <input
              type="checkbox"
              name="atomic-patch-commit"
              readOnly
              disabled
              aria-label={t("management.settings.atomicPatchCommit")}
            />
          </div>
          <div className={styles.settingsToggleRow}>
            <span>
              <strong>{t("management.settings.streamRecovery")}</strong>
              <span>
                {t("management.settings.streamRecoveryHint")} · {t("management.common.comingSoon")}
              </span>
            </span>
            <input
              type="checkbox"
              name="stream-recovery"
              readOnly
              disabled
              aria-label={t("management.settings.streamRecovery")}
            />
          </div>
        </section>

        <section className={styles.settingsBlock}>
          <h3>{t("management.settings.accessControls")}</h3>
          <div className={styles.settingsActionRow}>
            <span>
              <strong>{t("management.settings.signOut")}</strong>
              <span>{t("management.settings.signOutHint")}</span>
            </span>
            <button
              type="button"
              className={styles.dangerAction}
              onClick={handleSignOut}
            >
              {t("management.settings.signOutAction")}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
