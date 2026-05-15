import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Edit Report | Hermes Reports",
  description: "Independent report authoring workspace.",
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

  redirect("/?section=reports&tab=drafts");
}
