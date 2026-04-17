# Single-Agent Authoring Architecture — Refactor Spec

> **Status**: Approved for implementation.
> **Cutover strategy**: One-shot, no backward compatibility. Old code deleted in the same PR as new code lands.
> **Principle**: Simplicity and reliability over flexibility. Single source of truth for context, state, and tool scope.

---

## 1. Goal & Non-goals

### Goal
Replace the current three-headed architecture (`main-agent` + `dashboard-worker` + `view-worker` + inline `delegateToViewAgent` sub-agent) with a **single authoring agent** whose behavior per turn is determined by a deterministic state machine (`computeAuthoringScope`) that controls:

- System prompt (which mode-hints are included)
- Active tool set (which tools the LLM sees this turn)
- L2 context block (how much of the dashboard state is exposed)
- Message redaction (which historic tool outputs are kept vs gutted)

### Non-goals
- **No** backward compatibility with old session records. Existing sessions may be wiped.
- **No** LLM-based planner / router. Scope decisions are deterministic code.
- **No** multi-agent orchestration as a default pattern. A single escape-hatch tool (`focusedTask`) is provided for bounded isolated sub-work.
- **No** change to the underlying AI SDK (`ai@6` / `@ai-sdk/*` stays).
- **No** change to datasource, contracts, renderers, domain, or server persistence layers outside `src/server/main-agent/`.

### Success criteria
- `src/ai/main-agent/`, `src/ai/dashboard-worker/`, `src/ai/view-worker/`, `src/ai/shared/worker/` all deleted.
- Exactly one `ToolLoopAgent` instantiation path at runtime (plus `focusedTask` escape hatch).
- Per-turn LLM input token usage typically < 12K for dashboards with ≤ 20 views.
- All existing authoring flows (chat / explore / first-view / edit / approval / focused edit) pass integration tests.

---

## 2. Target Directory Layout

```
src/ai/authoring/
  index.ts                    # public API: createAuthoringAgentStream, safeValidateMessages
  agent.ts                    # ToolLoopAgent instantiation + prepareStep wiring
  scope.ts                    # computeAuthoringScope — the state machine
  prompt.ts                   # buildAuthoringSystemPrompt(mode, scope, skills)
  types.ts                    # AuthoringMessage, AuthoringMode, AuthoringScope, …
  context/
    context-block.ts          # L2 builders: dashboardVariant / focusedVariant / emptyVariant
    fingerprint.ts            # sha256 helper
    inject-context.ts         # merge context block into latest user message
  messages/
    redact.ts                 # redactSupersededToolOutputs (rule table driven)
    invalidate-on-mutation.ts # mutation-triggered invalidation hook
    outline.ts                # debug outlining (kept from current message-outline.ts)
    client-parts.ts           # strip client-only parts (kept from current client-parts.ts)
    inspection.ts             # hasPendingApproval, findLatestDraftOutput, etc. (kept, trimmed)
  tools/
    index.ts                  # buildAuthoringTools({ scope, dashboard, draftState, deps })
    draft-state.ts            # working draft (kept from shared/worker/draft-state.ts)
    candidate-document.ts     # (kept from shared/worker/candidate-document.ts)
    patch-builder.ts          # (kept from shared/worker/patch-builder.ts)
    detail-builders.ts        # (kept from shared/worker/detail-builders.ts)
    reliability.ts            # (kept from shared/worker/reliability.ts)
    focused-guards.ts         # (kept from shared/worker/tools/focused-guards.ts)
    schemas.ts                # (kept from shared/worker/tools/schemas.ts)
    adapters.ts               # (merged from both worker/tools/adapters.ts)
    focused-task.ts           # the escape hatch tool

src/server/authoring/         # renamed from src/server/main-agent/
  chat-service.ts             # stripped: no regex routing, directly calls createAuthoringAgentStream
  chat-request.ts             # (kept, renamed types)
  chat-session-orchestrator.ts (kept)
  active-streams.ts           # (kept)
  task-repository.ts          # (kept)
  task-service.ts             # (kept)
  session-repository.ts       # (kept)
  session-service.ts          # (kept)
  checks-repository.ts        # (kept)
  checks-service.ts           # (kept)
  session-key.ts              # (kept)
  stream-service.ts           # (kept)

src/app/api/authoring/chat/   # renamed from api/main-agent/chat
src/web/authoring/            # useChat api path updated (see §12)
```

Routing module `src/ai/main-agent/routing.ts` is **deleted**. The regex-based worker router is obsolete.

---

## 3. Three-Layer Context Model

Every LLM call receives a payload composed of three layers. Each layer has its own lifecycle and compression policy. Layer boundaries are enforced at the `createAuthoringAgentStream` entry point.

| Layer | Contents | Lifecycle | Compression |
|---|---|---|---|
| **L1 static** | System prompt, tool schemas | Per-turn rebuild from `AuthoringScopeDecision`; near-constant | Static: prompt sections included by mode; `activeTools` subset by scope |
| **L2 authoritative snapshot** | Current dashboard state (scope-narrowed), focused view detail, datasources list, aggregated checks | **Recomputed every turn** from server state. Never trusted from history. Injected into last user message, fingerprinted. | Scope-aware: `dashboard` / `focused(viewId)` / `empty` variants; focused variant is size-bounded regardless of dashboard size |
| **L3 conversation history** | User text, assistant text, tool calls, tool results | Append-only from SDK; pre-processed before every call | Rule-based `redactSupersededToolOutputs` (§7) + mutation invalidation (§8) + optional soft compaction (P1) |

