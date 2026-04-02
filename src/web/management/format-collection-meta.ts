import type { TranslateFn } from "../../shared/i18n";
import type { CollectionMeta } from "./state";

export function formatCollectionMeta(
  meta: CollectionMeta | null,
  t: TranslateFn,
): string {
  if (!meta) {
    return "";
  }
  if (meta.kind === "raw") {
    return meta.text;
  }
  return t(meta.key, meta.values);
}
