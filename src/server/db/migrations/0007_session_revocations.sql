CREATE TABLE IF NOT EXISTS session_revocations (
  jti        text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_revocations_expires_at_idx
  ON session_revocations(expires_at);
