"use client";

import type { AppLocale } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";

interface LocaleSwitcherProps {
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  disabled?: boolean;
}

export function LocaleSwitcher({
  locale,
  onLocaleChange,
  disabled = false,
}: LocaleSwitcherProps) {
  const { t } = useI18n();

  return (
    <div className={styles.localeSwitcher} role="group" aria-label={t("management.locale.label")}>
      <div className={styles.localeButtons}>
        {(["zh", "en"] as AppLocale[]).map((code) => (
          <button
            key={code}
            type="button"
            className={`${styles.localeButton} ${locale === code ? styles.localeButtonActive : ""}`}
            aria-pressed={locale === code}
            disabled={disabled}
            onClick={() => onLocaleChange(code)}
          >
            {t(`management.locale.${code}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
