# Domain Layer

`domain/` contains pure business rules.

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
- How rendering options are transformed

Subareas:

- `domain/dashboard`: dashboard-specific rules
- `domain/rendering`: rendering and option-template transformations
- `domain/shared`: domain-scoped helpers
