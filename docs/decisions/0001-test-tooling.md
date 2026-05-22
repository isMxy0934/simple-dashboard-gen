# Decision 0001: Test Tooling

Date: 2026-05-22

## Decision

Keep `npm` as the package manager and keep Node's built-in `node:test` runner for unit and contract tests during Sprint -2 and Sprint 0.

Add Playwright as the E2E runner before Sprint 6 hardening, with the initial `test:e2e` command introduced in Sprint 0 so CI shape is visible early.

## Rationale

The repository already uses npm and `node --test --experimental-strip-types tests/*.test.ts`. Preserving this path avoids a test-runner migration before security work begins.

Node's built-in runner is sufficient for the foundation contracts in Sprint 0. Playwright is still required for browser-level auth, CSRF, and dashboard user flows, but those tests can be introduced as real E2E coverage after the foundation is stable.

## Commands

- `npm test`
- `npm run test:contract`
- `npm run test:e2e`
