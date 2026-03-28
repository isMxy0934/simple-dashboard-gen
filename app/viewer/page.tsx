import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ViewerApp } from "../../client/viewer";

export const metadata: Metadata = {
  title: "Viewer | AI Dashboard Studio",
  description: "Published dashboard viewer for AI Dashboard Studio.",
};

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ dashboardId?: string }>;
}) {
  const params = await searchParams;
  const dashboardId = params.dashboardId?.trim();

  if (dashboardId) {
    redirect(`/viewer/${encodeURIComponent(dashboardId)}`);
  }

  return <ViewerApp />;
}
