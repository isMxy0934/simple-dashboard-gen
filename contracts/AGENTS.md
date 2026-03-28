# Contracts Layer

`contracts/` contains shared data shape definitions.

Allowed here:

- Types
- Schema definitions
- Validation
- Request and response contracts

Rules:

- Keep files declarative.
- Do not place feature logic here.
- Do not place persistence code here.
- Do not import from `client/`, `server/`, `ai/`, `domain/`, or `components/`.

Use `contracts/` for data shape.
Use `domain/` for business behavior.
