import type { Metadata } from "next";

import { PreviewViewerApp } from "../../../web/viewer";

export const metadata: Metadata = {
  title: "Report Preview | Mercaso Reports",
  description: "Full-page draft preview for Mercaso Reports.",
};

export default async function ViewerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ previewKey?: string }>;
}) {
  const params = await searchParams;

  return <PreviewViewerApp previewKey={params.previewKey ?? null} />;
}
