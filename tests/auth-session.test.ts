import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const jwt = await import("../src/server/auth/jwt.ts");
const requireSession = await import("../src/server/auth/require-session.ts");
const revocations = await import("../src/server/auth/session-revocations.ts");
const csrf = await import("../src/server/auth/csrf.ts");
const permissions = await import("../src/server/auth/permissions.ts");
const refreshRoute = await import("../src/app/api/auth/refresh/route.ts");
const { ApiError } = await import("../src/server/api-error.ts");

const previousEnv = {
  SDS_SESSION_SECRETS: process.env.SDS_SESSION_SECRETS,
  SDS_SESSION_TTL_DAYS: process.env.SDS_SESSION_TTL_DAYS,
  SDS_ALLOWED_ORIGINS: process.env.SDS_ALLOWED_ORIGINS,
};

function withFrozenNow<T>(nowMs: number, fn: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Date.now = originalNow;
    });
}

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

test("verifySessionToken supports refresh grace without accepting expired sessions normally", async () => {
  installAuthEnv();
  try {
    const issuedAtMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const token = await withFrozenNow(issuedAtMs, () =>
      jwt.signSessionToken({
        userId: "usr_alice",
        workspaceId: "ws_default",
        permissions: [permissions.Permission.DashboardRead],
      }),
    );

    const expiredWithinGraceMs = issuedAtMs + 7 * 24 * 60 * 60 * 1000 + 60_000;
    await withFrozenNow(expiredWithinGraceMs, async () => {
      await assert.rejects(() => jwt.verifySessionToken(token), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.code, "SESSION_EXPIRED");
        return true;
      });

      const claims = await jwt.verifySessionToken(token, {
        allowExpiredWithinGraceSeconds: 24 * 60 * 60,
      });
      assert.equal(claims.userId, "usr_alice");
    });
  } finally {
    restoreAuthEnv();
  }
});

test("session revocation repository records and rejects revoked jtis", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("select jti")) {
        return { rows: [{ jti: "jti-revoked" }] };
      }
      return { rows: [] };
    },
  };

  await revocations.revokeSessionJti(
    { jti: "jti-revoked", expiresAt: 1_800_000_000 },
    { pool },
  );
  revocations.resetSessionRevocationCacheForTests();
  await assert.rejects(
    () => revocations.assertSessionNotRevoked("jti-revoked", { pool }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "SESSION_REVOKED");
      return true;
    },
  );

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /insert into session_revocations/i);
  assert.deepEqual(queries[0].params, [
    "jti-revoked",
    new Date(1_800_000_000 * 1000),
  ]);
});

test("session revocation repository prepares schema before querying the default database", async () => {
  const source = await readFile(
    new URL("../src/server/auth/session-revocations.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /ensureCloudAuthoringSchema/);
  assert.match(
    source,
    /await ensureSessionRevocationStoreReady\(options\);[\s\S]*select jti/,
  );
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

test("POST /api/auth/refresh accepts an expired token inside grace and sets a new cookie", async () => {
  installAuthEnv();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const issuedAtMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const token = await withFrozenNow(issuedAtMs, () =>
      jwt.signSessionToken({
        userId: "usr_alice",
        workspaceId: "ws_default",
        permissions: [permissions.Permission.DashboardRead],
      }),
    );

    const expiredWithinGraceMs = issuedAtMs + 7 * 24 * 60 * 60 * 1000 + 60_000;
    const response = await withFrozenNow(expiredWithinGraceMs, () =>
      refreshRoute.POST(
        new Request("https://app.example/api/auth/refresh", {
          method: "POST",
          headers: {
            cookie: `sds_session=${token}`,
            origin: "https://app.example",
          },
        }),
      ),
    );

    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /sds_session=/);
    assert.match(setCookie, /HttpOnly/);
    const body = await response.json();
    assert.equal(body.reason, "OK");
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
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
