import type { Metadata } from "next";

import { ViewerApp } from "../../../web/viewer";

export const metadata: Metadata = {
  title: "Report Viewer | Hermes Reports",
  description: "Published report viewer for Hermes Reports.",
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
