# Architecture Guide

This repository is organized by architectural layer:

- `app/`: Next.js entrypoints only
- `client/`: frontend product features
- `server/`: server-only logic and persistence/runtime services
- `components/`: reusable UI components shared across client features
- `ai/`: agent, workflow, prompt, runtime, and model-facing logic
- `domain/`: pure business rules
- `contracts/`: shared contracts, schema, types, and validation
- `shared/`: generic helpers with no product ownership

Global rules:

- Keep `app/` thin. Route files should wire existing modules together, not implement business logic.
- Keep `client/` feature-scoped. Place feature UI inside `client/<feature>/ui`.
- Keep `server/` free of React and browser APIs.
- Keep `domain/` pure. No React, `fetch`, filesystem, database, or Next.js code.
- Keep `contracts/` declarative. No feature logic or runtime side effects.
- Keep `components/` reusable. Do not place feature-specific flows here.
- Keep `shared/` generic. If a helper clearly belongs to one layer, move it there.

Dependency direction:

- `app -> client/components/server/ai/domain/contracts/shared`
- `client -> components/domain/contracts/shared`
- `components -> domain/contracts/shared`
- `server -> ai/domain/contracts/shared`
- `ai -> domain/contracts/shared`
- `domain -> contracts/shared`
- `contracts -> shared`
- `shared -> (no higher-level product code)`

Forbidden dependencies:

- `domain -> client/app/server/components`
- `contracts -> client/app/server/domain/components/ai`
- `server -> client/components/app`
- `ai -> client/components/app`
- `components -> server/app/ai`

When in doubt:

- If it defines data shape, put it in `contracts/`.
- If it defines business behavior, put it in `domain/`.
- If it talks to the browser, put it in `client/`.
- If it talks to the database or filesystem, put it in `server/`.
- If it is prompt/workflow/tool/model logic, put it in `ai/`.
