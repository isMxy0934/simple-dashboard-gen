# Performance Baseline

## Baseline Commands

Run these commands before Sprint 1 starts:

```bash
npm run typecheck
npm test
npm run test:contract
```

## Initial Baseline

| Metric | Command | Baseline | Notes |
|---|---|---:|---|
| Typecheck wall time | `npm run typecheck` | measured during execution | Update with local timing before Sprint 1 |
| Unit test wall time | `npm test` | measured during execution | Current suite uses Node `node:test` |
| Contract smoke wall time | `npm run test:contract` | measured during execution | Foundation-only contract runner |
| `requireServerSession` P95 | Sprint 1 benchmark | not measured in Sprint 0 | Target P95 < 3ms after implementation |
