# Hermes Authoring Agent Runtime Baseline

This document is the current implementation baseline for the dashboard authoring
agent. Historical drafts live in `docs/archive/` and are kept for audit only.

## 1. Runtime Boundary

The authoring agent is built around a pi-agent runtime boundary:

- `pi-agent-core` owns the agent loop, model provider boundary, event stream,
  cancellation, and tool hook lifecycle.
- The application layer owns dashboard context, capability scope, runtime tool
  surface, approval gating, transaction tools, and persistence.
- The domain layer owns pure dashboard document operations and validation.
- The web layer owns local approval UI, message rendering, and session hydration.

The runtime does not expose low-level dashboard writes to the model. The model
can inspect state, stage a transaction, run validation, compose a patch, and
apply only a locally approved pending proposal.

## 2. Source Layout

The active authoring implementation is under `src/ai/authoring/`:

- `agent/`: session lifecycle, tool surface selection, event stream, hooks, and
  ledger events.
- `runtime/`: capability scope, transcript inspection, derived facts, context
  blocks, and tool result formatting.
- `tools/`: read tools, transaction tools, approval tools, schemas, and focused
  scope guards.
- `messages/`: system prompt sections selected by the runtime surface.
- `contracts/`: request, session, tool I/O, and runtime contracts.
- `skills/`: chart-skill guidance and deterministic builders used by
  transaction tools.

The surrounding layers are:

- `src/server/authoring/`: HTTP orchestration, chat session persistence, and
  server-side session keys.
- `src/web/authoring/agent/`: chat UI, local approval event emission, proposal
  rendering, and message pruning.
- `src/domain/`: pure `DashboardDocument` mutation and validation primitives.
- `src/renderers/`: renderer-specific materialization and runtime checks.

## 3. Turn Lifecycle

Each user turn follows one runtime path:

```text
sanitize transcript
derive conversation signals
computeAuthoringScope
buildSurfaceFromScope
apply selected tools and prompt to pi-agent
run pi-agent loop
record tool results through hooks
refresh scope and surface when needed
persist session snapshot and context fingerprint
```

`computeAuthoringScope` produces an `AuthoringScopeCapabilities` decision:

- `profile`: `chat`, `explore`, `author-dashboard`, `author-focused`, or
  `approval`.
- `scope`: dashboard, focused view, or empty.
- `allowedTools`: the canonical tools currently legal for the turn.
- `contextBlockVariant`: dashboard, focused, or empty context construction.
- `scopeResolution`: why the runtime selected that scope and whether the user
  must clarify.
- `stopReason`: terminal runtime state, currently used after approval apply.

`buildSurfaceFromScope` is the single surface derivation entrypoint. It does
not recompute scope. It receives the latest decision and maps it to:

- active tool names
- tool choice
- prompt sections
- surface mode
- optional surface reason

This keeps `scope`, `surface`, prompt, and selected pi tools in one closed loop.

## 4. Surface Priority

The surface builder uses this priority order:

1. `forceChatOnlyForTurn` returns terminal chat surface.
2. A matching local approval event exposes approval surface with `applyPatch`.
3. A non-matching approval event returns chat surface with `approval-mismatch`.
4. A reject event returns chat surface.
5. No allowed tools returns chat surface.
6. `explore` profile returns inspect surface filtered by `allowedTools`.
7. `author-dashboard` or `author-focused` returns author surface filtered by
   `allowedTools`.
8. Everything else falls back to chat surface.

`forceChatOnlyForTurn` has the highest priority. After successful `composePatch`
or `applyPatch`, later refreshes in the same turn must stay chat-only so the
agent cannot reopen author tools after reaching a terminal state.

## 5. Tool Surface

The canonical tool registry is the source of truth for tool names, category,
scope, and UI labels.

Inspect/read tools:

- `getViews`
- `getView`
- `getDatasources`
- `listDatasourceTables`
- `getTableSchema`
- `previewTableData`
- `getQuery`
- `getBinding`
- `getDraftStatus`
- `declareAuthoringGoal`

Author transaction tools:

- `runCheck`
- `stageChart`
- `stageDelete`
- `composePatch`

Approval tool:

- `applyPatch`

Inspect and author surfaces both respect `decision.allowedTools`. When
capability scope removes a tool, the selected pi tool set must remove it too.
The runtime never selects tools directly from the full registry after scope has
already made a decision.

## 6. Transaction Model

