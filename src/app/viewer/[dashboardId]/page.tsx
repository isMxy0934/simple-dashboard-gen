import type { Metadata } from "next";

import { ViewerApp } from "../../../web/viewer";

export const metadata: Metadata = {
  title: "Viewer | AI Dashboard Studio",
  description: "Published dashboard viewer for AI Dashboard Studio.",
};

export default async function ViewerDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ dashboardId: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { dashboardId } = await params;
  const { workspaceId } = await searchParams;

  return <ViewerApp dashboardId={dashboardId} workspaceId={workspaceId?.trim() || null} />;
}