**Core invariant**: any "current state" fact (view definition, query definition, binding definition, schema, check result) is **authoritative only in L2 or in a fresh tool call result landing in L3**. Older tool results in L3 that represent the same resource MUST be gutted so the model cannot read stale values as if they were current.



---

## 4. `computeAuthoringScope` — The State Machine

The heart of the refactor. A pure function that takes observable state and returns the full decision envelope for the turn.

### 4.1 Inputs

```ts
interface AuthoringScopeInput {
  dashboard: {
    id: string | null;
    name: string;
    views: DashboardViewSummary[];      // {id,title,renderer_kind,check_status}
    datasources: DatasourceListItem[];  // {id,label}
    checksSummary: { ok: number; warning: number; error: number };
  };
  messages: AuthoringMessage[];         // full history incl. latest user turn
  focusedViewId: string | null;         // from client UI
  stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
                                        // accumulated prior steps THIS turn (from prepareStep params)
  skills: AuthoringSkillSummary[];      // available skill descriptors
}
```

### 4.2 Outputs

```ts
interface AuthoringScopeDecision {
  mode:
    | "chat"                 // conversational only; no tools
    | "explore"              // read-only exploration
    | "author-first-view"    // bootstrap: views.length === 0
    | "author-dashboard"     // global authoring
    | "author-focused"       // scoped to a single view
    | "approval";            // there is a composed patch awaiting apply
  scope:
    | { kind: "dashboard" }
    | { kind: "focused"; viewId: string }
    | { kind: "empty" };
  activeTools: AuthoringToolName[];
  toolChoice: "auto" | "none";
  systemPromptSections: SystemPromptSectionKey[];
  contextBlockVariant: "dashboard" | "focused" | "empty";
  relevantSkillIds: string[];
  stopReason: "approval-applied" | null; // set by prepareStep post-applyPatch
}
```

### 4.3 Decision rules (evaluated top to bottom, first match wins)

| # | Condition | mode | scope | toolChoice | Notes |
|---|---|---|---|---|---|
| 1 | `stepHistoryInTurn` contains a **successful** `applyPatch` | previous mode | previous scope | `"none"` | Force-stop: patch applied, end turn with a summary |
| 2 | `messages` end with an unresolved `composePatch` proposal AND last user msg is an explicit apply/cancel directive | `approval` | `dashboard` | `auto` | `activeTools = ["applyPatch"]` |
| 3 | `messages` end with an unresolved `composePatch` proposal AND last user msg is conversational | `chat` | `dashboard` | `none` | Answer without touching the proposal |
| 4 | Latest user text matches `CAPABILITY_QUESTION_REGEX` (e.g. "能做什么", "你是谁") | `chat` | `dashboard` | `none` | `activeTools = []`, conversational reply |
| 5 | Latest user text matches `EXPLORATORY_QUESTION_REGEX` AND no authoring intent keywords | `explore` | `dashboard` | `auto` | `activeTools` = `READ_DASHBOARD` |
| 6 | `dashboard.views.length === 0` | `author-first-view` | `empty` | `auto` | `activeTools` = `READ_DASHBOARD ∪ WRITE_DASHBOARD ∪ PROPOSE` |
| 7 | `focusedViewId` non-null AND exists in dashboard AND latest user text does **not** match `GLOBAL_INTENT_KEYWORDS` (e.g. "整个仪表盘", "布局", "对齐", "新增视图", "删除视图") | `author-focused` | `focused(focusedViewId)` | `auto` | `activeTools` = `READ_FOCUSED ∪ WRITE_FOCUSED ∪ PROPOSE` — **no** `deleteView`, **no** `getViews`, **no** layout mutation |
| 8 | default | `author-dashboard` | `dashboard` | `auto` | Full `READ_DASHBOARD ∪ WRITE_DASHBOARD ∪ PROPOSE ∪ ESCAPE` |

### 4.4 Tool-set legend

Each mode maps to a named set in `tools/tool-sets.ts`:

- `READ_DASHBOARD` = `{getViews, getView, getQuery, getBinding, getDatasources, getSchemaByDatasource, runCheck, loadSkill, loadSkillReference}`
- `READ_FOCUSED(viewId)` = same as READ_DASHBOARD minus `getViews`; `getView/getQuery/getBinding/runCheck` wrapped with `assertFocusedViewAccess`
- `WRITE_DASHBOARD` = `{upsertView, upsertQuery, upsertBinding, deleteView, deleteQuery, deleteBinding}`
- `WRITE_FOCUSED(viewId)` = same as WRITE_DASHBOARD minus `deleteView`; all wrapped with `assertFocusedViewAccess` + `assertNoFocusedLayoutMutation`
- `PROPOSE` = `{composePatch}`
- `APPLY` = `{applyPatch}`
- `ESCAPE` = `{focusedTask}` (only available in `author-dashboard` mode)

Mapping (summary):

