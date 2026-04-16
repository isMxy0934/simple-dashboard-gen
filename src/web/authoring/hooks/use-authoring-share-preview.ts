"use client";

import { useCallback, useState } from "react";
import type { DashboardDocument } from "@/contracts";

export function useAuthoringSharePreview() {
  const [inlinePreview, setInlinePreview] = useState<{
    document: DashboardDocument;
    savedAt: string;
  } | null>(null);
  const [publishedShareUrl, setPublishedShareUrl] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const openInlinePreview = useCallback((document: DashboardDocument) => {
    setInlinePreview({
      document,
      savedAt: new Date().toISOString(),
    });
  }, []);

  const toggleInlinePreview = useCallback((document: DashboardDocument) => {
    setInlinePreview((current) =>
      current
        ? null
        : {
            document,
            savedAt: new Date().toISOString(),
          },
    );
  }, []);

  const closeInlinePreview = useCallback(() => {
    setInlinePreview(null);
  }, []);

  const setPublishedDashboardUrl = useCallback((url: string | null) => {
    setPublishedShareUrl(url);
    setCopiedShareLink(false);
  }, []);

  const copyPublishedShareLink = useCallback(async () => {
    if (
      !publishedShareUrl ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }

    await navigator.clipboard.writeText(publishedShareUrl);
    setCopiedShareLink(true);
  }, [publishedShareUrl]);

  return {
    inlinePreview,
    publishedShareUrl,
    copiedShareLink,
    openInlinePreview,
    toggleInlinePreview,
    closeInlinePreview,
    setPublishedDashboardUrl,
    copyPublishedShareLink,
  };
}
