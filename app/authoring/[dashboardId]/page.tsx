import type { Metadata } from "next";
import { AuthoringApp } from "../../../client/authoring";

export const metadata: Metadata = {
  title: "Authoring | AI Dashboard Studio",
  description: "Phase 2 authoring layout workspace.",
};

export default async function AuthoringDashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;

  return <AuthoringApp dashboardId={dashboardId} />;
}
