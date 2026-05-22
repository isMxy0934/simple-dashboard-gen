import { expect, test } from "@playwright/test";

function localAppOrigin(baseURL?: string): string {
  const url = new URL(baseURL ?? "http://localhost:3000");
  if (url.hostname === "127.0.0.1") {
    url.hostname = "localhost";
  }
  return url.origin;
}

function apiUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString();
}

test("unauthenticated protected APIs reject requests", async ({ request }) => {
  const response = await request.get("/api/dashboards");
  expect(response.status()).toBe(401);
  const payload = await response.json();
  expect(payload.reason).toBe("AUTH_REQUIRED");
});

test("login session read refresh and logout use http-only cookie flow", async ({ request, baseURL }) => {
  const origin = localAppOrigin(baseURL);
  const login = await request.post(apiUrl(origin, "/api/auth/login"), {
    headers: {
      origin,
      "content-type": "application/json",
    },
    data: {
      method: "account",
      identity: "alice@example.com",
      password: "local-dev",
    },
  });
  expect(login.status()).toBe(200);

  const session = await request.get(apiUrl(origin, "/api/auth/session"));
  expect(session.status()).toBe(200);
  const sessionPayload = await session.json();
  expect(sessionPayload.data.workspace_id).toBe("ws_default");
  expect(sessionPayload.data.permissions).toContain("dashboard.read");

  const refresh = await request.post(apiUrl(origin, "/api/auth/refresh"), {
    headers: { origin },
  });
  expect(refresh.status()).toBe(200);

  const logout = await request.post(apiUrl(origin, "/api/auth/logout"), {
    headers: { origin },
  });
  expect(logout.status()).toBe(200);

  const afterLogout = await request.get(apiUrl(origin, "/api/auth/session"));
  expect(afterLogout.status()).toBe(401);
});

test("cross-site mutating request is denied by CSRF origin policy", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    headers: {
      origin: "https://attacker.example",
      "content-type": "application/json",
    },
    data: {
      method: "account",
      identity: "alice@example.com",
      password: "local-dev",
    },
  });

  expect(response.status()).toBe(403);
  const payload = await response.json();
  expect(payload.reason).toBe("CSRF_ORIGIN_DENIED");
});
