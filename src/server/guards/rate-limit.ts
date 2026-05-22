import "server-only";

export async function assertRateLimit(_scope: string, _key: string): Promise<void> {
  throw new Error("NOT_IMPLEMENTED: assertRateLimit");
}
