import type { Metadata } from "next";

import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";
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
  const resolvedWorkspaceId = workspaceId?.trim() || DEFAULT_WORKSPACE_ID;

  return <ViewerApp dashboardId={dashboardId} workspaceId={resolvedWorkspaceId} />;
}
