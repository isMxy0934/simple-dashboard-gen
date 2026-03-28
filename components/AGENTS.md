# Components Layer

`components/` is reserved for reusable UI shared across client features.

Rules:

- Keep components presentation-oriented.
- Accept typed props and delegate feature behavior back to callers.
- Do not place feature-specific flows here.
- Do not place server-only code here.
- If a component is only used by one feature, keep it in `client/<feature>/ui`.
