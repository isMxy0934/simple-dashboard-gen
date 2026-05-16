import { ManagementPage } from "../web/management";
import { AuthGate } from "../web/auth";
import type { ManagementSection, ReportListTab } from "../web/management/state";

function resolveInitialSection(input: string | undefined): ManagementSection {
  return input === "reports" || input === "authoring"
    ? "reports"
    : input === "viewer"
    ? "views"
    : input === "datasources" ||
        input === "views" ||
        input === "users" ||
        input === "settings"
    ? input
    : "overview";
}

function resolveInitialReportTab(input: {
  section?: string;
  tab?: string;
}): ReportListTab {
  if (input.tab === "published" || input.tab === "viewer") {
    return "viewer";
  }

  if (input.section === "viewer" || input.section === "views") {
    return "viewer";
  }

  return "authoring";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string; tab?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthGate>
      <ManagementPage
        initialSection={resolveInitialSection(params?.section)}
        initialReportTab={resolveInitialReportTab({
          section: params?.section,
          tab: params?.tab,
        })}
      />
    </AuthGate>
  );
}
