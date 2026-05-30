# System Architecture Overview

This is the short architecture map for AI Dashboard Studio. It is meant to be
read before `docs/architecture.md`.

## 1. Overall Flow

The system is reasonable mainly because it has one central product contract:
`DashboardDocument = DashboardSpec + QueryDefs + Bindings`. Authoring, checks,
execution, save/publish, and viewer rendering all converge on that contract.

```mermaid
flowchart LR
  User["User"]
  Browser["Browser UI\nManagement / Authoring / Viewer"]
  Routes["Next.js API Routes\nsrc/app/api"]
  Auth["Auth + Permission\nrequireServerSession\nWorkspacePolicy"]
  Server["Server Services\nsrc/server"]
  Agent["AI Authoring Runtime\nscope + surface + tools"]
  Draft["WorkingDraft"]
  Approval["Approval\ncomposePatch -> applyPatch"]
  Doc["DashboardDocument\nDashboardSpec + QueryDefs + Bindings"]
  Store["PostgreSQL\nmetadata + drafts + published"]
  Exec["Execution Service\nexecute-batch"]
  Source["Datasources\nPostgres / Athena"]
  Render["Rendering Runtime\nrecipes + materialize + ECharts"]

  User --> Browser
  Browser --> Routes
  Routes --> Auth
  Auth --> Server

  Server --> Agent
  Agent --> Draft
  Draft --> Approval
  Approval --> Doc
  Doc --> Store

  Browser --> Exec
  Server --> Exec
  Exec --> Doc
  Exec --> Source
  Exec --> Render
  Render --> Browser

  Store --> Server
  Store --> Exec
```

### Main Runtime Loops

```mermaid
flowchart TB
  subgraph Authoring["Authoring Flow"]
    A1["User asks for dashboard change"]
    A2["POST /api/authoring/chat"]
    A3["require session + permission + rate limit"]
    A4["load dashboard + chat session snapshot"]
    A5["computeAuthoringScope"]
    A6["resolveRuntimeToolSurface"]
    A7["stageViewIntent / stageQuery / stageDelete"]
    A8["WorkingDraft"]
    A9["runCheck\ncontract + runtime + renderer"]
    A10["composePatch\nPendingProposal"]
    A11["User approval"]
    A12["applyPatch"]
    A13["persist DashboardDocument draft"]
  end

  subgraph Viewer["Viewer Flow"]
    V1["Open published dashboard"]
    V2["GET /api/dashboards/[dashboardId]"]
    V3["read published DashboardDocument"]
    V4["POST /api/query/execute-batch"]
    V5["resolve filters + execute queries"]
    V6["BindingResults + renderer checks"]
    V7["derive render model"]
    V8["materialize ECharts option"]
    V9["ECharts renders cards"]
  end

  A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8 --> A9 --> A10 --> A11 --> A12 --> A13
  V1 --> V2 --> V3 --> V4 --> V5 --> V6 --> V7 --> V8 --> V9
  A13 -. "saved / published document" .-> V3
```

## 2. Module Architecture

```mermaid
flowchart TB
  subgraph UI["Presentation UI - src/web"]
    Management["management\nworkspace, datasources, users, reports"]
    AuthoringUI["authoring\nchat, canvas, approval, preview"]
    ViewerUI["viewer\npublished dashboard runtime"]
    SharedWeb["shared web\ni18n, api helpers, utils, styles"]
  end

  subgraph App["Application Boundary - src/app"]
    Pages["pages\napp router entrypoints"]
    Api["api routes\nthin request boundaries"]
  end

  subgraph Server["Server Runtime - src/server"]
    Auth["auth\nsession, CSRF, permissions"]
    AuthoringSvc["authoring\nchat/session/stream/check orchestration"]
    DashboardRepo["cloud + dashboards\nrepository and versioning"]
    Execution["execution\npreview and execute-batch"]
    Datasource["datasource\nconnection, schema, query engines"]
    Logs["logs\nobservability and traces"]
    Guards["guards\nrate limit and quotas"]
  end

  subgraph AI["AI Authoring - src/ai/authoring"]
    Scope["runtime\nintent, transcript, capability scope"]
    Surface["agent\npi-agent session and tool surface"]
    Tools["tools\nread, declaration, author, approval"]
    Compiler["view intent compiler\nsemantic view -> recipe contract"]
    Skills["skills\nsemantic authoring guidance"]
  end

  subgraph Render["Rendering + Presentation"]
    Presentation["src/presentation\nthemes, i18n labels, view context"]
    Renderer["src/renderers\necharts recipes, slots, validation, materialize"]
  end

  subgraph Core["Core Contract"]
    Contracts["src/contracts\ntypes, ids, validation"]
    Domain["src/domain\npure document, layout, binding logic"]
    Doc["DashboardDocument"]
  end

  UI --> App
  App --> Server
  Server --> AI
  AI --> Core
  Server --> Core
  UI --> Core
  Render --> Core
  UI --> Render
  AI --> Render
  Server --> Render

  Contracts --> Doc
  Domain --> Doc
```

