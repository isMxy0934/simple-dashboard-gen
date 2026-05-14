import type { DashboardDocument } from "../../contracts";
import {
  reconcileDashboardDocumentContract,
  type DashboardMobileLayoutMode,
} from "./document";

/** Save/publish body may include `dashboard_id`; it is not part of the persisted document. */
export type DashboardPersistPayload = DashboardDocument & { dashboard_id?: string };

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v !== undefined) {
      sorted[key] = sortKeysDeep(v);
    }
  }
  return sorted;
}

/**
 * Stable string for "same dashboard data" checks: ignores JSON key order and strips
 * transport-only fields (e.g. `dashboard_id` on save requests).
 */
function canonicalDashboardDocumentString(
  input: DashboardPersistPayload | DashboardDocument,
): string {
  const raw = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  delete raw.dashboard_id;
  return JSON.stringify(sortKeysDeep(raw));
}

function hashStableString(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const high = (h2 >>> 0).toString(16).padStart(8, "0");
  const low = (h1 >>> 0).toString(16).padStart(8, "0");
  return `doc_${high}${low}`;
}

export function dashboardDocumentPersistenceFingerprint(
  input: DashboardPersistPayload | DashboardDocument,
): string {
  return hashStableString(canonicalDashboardDocumentString(input));
}

/** Canonical document to persist in JSONB (no transport fields, stable key order). */
export function normalizeDashboardDocumentForStorage(
  input: DashboardPersistPayload | DashboardDocument,
): DashboardDocument {
  return JSON.parse(canonicalDashboardDocumentString(input)) as DashboardDocument;
}

export function canonicalDashboardDocumentFingerprint(
  input: DashboardDocument,
  options: {
    mobileLayoutMode?: DashboardMobileLayoutMode;
  } = {},
): string {
  return dashboardDocumentPersistenceFingerprint(
    normalizeDashboardDocumentForStorage(
      reconcileDashboardDocumentContract(input, {
        mobileLayoutMode: options.mobileLayoutMode ?? "custom",
      }),
    ),
  );
}
