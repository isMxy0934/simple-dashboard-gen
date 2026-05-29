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
- Do not import from `src/web/`, `src/server/`, `src/ai/`, or `src/domain/`.

Use `src/contracts/` for data shape.
Use `src/domain/` for business behavior.

Dashboard template contract rules:

- `dashboard-templates.ts` owns canonical template ids, versions, bootstrap defaults,
  and registered template definitions.
- `dashboard-template-capability-registry.ts` owns the template -> semantic view kind
  -> renderer recipe/view family policy.
- `dashboard-view-policy.ts` may expose compatibility helpers, but new code should
  prefer template-named APIs.
- Keep legacy presentation/design-kit aliases isolated to explicit normalization
  helpers. Do not introduce new "design kit" policy names for template-owned behavior.
