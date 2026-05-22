# Failure Modes Audit

## Scope

This file maps current implementation behavior to the failure matrix in `docs/architecture.md`.

## Current Findings

| Failure | Current implementation location | Current behavior | Target behavior | Sprint |
|---|---|---|---|---|
| Auth missing or expired | Route helpers call `requireServerSession` / `requireApiSession` | Missing, expired, tampered, or revoked cookies are rejected before route logic runs | Return 401 with stable auth error code and no body/query identity fallback | 1 |
| CSRF invalid origin | Not centralized | No global mutating-route check | `requireServerSession` rejects with 403 `CSRF_INVALID_ORIGIN` | 1 |
| Provider auth missing | `src/ai/providers/pi-model-runtime.ts` | Runtime resolution rejects missing provider auth | Keep runtime rejection, document provider auth passthrough | 0 |
| Agent stream timeout | `src/ai/authoring/agent/session.ts` | Existing timeout handling is implementation-specific | 60s timeout emits stable event and UI retry state | 3 |
| Chart render failure | Renderer/browser chart components | Current behavior varies by renderer path | Per-view error placeholder without failing whole dashboard | 3 |

## Follow-up

Sprint 3 expands this file into one row per architecture failure-matrix item and adds exact tests.
