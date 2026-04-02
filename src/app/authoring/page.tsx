import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createDashboard } from "../../server/dashboards/repository";

export const metadata: Metadata = {
  title: "Authoring | AI Dashboard Studio",
  description: "Phase 2 authoring layout workspace.",
};

export default async function AuthoringPage({
  searchParams,
}: {
  searchParams: Promise<{ dashboardId?: string }>;
}) {
  const params = await searchParams;
  const dashboardId = params.dashboardId?.trim();

  if (dashboardId) {
    redirect(`/authoring/${encodeURIComponent(dashboardId)}`);
  }

  try {
    const snapshot = await createDashboard();
    redirect(`/authoring/${encodeURIComponent(snapshot.dashboard_id)}`);
  } catch {
    redirect("/authoring/create-failed");
  }
}
