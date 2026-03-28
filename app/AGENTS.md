# App Layer

`app/` contains Next.js route entrypoints only.

Allowed here:

- `page.tsx`, `layout.tsx`, metadata
- Route handlers under `app/api`
- Route param parsing
- Redirects and thin composition

Do not place here:

- Persistent business logic
- SQL, repository logic, or data-source code
- Feature state machines
- AI workflow logic

Import policy:

- Prefer importing from `client/`, `server/`, `components/`, `ai/`, `domain/`, `contracts/`, and `shared/`
- Do not create new reusable logic directly in `app/`
