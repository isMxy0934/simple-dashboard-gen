# Auth Layer

`src/server/auth/` owns server-side identity, sessions, CSRF, and workspace
permission policy.

Rules:

- `requireServerSession` is the only server-side identity entrypoint.
- API routes should use session-derived `userId`, `workspaceId`, and permissions;
  never trust those values from request bodies or query params.
- Tokens must not be logged in payloads.
- Mutating routes must pass CSRF checks unless explicitly marked safe.
- Keep route handlers thin; auth implementation belongs in `src/server/auth/`.
- `WorkspacePolicy.derive` is the permission side of authoring tool visibility.
  It should stay independent from conversation-intent scope logic.
