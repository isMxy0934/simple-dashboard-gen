export interface ServerFetchOptions extends RequestInit {
  csrfToken?: string;
}

export async function serverFetch(input: string | URL, init: ServerFetchOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.csrfToken) {
    headers.set("X-CSRF-Token", init.csrfToken);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
}
