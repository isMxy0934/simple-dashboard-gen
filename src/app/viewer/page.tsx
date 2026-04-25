import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ViewerApp } from "../../web/viewer";

export const metadata: Metadata = {
  title: "Viewer | AI Dashboard Studio",
  description: "Published dashboard viewer for AI Dashboard Studio.",
};

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ dashboardId?: string; workspaceId?: string }>;
}) {
  const params = await searchParams;
  const dashboardId = params.dashboardId?.trim();
  const workspaceId = params.workspaceId?.trim();

  if (dashboardId) {
    const suffix = workspaceId
      ? `?workspaceId=${encodeURIComponent(workspaceId)}`
      : "";
    redirect(`/viewer/${encodeURIComponent(dashboardId)}${suffix}`);
  }

  return <ViewerApp />;
}
