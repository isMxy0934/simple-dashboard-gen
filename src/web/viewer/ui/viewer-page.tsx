import type { Metadata } from "next";

import { ViewerApp } from "./viewer-app";
import { PreviewViewerApp } from "./preview-viewer-app";

export const viewerMetadata: Metadata = {
  title: "Viewer | Report OS",
  description: "Published report viewer for Report OS.",
};

export const previewViewerMetadata: Metadata = {
  title: "Draft Preview | Report OS",
  description: "Full-page draft preview for Report OS.",
};

export function ViewerPage() {
  return <ViewerApp />;
}

export function ViewerDashboardPage({ dashboardId }: { dashboardId: string }) {
  return <ViewerApp dashboardId={dashboardId} />;
}

export function ViewerPreviewPage({ previewKey }: { previewKey: string | null }) {
  return <PreviewViewerApp previewKey={previewKey} />;
}
