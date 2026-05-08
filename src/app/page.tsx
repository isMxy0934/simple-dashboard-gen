import { ManagementPage } from "../web/management";
import type { ManagementSection } from "../web/management/state";

function resolveInitialSection(input: string | undefined): ManagementSection {
  return input === "authoring" ||
    input === "viewer" ||
    input === "datasources" ||
    input === "settings"
    ? input
    : "overview";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string }>;
}) {
  const params = await searchParams;
  return (
    <ManagementPage initialSection={resolveInitialSection(params?.section)} />
  );
}
