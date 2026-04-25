import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringCompositeSessionId } from "../src/shared/authoring/session-key.ts";

test("authoring composite session id matches chat/checks contract", () => {
  assert.equal(
    buildAuthoringCompositeSessionId({
      workspaceId: " ws_default ",
      userId: " usr_alice ",
      dashboardId: " db_123 ",
      sessionId: " sess_456 ",
    }),
    "ws_default:usr_alice:db_123:sess_456",
  );
});