`stageChart` is the main write transaction for chart creation and revision. It
receives declarative chart intent and stages query, view, bindings, and layout
atomically. It does not let the model handwrite the dashboard contract.

`stageDelete` stages view deletion and dependent binding cleanup. It should be
used only when the user clearly requests or confirms deletion.

`runCheck` validates the staged `DashboardDocument`. It reports structured
contract, runtime, and renderer failures from the staged draft.

`composePatch` turns the working draft into a local approval proposal. It does
not apply the patch and does not make the dashboard visible to the user.

`applyPatch` applies a pending proposal only after the local approval event has
been verified against the pending proposal id, base version, and draft
fingerprint.

## 7. Approval Gate

Approval is local and exact:

- Text that looks like approval is not enough.
- `applyPatch` is exposed only when the request contains a local approval event
  and the event matches the pending proposal.
- The pending proposal id and base version must match.
- A draft fingerprint must be present.
- A stale, missing, or mismatched approval event returns chat surface with the
  `approval-mismatch` prompt section.
- Reject events return chat surface and never expose `applyPatch`.

The web client owns the approval card and sends the local approval event. The
server-side runtime independently verifies the event before exposing the
approval tool.

## 8. Context And Fingerprint

The runtime keeps an initial sanitized transcript before the pi-agent instance
exists. `runtimeMessages` reads from the live agent state when available and
falls back to that initial transcript before agent creation.

This makes transcript-derived behavior consistent before and after the agent is
created, including:

- approval context
- pending proposal lookup
- conversation signals
- capability scope recomputation

The context block is generated through `buildAuthoringContextBlock`. Each block
produces a fingerprint. `startTurn()` returns a dynamic `contextFingerprint`
getter so persistence reads the latest fingerprint produced during context
transformation, not the empty initial value.

## 9. Runtime Refresh And Tool Failures

Tool hooks record each tool result in `stepHistoryInTurn`:

- `ok` for successful tool results
- `error` for failed tool results

`applySurfaceToRuntime` recomputes capability scope with:

- the latest sanitized transcript
- current conversation signals
- current `stepHistoryInTurn`
- the locked profile from the beginning of the turn

Capability scope filters tools after three trailing consecutive failures for
the same tool. Because the refreshed surface is rebuilt from the filtered
decision, failed tools disappear from both the runtime surface and the pi-agent
tool set.

The locked profile prevents a normal turn from drifting between explore and
author modes during internal refreshes. Terminal states can still move to
chat-only when required.

## 10. Focused Scope

Focused mode restricts authoring to the selected view. Focused guards prevent a
patch from modifying unrelated views, bindings, queries, or layout entries.

The runtime can request clarification when a user asks for dashboard-level work
while a focused view is active. When scope cannot be resolved safely, the
surface is chat-only and uses the focused scope blocker prompt section.

## 11. Prompt Sections

The system prompt is assembled from surface-selected sections:

- `identity`
- `chat`
- `inspect`
- `authoring`
- `approval`
- `approval-mismatch`
- `focused-scope-blocker`
- `dashboard`
- `focused`

The prompt is a consequence of the runtime surface. Prompt sections should not
be used as an independent source of tool policy.

## 12. Ledger And Trace

The runtime writes trace events and ledger events for:

- surface preparation
- selected active tools
- tool calls and tool results
- patch composition
- patch application
- approval surface changes

The ledger is diagnostic. It does not replace runtime policy checks. Tool
selection and approval safety must be enforced before the model can call a
tool.

## 13. Reliability Invariants

These invariants define the current expected behavior:

- All runtime refreshes go through `computeAuthoringScope -> buildSurfaceFromScope
  -> apply tools and prompt`.
- The surface builder receives a decision and does not compute scope itself.
- Inspect and author surfaces use `decision.allowedTools`.
- `applyPatch` is approval-only and appears only for a matching local approval
  event.
- Approval mismatch is chat-only and explains that the pending proposal must be
  regenerated or reapproved.
- Successful `composePatch` or `applyPatch` makes the rest of the turn
  chat-only.
- `stepHistoryInTurn` is passed into scope recomputation so tool failure
  filtering affects the active pi-agent tool set.
- Context fingerprint persistence reads the latest generated fingerprint through
  a dynamic getter.
- The model never writes dashboard internals directly; it stages transactions
  and waits for validation and approval.

## 14. Verification Baseline

The expected local verification sequence is:

```bash
npm run typecheck
npm test
npm run build
```

`npm run typecheck` and `npm run build` should run serially because Next build
can recreate `.next/types` while typecheck is reading them.