| mode | tool set | `focusedTask` available? |
|---|---|---|
| `chat` | ∅ | no |
| `explore` | `READ_DASHBOARD` | no |
| `author-first-view` | `READ_DASHBOARD ∪ WRITE_DASHBOARD ∪ PROPOSE` | no |
| `author-dashboard` | `READ_DASHBOARD ∪ WRITE_DASHBOARD ∪ PROPOSE ∪ ESCAPE` | yes |
| `author-focused` | `READ_FOCUSED ∪ WRITE_FOCUSED ∪ PROPOSE` | no |
| `approval` | `APPLY` | no |

### 4.5 Regex catalogs (co-located)

- `CAPABILITY_QUESTION_REGEX`: current `isMainAgentCapabilityQuestion` — migrated unchanged.
- `EXPLORATORY_QUESTION_REGEX`: current exploratory heuristics — migrated unchanged.
- `GLOBAL_INTENT_KEYWORDS`: current global-intent set in `resolveMainAgentWorkerRoute` — migrated to `scope.ts`.

All regex constants live in `src/ai/authoring/scope.ts` so they can be tested against a fixture table (§14).


---

## 5. L2 Context Block — Three Variants

Location: `src/ai/authoring/context/context-block.ts`. Exports `buildAuthoringContextBlock(variant, input): { markdown: string; fingerprint: string }`.

### 5.1 `dashboard` variant

Used when: `mode ∈ {explore, author-dashboard, approval, chat-over-proposal}`.

```
# Dashboard state
- Id: {{id|new}}
- Name: {{name}}
- View count: {{n}}
- Checks: ok={{c.ok}} warning={{c.warning}} error={{c.error}}

## Views
- [{{view_id}}] {{title}} | {{renderer_kind}} | check: {{check_status}}
  ...  (one line per view, no slots/bindings)

## Datasources
- [{{ds_id}}] {{label}}  ...

## Proposal
<present iff latest composePatch unresolved>
- proposal_id: {{id}}, ops: {{count}}, summary: {{summary-truncated-200-char}}
```

Size target: ≤ 2 KB for up to 30 views.

### 5.2 `focused` variant

Used when: `mode === author-focused`.

```
# Dashboard state (focus: {{viewId}})

## Other views (lightweight)
- [{{view_id}}] {{title}}  ... (id + title only, no renderer/check)

## Focused view — {{viewId}}
{{ViewDetail rendered via existing detail-builders.ts}}
<same payload as current focused-worker ViewDetail block:
 - id, title, description
 - renderer (kind, slots, options)
 - queries: full QueryDef per query_id referenced
 - bindings: full BindingDetail[]
 - latest_check: ViewCheckSnapshot>

## Datasources
- [{{ds_id}}] {{label}}  ...
```

Size target: ≤ 4 KB regardless of total view count. Size is bounded by the single focused view.

### 5.3 `empty` variant

Used when: `mode === author-first-view`.

```
# Dashboard state
- Name: {{name}}
- Views: (none)

## Available datasources
- [{{ds_id}}] {{label}}
  Schema summary: {{first 8 tables, each with first 5 columns}}  ...

## Renderer catalog
- kpi: required slots=..., description=...
- line_chart: required slots=..., description=...
- ...  (load from registry)
```

Size target: ≤ 4 KB. Datasource schema summaries are truncated; deep exploration via `getSchemaByDatasource` tool.

### 5.4 Injection

- `context/inject-context.ts` takes the current `messages`, finds the last user message, replaces any previous `## Context` fenced block inside it with the new one (idempotent by fingerprint marker `<!-- authoring-context:fp=XXXX -->`).
- If fingerprint unchanged from last turn → no re-injection (LLM cache-friendly).
- If messages do not have a trailing user message (rare: system/tool only), append a synthetic user message containing only the context block.

### 5.5 Fingerprint

`fingerprint = sha256(variant + JSON.stringify(normalizedInput))` where `normalizedInput` sorts arrays by id and strips timestamps. Reuse `sha256` from `node:crypto`.

---

## 6. Unified Tool Catalog

`src/ai/authoring/tools/index.ts` exports:

```ts
export function buildAuthoringTools(params: {
  scope: AuthoringScope;
  dashboard: DashboardRecord;
  draftState: WorkingDraft;           // existing
  candidateDocument: CandidateDocument; // existing
  deps: AuthoringToolDeps;              // repositories, loaders
}): Record<AuthoringToolName, Tool>;
```

### 6.1 Tool list (17 total; consolidated from existing worker tools)

