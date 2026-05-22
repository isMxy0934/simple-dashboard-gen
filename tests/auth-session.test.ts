import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const jwt = await import("../src/server/auth/jwt.ts");
const requireSession = await import("../src/server/auth/require-session.ts");
const csrf = await import("../src/server/auth/csrf.ts");
const permissions = await import("../src/server/auth/permissions.ts");
const { ApiError } = await import("../src/server/api-error.ts");

const previousEnv = {
  SDS_SESSION_SECRETS: process.env.SDS_SESSION_SECRETS,
  SDS_SESSION_TTL_DAYS: process.env.SDS_SESSION_TTL_DAYS,
  SDS_ALLOWED_ORIGINS: process.env.SDS_ALLOWED_ORIGINS,
};

function installAuthEnv() {
  process.env.SDS_SESSION_SECRETS = JSON.stringify({
    current: {
      kid: "k1",
      secret: "abcdefghijklmnopqrstuvwxyz123456",
    },
    previous: [
      {
        kid: "k0",
        secret: "0123456789abcdefghijklmnopqrstuvwxyz",
      },
    ],
  });
  process.env.SDS_SESSION_TTL_DAYS = "7";
  process.env.SDS_ALLOWED_ORIGINS = "https://allowed.example";
}

function restoreAuthEnv() {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("signSessionToken creates an HS256 token that verifySessionToken validates", async () => {
  installAuthEnv();
  try {
    const token = await jwt.signSessionToken({
      userId: "usr_alice",
      workspaceId: "ws_default",
      permissions: [
        permissions.Permission.DashboardRead,
        permissions.Permission.DashboardEdit,
      ],
    });

    const claims = await jwt.verifySessionToken(token);

    assert.equal(claims.userId, "usr_alice");
    assert.equal(claims.workspaceId, "ws_default");
    assert.deepEqual(claims.permissions, [
      permissions.Permission.DashboardRead,
      permissions.Permission.DashboardEdit,
    ]);
    assert.equal(typeof claims.jti, "string");
    assert.equal(claims.exp - claims.iat, 7 * 24 * 60 * 60);
  } finally {
    restoreAuthEnv();
  }
});

test("verifySessionToken rejects tampered tokens", async () => {
  installAuthEnv();
  try {
    const token = await jwt.signSessionToken({
      userId: "usr_alice",
      workspaceId: "ws_default",
      permissions: [permissions.Permission.DashboardRead],
    });
    const tampered = `${token.slice(0, -1)}x`;

    await assert.rejects(() => jwt.verifySessionToken(tampered), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "INVALID_SESSION");
      return true;
    });
  } finally {
    restoreAuthEnv();
  }
});

test("requireServerSession reads the http-only session cookie and enforces CSRF on mutating requests", async () => {
  installAuthEnv();
  try {
    const token = await jwt.signSessionToken({
      userId: "usr_alice",
      workspaceId: "ws_default",
      permissions: [permissions.Permission.DashboardRead],
    });
    const request = new Request("https://app.example/api/dashboards", {
      method: "POST",
      headers: {
        cookie: `sds_session=${token}`,
        origin: "https://app.example",
      },
    });

    const session = await requireSession.requireServerSession(request);

    assert.equal(session.userId, "usr_alice");
    assert.equal(session.workspaceId, "ws_default");
    assert.equal(session.permissions.has(permissions.Permission.DashboardRead), true);
    assert.equal(typeof session.requestId, "string");

    await assert.rejects(
      () =>
        requireSession.requireServerSession(
          new Request("https://app.example/api/dashboards", {
            method: "POST",
            headers: {
              cookie: `sds_session=${token}`,
              origin: "https://evil.example",
            },
          }),
        ),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "CSRF_ORIGIN_DENIED");
        return true;
      },
    );
  } finally {
    restoreAuthEnv();
  }
});

test("assertCsrf accepts configured origins and rejects token mismatches", () => {
  installAuthEnv();
  try {
    assert.doesNotThrow(() =>
      csrf.assertCsrf(
        new Request("https://app.example/api/dashboards", {
          method: "POST",
          headers: { origin: "https://allowed.example" },
        }),
      ),
    );

    assert.throws(
      () =>
        csrf.assertCsrf(
          new Request("https://app.example/api/dashboards", {
            method: "POST",
            headers: {
              origin: "https://app.example",
              cookie: "sds_csrf=expected",
              "x-csrf-token": "actual",
            },
          }),
        ),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "CSRF_TOKEN_MISMATCH");
        return true;
      },
    );
  } finally {
    restoreAuthEnv();
  }
});
