"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  localeToHtmlLang,
  messagesByLocale,
  readStoredLocale,
  writeStoredLocale,
  type AppLocale,
  type TranslateFn,
} from "../../../shared/i18n";

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("zh");

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  const t = useMemo(() => createTranslator(locale, messagesByLocale), [locale]);

  useEffect(() => {
    document.documentElement.lang = localeToHtmlLang(locale);
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

/** Safe for SSR or outside provider: returns key as fallback. */
export function useOptionalI18n(): I18nContextValue | null {
  return useContext(I18nContext);
}