| Name | Category | Input | Output | Focus-guard | Mutation invalidates |
|---|---|---|---|---|---|
| `getViews` | read | `{reason?}` | `GetViewsToolOutput` | disabled in `focused` | — |
| `getView` | read | `{view_id?, title?}` | `GetViewToolOutput` | `assertFocusedViewAccess(view_id)` | — |
| `getQuery` | read | `{query_id}` | `{query, used_by}` | lookup binding → assert owning view | — |
| `getBinding` | read | `{view_id, slot_id?}` | `BindingDetail[]` | `assertFocusedViewAccess(view_id)` | — |
| `getDatasources` | read | `{reason?}` | `GetDatasourcesToolOutput` | — | — |
| `getSchemaByDatasource` | read | `{datasource_id, reason?}` | `DatasourceContext` | — | — |
| `runCheck` | read | `{scope, view_id?, reason?}` | `RunCheckToolOutput` | `assertFocusedViewAccess(view_id)` if scope=view | — |
| `loadSkill` | read | `{name, reason?}` | `{skill_id, content}` | — | — |
| `loadSkillReference` | read | `{skill_id, reference_name, reason?}` | `{content}` | — | — |
| `upsertView` | write | `{request, view_spec, layout?}` | `UpsertViewToolOutput` | focused: `assertFocusedViewAccess(view_spec.view_id)` + `assertNoFocusedLayoutMutation(hasLayout)` | invalidates `getView(view_id)`, `getBinding(view_id)`, `runCheck(view=view_id)` |
| `upsertQuery` | write | `{query}` | `UpsertQueryToolOutput` | focused: assert all binding users are focused view | invalidates `getQuery(query.id)`, `getBinding(*)`, `runCheck(view=affected)` |
| `upsertBinding` | write | `{binding}` | `UpsertBindingToolOutput` | focused: `assertFocusedViewAccess(binding.view_id)` | invalidates `getBinding(binding.id)`, `getView(binding.view_id)`, `runCheck(view=binding.view_id)` |
| `deleteView` | write | `{view_id}` | `{summary}` | disabled in focused | invalidates all reads for `view_id` + `getViews` |
| `deleteQuery` | write | `{query_id}` | `{summary}` | focused: assert users all focused | invalidates `getQuery(query_id)` + affected `getBinding`/`runCheck` |
| `deleteBinding` | write | `{binding_id}` | `{summary}` | focused: `assertFocusedViewAccess(owning_view_id)` | invalidates `getBinding(binding_id)` + affected view's checks |
| `composePatch` | propose | `{summary, intent?}` | `{proposal}` | — | — (read-only of draft) |
| `applyPatch` | apply | `{proposal_id}` | `{status, dashboard}` | — | **global**: invalidates all read tool outputs |
| `focusedTask` | escape | `{view_id, task, max_steps?}` | `{status, summary, changed_view_ids, steps_used}` | scope must be `dashboard`; see §9 | invalidates like `applyPatch` if sub-agent committed |

### 6.2 Source consolidation

Today's `src/ai/dashboard-worker/tools/tools.ts` (989 lines) and `src/ai/view-worker/tools/tools.ts` (853 lines) both call into the same `shared/worker/*` helpers with different guard wrappers. In the target:

- Each of the 17 tools becomes one file in `src/ai/authoring/tools/impl/{name}.ts`.
- `buildAuthoringTools` picks the subset named in `scope.activeTools` and wires the guards based on `scope.kind`.
- Remove all `focusedMode: boolean` branching inside tool bodies — it's now encoded in whether the guard is installed.

Expected line count after consolidation: ~1100 lines (vs 1842 today).

---

## 7. L3 Redaction — Rule Table

Location: `src/ai/authoring/messages/redact.ts`. Exports:

```ts
export function redactSupersededToolOutputs(
  messages: AuthoringMessage[],
): AuthoringMessage[];
```

Pure function: same input → same output. No side effects. Called **before every LLM turn**, after `prepareStep` and before `stepModel.doGenerate`.

### 7.1 Rule table

Rules are applied in order. Each rule scans the tool-result parts in reverse-chronological order and keeps the first occurrence; later (= earlier in time) occurrences have their heavy payload replaced by a placeholder.

| Rule id | Tool part type | Keyed by | Placeholder replacement |
|---|---|---|---|
| `R1` | `tool-getView` | `output.view.view.id` (or `input.view_id`) | `{ _superseded_by_later_read: true, view_id, match_status: output.match_status }` |
| `R2` | `tool-getQuery` | `input.query_id` | `{ _superseded_by_later_read: true, query_id }` |
| `R3` | `tool-getBinding` | `input.view_id + input.slot_id` | `{ _superseded_by_later_read: true, view_id, slot_id }` |
| `R4` | `tool-getSchemaByDatasource` | `input.datasource_id` | `{ _superseded_by_later_read: true, datasource_id }` |
| `R5` | `tool-runCheck` | `input.scope + input.view_id` | `{ _superseded_by_later_read: true, scope, view_id, status: output.status }` |
| `R6` | `tool-loadSkill` | `input.name` | `{ _superseded_by_later_read: true, skill_id }` |
| `R7` | `tool-loadSkillReference` | `input.skill_id + input.reference_name` | `{ _superseded_by_later_read: true, reference_name }` |
| `R8` | `tool-getViews` | — (singleton) | `{ _superseded_by_later_read: true }` (keep only latest) |
| `R9` | `tool-getDatasources` | — (singleton) | `{ _superseded_by_later_read: true }` (keep only latest) |
| `R10` | `tool-composePatch` | — (singleton latest proposal only) | strip `suggestion.dashboard` on non-latest; keep `proposal_id` + `summary` |
| `R11` | `tool-applyPatch` | always | strip `output.dashboard` field on ALL occurrences (current state is in L2) |

### 7.2 Semantic guarantees

- Tool call arguments are **never** redacted — the model retains full memory of what it tried.
- User and assistant text is **never** redacted.
- Tool result shape remains valid (required fields present) after redaction so the model stays well-formed.
- Redaction is reversible against the original message store (see §13: persistence stores pre-redaction messages).

