import type { Metadata } from "next";
import { AuthoringApp } from "../../../web/authoring";

export const metadata: Metadata = {
  title: "Edit Report | Mercaso Reports",
  description: "Independent report authoring workspace.",
};

export default async function AuthoringDashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;

  return <AuthoringApp dashboardId={dashboardId} />;
}
