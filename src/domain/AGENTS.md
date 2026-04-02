# Domain Layer

`src/domain/` contains pure business rules.

Rules:

- No React.
- No `fetch`.
- No database code.
- No filesystem access.
- No Next.js types or route logic.

Put code here when it answers:

- How the dashboard behaves
- How layout is derived
- How bindings are formed
- How contract semantics are normalized or interpreted

Subareas:

- `src/domain/dashboard`: dashboard-specific rules
- `src/domain/rendering`: slot injection and runtime value semantics
- `src/domain/shared`: domain-scoped helpers