---

## 8. Mutation Invalidation Hook

Location: `src/ai/authoring/messages/invalidate-on-mutation.ts`. Exports:

```ts
export function invalidateMutatedReads(
  messages: AuthoringMessage[],
  mutation: MutationDescriptor,
): AuthoringMessage[];
```

Called from each write tool's `execute` **after** the write succeeds, before returning.

### 8.1 Mutation descriptors

```ts
type MutationDescriptor =
  | { kind: "view"; view_id: string }
  | { kind: "query"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding"; binding_id: string; view_id: string }
  | { kind: "view-delete"; view_id: string }
  | { kind: "query-delete"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding-delete"; binding_id: string; view_id: string }
  | { kind: "patch-apply" };
```

### 8.2 Invalidation actions

| Mutation | Action on messages |
|---|---|
| `view(view_id=X)` | Replace payload of prior `tool-getView(X)`, `tool-getBinding(view_id=X, *)`, `tool-runCheck(scope=view, view_id=X)` outputs with `{ _stale_after_mutation: true, view_id: "X" }` |
| `query(query_id=Y, affected=[A,B])` | Same for `tool-getQuery(Y)` and `tool-getBinding/runCheck` tied to A,B |
| `binding(binding_id=Z, view_id=X)` | Same for `tool-getBinding(*)` whose result contained Z; and `tool-getView(X)`, `tool-runCheck(view_id=X)` |
| `*-delete` | Same as corresponding upsert invalidation, plus remove from dashboard summary (authoritative via L2 next turn) |
| `patch-apply` | Invalidate **all** prior `tool-getView/getQuery/getBinding/runCheck/getViews` outputs globally |

Stale marker `{_stale_after_mutation: true}` is distinct from `{_superseded_by_later_read: true}` so the model can read the reason correctly: "I changed this, it's no longer trustworthy" vs "I read it again elsewhere".

### 8.3 Integration

- Redact rules (§7) and mutation invalidation (§8) are composable: the redactor processes whatever marker is present.
- Both run at **two** points in the pipeline: (a) inside each write tool's `execute` (mutation hook), (b) on the complete message history just before LLM call (redactor sweeps for superseded reads).

---

## 9. `focusedTask` — The Only Sub-Agent

Location: `src/ai/authoring/tools/impl/focused-task.ts`.

Design principle: **the only place where a second `ToolLoopAgent` can exist**. Not for general orchestration — for bounded, view-scoped work that would pollute parent context with too many intermediate reads (e.g., "refactor this view's bindings across 6 slots with per-slot schema lookup").

### 9.1 Parameters

```ts
{
  view_id: string,              // must exist in current dashboard
  task: string,                 // human-readable instructions from parent model
  max_steps?: number,           // default 8, hard cap 12
}
```

### 9.2 Execution contract

```ts
execute: async function* (args, { abortSignal, messages }) {
  // 1. Validate view exists
  // 2. Build READ_FOCUSED ∪ WRITE_FOCUSED tool set for args.view_id
  //    — NO composePatch, NO applyPatch, NO getViews, NO focusedTask (no recursion)
  // 3. Spawn ToolLoopAgent with:
  //      system: focused-task system prompt (scoped to one view)
  //      messages: [synthetic user msg: args.task + current ViewDetail snapshot]
  //      stopWhen: stepCountIs(args.max_steps ?? 8), hard-capped at 12
  //      abortSignal: forwarded
  //      shared draftState: parent's WorkingDraft (sub-agent writes stage into it)
  // 4. Stream sub-agent's `stepProgress` + tool events to UI with a "sub-agent" tag
  // 5. On completion: DO NOT bubble sub-agent messages into parent history.
  //    Return only: { status, summary, changed_view_ids, steps_used }
  yield { type: "text", text: "..." }  // live progress for UI only
}
toModelOutput: ({ output }) => ({
  type: "text",
  text: `Sub-task (${output.steps_used} steps): ${output.summary}`,
})
```

### 9.3 Safety properties

1. **No recursion**: sub-agent does not have `focusedTask` in its active tool set.
2. **Budget-bounded**: hard cap 12 steps, timeout inherits parent's `AbortSignal`.
3. **Scope-bounded**: only the one view can be read/written (guards enforce).
4. **Context hygiene**: sub-agent's intermediate tool results never reach parent. Only the condensed summary string returns.
5. **Draft-shared**: sub-agent writes to the same `WorkingDraft`. Parent then calls `composePatch` on the combined draft. One patch, one approval.

### 9.4 When the model is told to use it

The `author-dashboard` system prompt mentions `focusedTask` only in this shape: _"If a single view needs multi-step refactoring (e.g., several bindings + schema lookups), prefer `focusedTask(view_id, task)` over staging N tools inline. It isolates intermediate reads."_ The model may not use it; that's fine.


---

## 10. Core Type Contracts

Location: `src/ai/authoring/types.ts`. All public types live here; internal types stay local.

