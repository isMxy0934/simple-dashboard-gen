import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const serverFetch = await import("../src/web/api/server-fetch.ts");
const i18nKeys = await import("../src/web/i18n/keys.ts");

test("web foundation stubs export expected contracts", () => {
  assert.equal(typeof serverFetch.serverFetch, "function");
  assert.equal(i18nKeys.I18N_KEYS.errorAuthoringAgentTimeout, "error.authoring.agent_timeout");
  assert.equal(i18nKeys.I18N_KEYS.errorChartRenderFailed, "error.chart.render_failed");
});

test("serverFetch sends csrf token as a header without forwarding the custom option", async () => {
  const originalFetch = globalThis.fetch;
  let receivedInit: RequestInit | undefined;

  globalThis.fetch = async (_input, init) => {
    receivedInit = init;
    return new Response(null, { status: 204 });
  };

  try {
    await serverFetch.serverFetch("http://example.test", {
      method: "POST",
      csrfToken: "secret",
      headers: { Existing: "yes" },
    });

    assert.ok(receivedInit);
    const headers = new Headers(receivedInit.headers);
    assert.equal(headers.get("X-CSRF-Token"), "secret");
    assert.equal(headers.get("Existing"), "yes");
    assert.equal(receivedInit.credentials, "include");
    assert.equal("csrfToken" in receivedInit, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
