export type AppLocale = "en" | "zh";

/** Recursive message map; interface avoids TS2456 circular type-alias issue. */
export interface MessageTree {
  [key: string]: string | MessageTree;
}

export type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;
