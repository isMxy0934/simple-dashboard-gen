# App Layer

`src/app/` contains Next.js route entrypoints only.

Allowed here:

- `page.tsx`, `layout.tsx`, metadata
- Route handlers under `src/app/api`
- Route param parsing
- Redirects and thin composition

Do not place here:

- Persistent business logic
- SQL, repository logic, or data-source code
- Feature state machines
- AI workflow logic

Import policy:

- Prefer importing from `src/web/`, `src/server/`, `src/agent/`, `src/domain/`, and `src/contracts/`
- Do not create new reusable logic directly in `src/app/`
