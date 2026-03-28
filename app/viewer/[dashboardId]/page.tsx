import type { Metadata } from "next";

import { ViewerApp } from "../../../client/viewer";

export const metadata: Metadata = {
  title: "Viewer | AI Dashboard Studio",
  description: "Published dashboard viewer for AI Dashboard Studio.",
};

export default async function ViewerDashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;

  return <ViewerApp dashboardId={dashboardId} />;
}
