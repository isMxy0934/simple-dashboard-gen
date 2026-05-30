# App Layer

`src/app/` contains Next.js route entrypoints and thin page composition only.

Allowed here:

- `page.tsx`, `layout.tsx`, metadata, redirects, and route param parsing.
- Route handlers under `src/app/api`.
- Thin wiring from routes/pages to `src/web/` UI and `src/server/` services.

Do not place here:

- Persistent business logic.
- SQL, repository logic, or datasource code.
- Feature state machines.
- AI agent runtime logic.
- Dashboard document mutation logic.

Import policy:

- Prefer importing from `src/web/`, `src/server/`, `src/ai/`, `src/domain/`, and
  `src/contracts/`.
- Do not create new reusable logic directly in `src/app/`.
- API routes must call `requireApiSession` / `requireServerSession` and must not
  read `userId` or `workspaceId` from `req.json()`, request body objects, or
  `searchParams`.
- Mutating API routes must preserve CSRF and permission checks before calling
  server services.
