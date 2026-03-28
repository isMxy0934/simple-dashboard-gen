# Shared Layer

`shared/` contains generic helpers with no product ownership.

Rules:

- Keep utilities small and broadly reusable.
- If a helper clearly belongs to one layer, move it to that layer.
- Do not let `shared/` become a dumping ground.

Good fits:

- time formatting
- generic result helpers
- string or object helpers with no dashboard-specific meaning
