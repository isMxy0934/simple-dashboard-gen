# Auth0-ready Migration Completion Design

Date: 2026-05-23

## Purpose

Complete the migration finalization work without prematurely integrating Auth0. The current product is single workspace, and the current login route is a temporary auth scaffold. The target for this pass is to make the architecture honest, make the protected API boundary consistent, and leave a narrow provider seam where Auth0 can replace the mock session source later.

## Decisions

### Single workspace

The product does not currently support multi-tenant workspace behavior. `workspaceId` remains in contracts and storage as an internal namespace, with `ws_default` as the active workspace. Documentation should stop claiming cross-workspace behavior as a current product goal.

Current code may keep workspace-scoped repository signatures because they protect internal data access and preserve an expansion point. The acceptance criteria should be reframed from "cross-workspace isolation" to "all persisted data uses the default workspace namespace consistently".

### Auth scaffold now, Auth0 later

Current `/api/auth/login` remains a mock login route for development and local E2E. It issues an HTTP-only `sds_session` cookie and grants the local default user's permissions, but it does not validate real credentials.

The target design is Auth0-ready:

- `requireServerSession(request)` stays the only identity entry point for protected server routes.
- Business routes must not know whether identity came from mock JWT or Auth0.
- Auth provider-specific logic belongs behind a small server-side adapter, not inside dashboard, datasource, authoring, or query routes.
- Future Auth0 integration will replace the session source and user-claims mapping while preserving the existing `UserSession` shape.

Documentation should describe Auth0 as planned follow-up work, not a completed migration requirement.

### Protected API order

Protected API handlers must authenticate and authorize before parsing request bodies. This gives stable failure semantics:

- Missing or invalid session returns 401 before body validation.
- CSRF failures on mutating routes return 403 before body validation.
- Permission failures return 403 before body validation.
- Malformed JSON returns 400 only after the request has passed the auth boundary.

Auth-exempt routes are limited to the mock login and refresh entry points. Logout must still validate CSRF and the session token before revocation.

### Lint final gate

The custom `sds/no-identity-in-request` ESLint rule is a final gate and should run in `error` mode. It prevents API routes from reading `userId`, `workspaceId`, `user_id`, or `workspace_id` from request bodies or query strings.

### Contract test gate

The contract test suite must stop being a runner-only smoke test. It should include real migration contract coverage for:

- `DashboardDocument.schema_version` remains required at the top level.
- Legacy `dashboard_spec.schema_version` remains `"0.3"` during v1.0.
- API route lint config keeps `sds/no-identity-in-request` at `error`.
- Protected mutating routes authenticate before parsing JSON.
- Execute-batch derives workspace identity from the server session boundary, not request body identity fields.

These contract tests do not need to duplicate all integration tests. Their job is to keep the migration invariants from regressing.

### E2E and acceptance honesty

The checked-in E2E suite currently validates foundational auth/session/CSRF behavior. It does not yet prove every migration.md manual claim, such as full dashboard create-publish flow or all failure-mode UI degradation paths.

The docs should distinguish:

- Completed automated acceptance that is actually covered by local tests and E2E.
- Operational/manual acceptance that must be run before release.
- Planned Auth0 acceptance that will be added when Auth0 is integrated.

## Architecture

### Auth provider boundary

Keep the current public server contract:

```ts
export async function requireServerSession(
  request: Request,
  opts?: { skipCsrf?: boolean },
): Promise<UserSession>;
```

Internally, the implementation can later delegate to an auth provider:

```ts
type AuthProvider = {
  readSession(request: Request): Promise<UserSession | null>;
  refreshSession?(request: Request): Promise<Response>;
};
```

For this pass, the provider remains mock-cookie/JWT based. For Auth0, `readSession` will validate Auth0 session state, map Auth0 user claims to the local default workspace, and return the same `UserSession` structure.

### Single-workspace identity mapping

Auth0 users will map into:

- `workspaceId: "ws_default"`
- app permissions derived from local policy, Auth0 roles, or a static default during the first Auth0 integration pass
- stable `userId` derived from Auth0 subject or a local user mapping table

No current route should depend on user-provided workspace identity.

### Route handler pattern

Protected mutating routes should follow this structure:

```ts
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    const payload = await readJsonPayload(request);
    return runServiceWithSession(payload, session);
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
```

`readJsonPayload` may remain local or be a shared helper. The key invariant is that auth precedes body parsing.

## Testing

### Unit and integration tests

Add tests for representative protected routes where malformed unauthenticated JSON must return 401 rather than 400. This is the most direct proof that auth happens before body parsing.

Keep existing JWT, CSRF, revocation, quota, schema, and render tests.

### Contract tests

Add focused tests under `tests-contract/` for migration invariants. The suite should fail if:

- the lint rule is downgraded from error,
- top-level `DashboardDocument.schema_version` stops being required,
- route source reintroduces parsing-before-auth for protected mutating routes,
- execute-batch accepts client-supplied identity fields as authoritative.

### E2E

Keep the existing mock login E2E. Do not add Auth0 browser login E2E until Auth0 is actually integrated. When Auth0 integration happens, CI will need a separate strategy for Auth0 test credentials or an Auth0-mocked session setup.

## Documentation Updates

Update `docs/architecture.md` and `docs/migration.md` to:

- describe the current auth state as mock scaffold / Auth0-ready, not completed real credential auth,
- mark Auth0 integration as planned follow-up,
- remove multi-tenant workspace claims from current goals,
- state that `ws_default` is the single active workspace namespace,
- correct final acceptance language so checked boxes only represent verified code-level acceptance.

## Non-goals

This pass will not:

- install or configure Auth0 packages,
- create Auth0 tenant/client configuration,
- implement OAuth callback handling,
- introduce multi-workspace tenancy,
- change dashboard or datasource product behavior beyond auth-boundary consistency.

## Acceptance Criteria

- Protected mutating API routes authenticate before body parsing.
- `sds/no-identity-in-request` is configured as an ESLint error.
- Contract tests include real migration invariants, not only runner smoke coverage.
- E2E passes with the current mock login flow.
- `architecture.md` and `migration.md` clearly describe single workspace and Auth0-ready scaffold status.
- Existing verification commands pass: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm test`, `npm run test:contract -- --coverage`, `npm run script:check-env`, `npm run script:check-i18n`, `npm run build`, and `CI=1 npm run test:e2e -- --reporter=line`.
