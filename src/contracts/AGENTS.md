# Contracts Layer

`src/contracts/` contains shared data shape definitions.

Allowed here:

- Types
- Schema definitions
- Validation
- Request and response contracts

Rules:

- Keep files declarative.
- Do not place feature logic here.
- Do not place persistence code here.
- Do not import from `src/web/`, `src/server/`, `src/agent/`, `src/provider/`, or `src/domain/`.

Use `src/contracts/` for data shape.
Use `src/domain/` for business behavior.
