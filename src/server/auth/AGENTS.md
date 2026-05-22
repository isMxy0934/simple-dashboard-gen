# Auth Layer

Rules:

- `requireServerSession` is the only server-side identity entrypoint.
- Tokens must not be logged in payloads.
- Mutating routes must pass CSRF checks unless explicitly marked safe.
- Keep route handlers thin; auth implementation belongs in `src/server/auth/`.
