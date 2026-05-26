import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./ts-paths-loader.mjs", import.meta.url);

const authClient = await import("../src/web/auth/session-client.ts");

test("signIn surfaces invalid credential responses for the login UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status_code: 401,
        reason: "INVALID_CREDENTIALS",
        message_i18n_key: "error.auth.invalid_credentials",
        data: null,
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    await assert.rejects(
      () =>
        authClient.signIn({
          method: "account",
          identity: "alice1@example.com",
          password: "dashboard",
        }),
      (error) =>
        error instanceof authClient.AuthLoginError &&
        error.status === 401 &&
        error.reason === "INVALID_CREDENTIALS" &&
        error.messageI18nKey === "error.auth.invalid_credentials",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signIn surfaces rate limit responses for the login UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status_code: 429,
        reason: "RATE_LIMIT_LOGIN",
        message_i18n_key: "error.rate_limit.login",
        data: null,
      }),
      {
        status: 429,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    await assert.rejects(
      () =>
        authClient.signIn({
          method: "account",
          identity: "alice@example.com",
          password: "dashboard",
        }),
      (error) =>
        error instanceof authClient.AuthLoginError &&
        error.status === 429 &&
        error.reason === "RATE_LIMIT_LOGIN" &&
        error.messageI18nKey === "error.rate_limit.login",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("login page maps login failures to explicit localized status messages", async () => {
  const source = await readFile(
    new URL("../src/web/auth/ui/login-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /AuthLoginError/);
  assert.match(source, /error\.auth\.invalid_credentials/);
  assert.match(source, /error\.rate_limit\.login/);
  assert.doesNotMatch(source, /catch\s*\{\s*setSubmitting\(false\);\s*setStatusMessage\(t\("auth\.login\.description"\)\)/);
});
