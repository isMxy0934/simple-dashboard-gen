/** UUID v4 via Web Crypto when available (browser + Node 18+); safe for SSR. */
export function randomUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
