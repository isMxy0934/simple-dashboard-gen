import type { DashboardDocument } from "../../contracts";

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
export function dashboardDocumentPersistenceFingerprint(
  input: DashboardPersistPayload | DashboardDocument,
): string {
  const raw = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  delete raw.dashboard_id;
  return JSON.stringify(sortKeysDeep(raw));
}

/** Canonical document to persist in JSONB (no transport fields, stable key order). */
export function normalizeDashboardDocumentForStorage(
  input: DashboardPersistPayload | DashboardDocument,
): DashboardDocument {
  return JSON.parse(dashboardDocumentPersistenceFingerprint(input)) as DashboardDocument;
}
