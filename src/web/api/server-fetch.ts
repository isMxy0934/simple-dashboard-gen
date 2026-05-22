export interface ServerFetchOptions extends RequestInit {
  csrfToken?: string;
}

export async function serverFetch(input: string | URL, init: ServerFetchOptions = {}): Promise<Response> {
  const { csrfToken, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(input, {
    ...fetchInit,
    headers,
    credentials: "include",
  });
}
