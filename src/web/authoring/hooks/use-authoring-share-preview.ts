"use client";

import { useCallback, useState } from "react";

export function useAuthoringSharePreview() {
  const [publishedShareUrl, setPublishedShareUrl] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

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
    publishedShareUrl,
    copiedShareLink,
    setPublishedDashboardUrl,
    copyPublishedShareLink,
  };
}
