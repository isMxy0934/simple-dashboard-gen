import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ViewerApp } from "../../web/viewer";

export const metadata: Metadata = {
  title: "Report Viewer | Hermes Reports",
  description: "Published report viewer for Hermes Reports.",
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
