import type { DashboardDocument } from "../../../contracts";

const PREVIEW_STORAGE_PREFIX = "ai-dashboard-preview:";

interface StoredPreviewPayload {
  dashboard: DashboardDocument;
  savedAt: string;
}

export function storeDashboardPreview(document: DashboardDocument): string {
  const previewKey = `${PREVIEW_STORAGE_PREFIX}${Date.now()}`;
  const payload: StoredPreviewPayload = {
    dashboard: document,
    savedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(previewKey, JSON.stringify(payload));
  return previewKey;
}

export function loadDashboardPreview(previewKey: string): {
  dashboard: DashboardDocument;
  savedAt: string;
} | null {
  const raw = window.localStorage.getItem(previewKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredPreviewPayload;
    if (!parsed?.dashboard || !parsed?.savedAt) {
      return null;
    }

    return {
      dashboard: parsed.dashboard,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}
