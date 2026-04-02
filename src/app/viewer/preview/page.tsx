import type { Metadata } from "next";

import { PreviewViewerApp } from "../../../web/viewer";

export const metadata: Metadata = {
  title: "Draft Preview | AI Dashboard Studio",
  description: "Full-page draft preview for AI Dashboard Studio.",
};

export default async function ViewerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ previewKey?: string }>;
}) {
  const params = await searchParams;

  return <PreviewViewerApp previewKey={params.previewKey ?? null} />;
}
