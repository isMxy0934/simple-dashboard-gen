export type { AppLocale, MessageTree, TranslateFn } from "./types";
export {
  createTranslator,
  readStoredLocale,
  writeStoredLocale,
  localeToHtmlLang,
} from "./create-translator";
export { messagesByLocale } from "./messages";