```ts
export type AuthoringToolName =
  | "getViews" | "getView" | "getQuery" | "getBinding"
  | "getDatasources" | "getSchemaByDatasource" | "runCheck"
  | "loadSkill" | "loadSkillReference"
  | "upsertView" | "upsertQuery" | "upsertBinding"
  | "deleteView" | "deleteQuery" | "deleteBinding"
  | "composePatch" | "applyPatch"
  | "focusedTask";

export type AuthoringMode =
  | "chat" | "explore"
  | "author-first-view" | "author-dashboard" | "author-focused"
  | "approval";

export type AuthoringScope =
  | { kind: "dashboard" }
  | { kind: "focused"; viewId: string }
  | { kind: "empty" };

export type AuthoringMessage = UIMessage<
  AuthoringMetadata,
  AuthoringDataParts,     // data-authoring_scope, data-authoring_checks, data-authoring_patch, ...
  AuthoringUITools        // generated from the 17 tool schemas
>;
```

### 10.1 Types deleted

These types disappear (no replacement, no alias):

- `MainAgentMessage`, `MainAgentTools`, `MainAgentMetadata`, `MainAgentDataParts`
- `MainAgentRoute`, `MainAgentRouteDecision`, `MainAgentWorkerRoute`
- `MainAgentWorkflowStage`, `MainAgentWorkflowSummary`
- `WorkerWorkflow`, `WorkerEngineControl`, `WorkerEnginePrepareStep`
- `DashboardWorkerMessage`, `ViewWorkerMessage` (if distinct)

### 10.2 Types renamed 1:1 (content identical)

- `MainAgentSkillSummary` → `AuthoringSkillSummary`
- All `*ToolInput` / `*ToolOutput` (17 pairs) — keep as-is, move to `src/ai/authoring/contracts/tool-io.ts`
- `ViewDetail`, `QueryDetail`, `BindingDetail`, `ViewCheckSnapshot` — move to the same file

### 10.3 Authoring data parts (UI stream payloads)

| Part type | Data |
|---|---|
| `data-authoring_scope` | `{ mode, scope, activeTools, contextFingerprint }` |
| `data-authoring_patch` | proposal summary for UI render (unchanged from current `data-main_agent_patch`) |
| `data-authoring_checks` | check summary (unchanged) |
| `data-authoring_sub_task` | `{ parent_step, view_id, status, steps_used }` for `focusedTask` progress |

The old `data-main_agent_route`, `data-main_agent_workflow` parts are **removed**. UI reads mode/scope from `data-authoring_scope` instead.

---

## 11. Agent Loop & `prepareStep`

Location: `src/ai/authoring/agent.ts`. Exports:

```ts
export function createAuthoringAgentStream(input: {
  messages: AuthoringMessage[];
  dashboardId: string | null;
  focusedViewId: string | null;
  sessionId: string;
  abortSignal: AbortSignal;
}): Promise<ReadableStream>;
```

### 11.1 Flow per request

```
1. Load dashboard record + datasources list + checks summary (from server/authoring)
2. Instantiate WorkingDraft from dashboard (seeded with current state)
3. Build AuthoringScopeInput
4. Build tools = buildAuthoringTools({ scope: decision.scope, ... })
5. Pre-flight: run redactSupersededToolOutputs(messages)
6. Pre-flight: compute + inject L2 context block (fingerprint-gated)
7. Instantiate ToolLoopAgent with:
     model: stepModel
     tools: filtered to decision.activeTools via prepareStep
     stopWhen: stepCountIs(12) OR applyPatchSucceeded
     prepareStep: see 11.2
8. Return streamed UIMessageStreamResponse
```

### 11.2 `prepareStep` per-step contract

```ts
prepareStep: ({ steps, messages }) => {
  // rebuild scope with freshly observed stepHistoryInTurn
  const stepHistory = extractToolOutcomes(steps);
  const decision = computeAuthoringScope({ ...baseInput, stepHistoryInTurn: stepHistory, messages });

  // emit ui data part so frontend can render current mode
  emitDataPart("data-authoring_scope", decision);

  // run redactor again (new tool results since last step)
  const cleanMessages = redactSupersededToolOutputs(messages);

  return {
    messages: cleanMessages,
    system: buildAuthoringSystemPrompt(decision.mode, decision.scope, decision.relevantSkillIds),
    activeTools: decision.activeTools,
    toolChoice: decision.toolChoice,
    // L2 contextBlock re-injected only if fingerprint changed since last step
  };
}
```

### 11.3 Stop conditions

The loop stops when **any** of:

- `stepCountIs(12)` — global hard cap
- `stopReason === "approval-applied"` — `applyPatch` succeeded in a prior step of this turn
- `AbortSignal` triggered (timeout / client disconnect)
- No tool call + non-empty assistant text in the latest step (natural conversational end)

### 11.4 Persistence

- Persist **raw** `AuthoringMessage[]` (pre-redaction) in session storage.
- Redaction happens only in memory before each LLM call.
- Load-from-storage → fresh redaction pass — deterministic replay.

---

## 12. API & Frontend Surface Changes

### 12.1 HTTP

- `POST /api/main-agent/chat` → `POST /api/authoring/chat` (request/response shape unchanged except data-part types renamed per §10.3)
- `GET /api/main-agent/sessions/...` → `GET /api/authoring/sessions/...`

Old routes return `410 Gone`. No rewrite.

### 12.2 Frontend

