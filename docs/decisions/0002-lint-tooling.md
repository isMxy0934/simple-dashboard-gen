# Decision 0002: Lint Tooling

Date: 2026-05-22

## Decision

Use ESLint flat config with `eslint`, `@eslint/js`, and `typescript-eslint`.

Add a project-local custom rule in `eslint-rules/no-identity-in-request.js` to detect API route handlers reading identity fields from request body or query string.

Sprint 0 runs the rule in `warn` mode. Sprint 1 switches it to `error` after the auth migration removes legacy identity reads.

## Rationale

The migration relies on mechanical enforcement that route identity comes only from `requireServerSession`. TypeScript alone cannot enforce this route-handler policy.

Using ESLint keeps the policy close to the code and lets Sprint 0 introduce the guardrail without blocking current behavior.

## Commands

- `npm run lint`
