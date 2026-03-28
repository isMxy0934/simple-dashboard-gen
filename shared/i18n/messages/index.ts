import type { AppLocale } from "../types";
import type { MessageTree } from "../types";
import { enMessages } from "./en";
import { zhMessages } from "./zh";

export const messagesByLocale: Record<AppLocale, MessageTree> = {
  en: enMessages,
  zh: zhMessages,
};
