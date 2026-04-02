"use client";

import type { AppLocale } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={styles.localeSwitcher}>
      <span className={styles.localeLabel}>{t("management.locale.label")}</span>
      <div className={styles.localeButtons}>
        {(["zh", "en"] as AppLocale[]).map((code) => (
          <button
            key={code}
            type="button"
            className={`${styles.localeButton} ${locale === code ? styles.localeButtonActive : ""}`}
            onClick={() => setLocale(code)}
          >
            {t(`management.locale.${code}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