- `useChat({ id, api: "/api/main-agent/chat" })` → `useChat({ id, api: "/api/authoring/chat" })`
- Frontend components reading `data-main_agent_route` / `data-main_agent_workflow` update to `data-authoring_scope`.
- Component directory `src/web/main-agent/` → `src/web/authoring/` (mechanical rename).

### 12.3 Chat session records

One-shot cutover implies existing session rows become invalid. Options (pick one, engineer's call):

1. **Wipe** sessions table on deploy. Acceptable if sessions are short-lived / dev-only.
2. **Mark-and-hide**: add a `schema_version` column; old rows (`v1`) are hidden from UI; new rows (`v2`) visible. Less destructive, adds a column.

Spec recommends option 1 unless product explicitly needs history retention.

---

## 13. Deletion Inventory

Files/directories deleted in the same PR:

```
src/ai/main-agent/**                         (except contracts/*.ts that get moved to authoring/contracts/)
src/ai/dashboard-worker/**
src/ai/view-worker/**
src/ai/shared/worker/**                      (reusable helpers moved into authoring/tools/)
src/server/main-agent/**                     (content moved to server/authoring/)
src/app/api/main-agent/**
src/web/main-agent/**                        (content moved to web/authoring/)
```

Specifically deleted (non-moved) symbols:

- `resolveMainAgentWorkerRoute`, `MainAgentWorkerRoute`, related regex splits across dashboard/view — **gone**, replaced by `computeAuthoringScope`.
- `buildWorkerEngineControl`, `prepareWorkerEngineStep` — **gone**, folded into `prepareStep` in `agent.ts`.
- `delegateToViewAgent` tool (inside `dashboard-worker/tools/tools.ts`) — **gone**, replaced by `focusedTask`.
- Dual `system-prompt.ts` (dashboard + view) — replaced by one `buildAuthoringSystemPrompt(mode, scope)` with mode-scoped sections.

Reusable logic moved (not deleted):

- `focused-guards.ts` → `src/ai/authoring/tools/focused-guards.ts`
- `draft-state.ts`, `candidate-document.ts`, `patch-builder.ts`, `detail-builders.ts`, `reliability.ts` → `src/ai/authoring/tools/`
- `redactHeavyDashboardSnapshotsForTransport`, `pruneToolDashboardsAfterAppliedPatch` → absorbed into `redactSupersededToolOutputs` (rules `R10`, `R11`)
- Message outline / client-part strip helpers → `src/ai/authoring/messages/outline.ts`, `client-parts.ts`

---

## 14. Test Plan

### 14.1 Unit tests (co-located, vitest)

| Test file | Covers |
|---|---|
| `scope.test.ts` | 8 decision rules × fixture inputs → expected mode/scope/activeTools/toolChoice. One fixture per rule, plus 6 edge cases (empty messages, focused id not in dashboard, apply/cancel text detection, mixed signals) |
| `context-block.test.ts` | Each variant × fixture dashboard → stable golden markdown snapshot + fingerprint stability (same input → same fp; perturbed input → different fp) |
| `redact.test.ts` | R1–R11 × before/after snapshots. Multi-rule composition test: 3 `getView(X)` + 2 `getView(Y)` → 1 latest + 1 latest kept, others placeholder |
| `invalidate-on-mutation.test.ts` | Each mutation kind × message fixture → expected `_stale_after_mutation` markers applied only to matching prior reads |
| `tool-sets.test.ts` | Each (mode, scope) pair produces the exact set from §4.4; focus-guards are wired for focused tools and absent for dashboard tools |
| `inject-context.test.ts` | Fresh message list gets context block; unchanged fingerprint → no re-injection; changed fingerprint → replacement in-place |

### 14.2 Integration tests (harness: mocked LLM)

| Scenario | Expected flow |
|---|---|
| First turn with empty dashboard | `author-first-view` → load skill → upsertView → composePatch → user approves → `approval` → applyPatch → stop |
| Focused edit of one view | `author-focused` (bounded tools) → upsertBinding → runCheck → composePatch → approve → applyPatch |
| Dashboard-level global intent with focus set | `author-dashboard` (focus ignored) → user says "对齐所有视图" → global tools active |
| Capability question mid-session | `chat` → no tools → short response |
| Exploratory question | `explore` → `getViews` → `getSchemaByDatasource` → assistant text, no mutations |
| Mid-turn applyPatch triggers stop | After applyPatch, next `prepareStep` returns `toolChoice: none` and agent emits final assistant text, loop ends |
| `focusedTask` happy path | Parent calls `focusedTask(view_id=X, task=...)` → sub-agent runs ≤ 8 steps → returns summary → parent calls composePatch → approval |
| `focusedTask` over-budget | Sub-agent hits step cap → returns `status: incomplete` → parent reports gracefully, no crash |
| `focusedTask` abort | Parent `AbortSignal` fires → sub-agent stops cleanly, no orphan writes |

### 14.3 Context budget tests

| Test | Assertion |
|---|---|
| 30-view dashboard, `explore` mode | Serialized L2 context block < 3 KB |
| 50-view dashboard, `author-focused` | Serialized L2 context block < 5 KB (bounded by single view) |
| 20-turn session with 5 redundant `getView(same id)` | Redacted messages show 1 full payload + 4 placeholders |

### 14.4 Persistence test

Load-from-storage → LLM-call roundtrip produces byte-identical L2 fingerprint and LLM input as running the same messages in-memory. Guarantees deterministic replay.

---

## 15. Task Breakdown for Engineers

Single PR, ordered subtasks. Estimates assume one mid-senior engineer.

| # | Task | Deliverable | Est. |
|---|---|---|---|
| **T1** | Scaffold `src/ai/authoring/` with `types.ts`, `scope.ts` (stubs + regex migration), `prompt.ts` (mode-sectioned), `context/context-block.ts` (3 variants), `context/fingerprint.ts`, `context/inject-context.ts` | Compiling module, exports stable | 1.0 d |
| **T2** | Implement `computeAuthoringScope` + unit tests (§14.1 `scope.test.ts`) | 8 rules green | 1.0 d |
| **T3** | Migrate tool implementations into `src/ai/authoring/tools/impl/` (17 files, one per tool). Reuse current bodies, wire via `buildAuthoringTools(scope, …)` | All 17 tool schemas + execute bodies compile with new guards | 1.5 d |
| **T4** | Implement `redactSupersededToolOutputs` (R1–R11) + `invalidateMutatedReads` + unit tests | Green against fixtures | 1.0 d |
| **T5** | Implement `agent.ts` (`createAuthoringAgentStream`) wiring ToolLoopAgent + `prepareStep` + stop conditions | Single-mode happy path runs end-to-end against mocked LLM | 1.0 d |
| **T6** | Implement `focusedTask` tool (spawn nested ToolLoopAgent, stream events, summary-only return) + tests | Happy path + over-budget + abort all green | 1.0 d |
| **T7** | Rename server module: `server/main-agent/` → `server/authoring/`; strip regex routing; call `createAuthoringAgentStream` directly | API route lives under `/api/authoring/chat` | 0.5 d |
| **T8** | Frontend rename: `web/main-agent/` → `web/authoring/`; update `useChat` api; update data-part handlers to `data-authoring_*` | UI compiles and renders mode/scope from new part | 0.5 d |
| **T9** | Delete old dirs per §13 | Tree clean, CI green | 0.5 d |
| **T10** | Integration tests per §14.2 (7 scenarios) | All green | 1.5 d |
| **T11** | Context-budget tests + a 20-turn smoke test running against a real LLM provider (dev env) | Documented token usage stays within budget | 0.5 d |
| **T12** | Session storage migration: choose between wipe vs mark-and-hide per §12.3; implement migration SQL + release plan | Migration merged | 0.5 d |

**Total: ~10 engineer-days**.

Subtask dependencies:

```
T1 → T2, T3
T2 → T5
T3 → T5
T4 → T5
T5 → T6, T7, T10
T7 → T8
T8 → T9, T10
T10 → T11
```

T6 can parallelize with T7/T8 after T5 is green. T12 can run in parallel to any T after T1.

---

## 16. Acceptance Criteria

PR is mergeable when:

1. **Deletion complete** — all paths under §13 removed; repo search for `main-agent`, `dashboard-worker`, `view-worker`, `MainAgent`, `WorkerWorkflow` returns zero hits outside migration docs.
2. **Single agent loop** — exactly one call site creates a top-level `ToolLoopAgent`; the only other allowed instantiation is inside `focusedTask.execute`.
3. **All unit tests green** (§14.1).
4. **All integration tests green** (§14.2).
5. **Typecheck passes** (`tsc --noEmit`) with no `any` added by this refactor.
6. **Lint passes**.
7. **Context budget verified** — (§14.3 green) for 30-view fixtures; focused mode bounded regardless of dashboard size.
8. **Manual smoke** — run each of the 9 integration scenarios once against a real LLM provider in dev; record token usage per turn (`logs/authoring-smoke.md`).
9. **No behavior regression** on current demo dashboards (QA-verified against `fixtures/dashboards/*`).

Explicitly out of scope for this PR (tracked separately):

- Soft compaction (older turns summarized when history > 20K tokens). Listed as P1 in §18 of follow-up; add only if real sessions prove it's needed.
- Migrating prompt content beyond mode-section reorganization.
- Any LLM provider / model changes.
- Any UI component redesign — only rename + data-part key updates.

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scope regex misfires send authoring intent to `chat` mode | Fixture table in `scope.test.ts` locks regex behavior; product can tune by adding fixtures |
| `focusedTask` sub-agent abort leaks a partial draft | Sub-agent shares parent's `WorkingDraft` but parent controls `composePatch` — uncommitted staging is discarded by parent on abort |
| Redactor drops a field the model later depends on | Redacted payload preserves identity + status (`view_id`, `match_status`, etc.); model can re-read with a tool call; behavior is equivalent to "you read this earlier but it's superseded" |
| Session wipe surprises users | Option 2 (mark-and-hide) in §12.3 provides soft fallback |
| `prepareStep` recomputes scope too often (perf) | `computeAuthoringScope` is pure + cheap; memoize on `(messages.length, stepHistoryInTurn.length, focusedViewId)` if profiling shows cost |
| Tool execution guards are forgotten in focused mode | Guards are wired by `buildAuthoringTools({ scope })` centrally; no per-tool branching remains — compile-time catches omission |



