import type { Metadata } from "next";

import { ViewerApp } from "./viewer-app";
import { PreviewViewerApp } from "./preview-viewer-app";

export const viewerMetadata: Metadata = {
  title: "Viewer | AI Dashboard Studio",
  description: "Published dashboard viewer for AI Dashboard Studio.",
};

export const previewViewerMetadata: Metadata = {
  title: "Draft Preview | AI Dashboard Studio",
  description: "Full-page draft preview for AI Dashboard Studio.",
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