## 3. Module Responsibilities

| Module | Owns | Should not own | Key paths |
| --- | --- | --- | --- |
| `src/contracts` | Shared data shapes, ids, request/response contracts, validation | Business behavior, persistence, UI logic | `src/contracts/dashboard.ts`, `src/contracts/validation.ts` |
| `src/domain` | Pure dashboard behavior: document normalization, layout, bindings, fingerprints | React, fetch, DB, renderer-specific option mutation | `src/domain/dashboard/document.ts`, `src/domain/dashboard/layout.ts` |
| `src/presentation` | Display policy shared across UI and renderer: themes, i18n refs, presentation context | React components, DB access, renderer validation | `src/presentation/dashboard/presentation-context.ts`, `src/presentation/dashboard/themes.ts` |
| `src/renderers` | ECharts recipes, slot materialization, renderer validation, option templates | Dashboard shell chrome, server repositories, authoring UI | `src/renderers/echarts/recipes`, `src/renderers/echarts/browser/materialize-option.ts` |
| `src/web/management` | Workspace management UI: reports, datasources, users, settings | Server-only logic | `src/web/management` |
| `src/web/authoring` | Authoring workspace UI: chat, canvas, approval card, preview state | Direct DB access, AI tool policy | `src/web/authoring` |
| `src/web/viewer` | Published dashboard runtime UI and filter interactions | Authoring-only draft behavior | `src/web/viewer` |
| `src/app` | Next.js pages and thin route handlers | Business logic that belongs in `src/server` | `src/app/page.tsx`, `src/app/api/**` |
| `src/server/auth` | Session, CSRF, permission checks, workspace policy | Frontend state or UI routing | `src/server/auth` |
| `src/server/authoring` | Chat request lifecycle, session snapshots, stream leases, approval preflight | Agent semantic policy internals | `src/server/authoring` |
| `src/ai/authoring/runtime` | Intent detection, transcript inspection, capability scope | Persistence and route transport | `src/ai/authoring/runtime` |
| `src/ai/authoring/agent` | Pi-agent session, tool surface selection, hooks, ledger | Dashboard repository writes outside tools | `src/ai/authoring/agent` |
| `src/ai/authoring/tools` | Formal mutation/read surface: read tools, `stageViewIntent`, `stageQuery`, `runCheck`, `composePatch`, `applyPatch` | Hidden direct mutation paths | `src/ai/authoring/tools` |
| `src/server/execution` | Preview and execute-batch, filter resolution, query-to-binding result mapping | Chart shell presentation | `src/server/execution` |
| `src/server/datasource` | Datasource connection storage, schema discovery, query engines | Dashboard document ownership | `src/server/datasource` |
| `src/server/cloud` / `src/server/dashboards` | Dashboard draft/published persistence, migrations, versioning | Renderer option generation | `src/server/cloud`, `src/server/dashboards` |
| `src/server/logs` | Observability events, trace/log sinks | Request control flow decisions | `src/server/logs` |
| `src/server/guards` | Rate limits, quotas, capacity gates | Feature-specific behavior | `src/server/guards` |

## 4. Reasonableness Assessment

The architecture is broadly sound.

- The strongest decision is the single `DashboardDocument` contract. It prevents
  the authoring state, execution state, and viewer state from becoming separate
  products.
- The second strong decision is the explicit authoring tool surface. Mutations go
  through staged tools, `runCheck`, `composePatch`, approval, and `applyPatch`
  instead of letting the model write arbitrary document JSON.
- The layer split is mostly clean: routes are thin, server orchestration is under
  `src/server`, pure document rules are under `src/domain`, and renderer behavior
  is isolated under `src/renderers`.
- The template/runtime policy is in the right place: semantic view kinds are
  mapped to renderer recipes through template capability contracts, not through
  ad hoc UI decisions.

The main design risk is keeping the authoring tool surface disciplined as new
view kinds are added. The current boundary is:

- `stageViewIntent`: agent-facing semantic authoring surface.
- `stageQuery`: guarded correction lane for existing query SQL.
- `stageDelete`: pure removal transaction.
- internal compiled chart transaction primitives: implementation detail used by
  runtime compilation, not the public model-facing creation API.

## 5. Recommended Simplification

Keep the long architecture document as the full source, but use this short map
as the onboarding entrypoint. The top-level story should consistently say:

```text
natural language -> semantic view intent -> template capability -> renderer recipe
-> WorkingDraft -> checks -> approval -> DashboardDocument -> execution/rendering
```
