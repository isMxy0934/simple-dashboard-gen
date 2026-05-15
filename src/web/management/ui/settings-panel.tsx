"use client";

import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

interface SettingsPanelProps {
  verbose: boolean;
  loading: boolean;
  error: string;
  onToggleVerbose: (nextVerbose: boolean) => void;
}

export function SettingsPanel({
  verbose,
  loading,
  error,
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
      </header>

      <div className={styles.settingsGridV6}>
        <section className={styles.settingsCardV6}>
          <h3>{t("management.settings.agentControls")}</h3>
          <label className={styles.toggleRowV6}>
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
          <div className={styles.toggleRowV6}>
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
          <div className={styles.toggleRowV6}>
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
      </div>
    </section>
  );
}
