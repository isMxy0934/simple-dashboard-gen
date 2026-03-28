import type { AppLocale, MessageTree, TranslateFn } from "./types";

const STORAGE_KEY = "app-locale";

export function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") {
    return "zh";
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "en" || raw === "zh" ? raw : "zh";
}

export function writeStoredLocale(locale: AppLocale) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, locale);
}

export function localeToHtmlLang(locale: AppLocale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

function getLeaf(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = tree;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as MessageTree)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, values?: Record<string, string | number>) {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : `{${name}}`,
  );
}

export function createTranslator(
  locale: AppLocale,
  trees: Record<AppLocale, MessageTree>,
): TranslateFn {
  const tree = trees[locale] ?? trees.en;

  return (key: string, values?: Record<string, string | number>) => {
    const raw = getLeaf(tree, key);
    if (raw === undefined) {
      const fallback = getLeaf(trees.en, key);
      if (fallback !== undefined) {
        return interpolate(fallback, values);
      }
      return key;
    }
    return interpolate(raw, values);
  };
}
