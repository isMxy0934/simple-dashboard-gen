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
