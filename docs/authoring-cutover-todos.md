# Authoring Cutover TODOs

Status snapshot after the non-test cleanup pass.

## TODO 1: Intent routing and scope drift

- Status: done
- Changes:
  - Replaced scattered regex branches with a centralized intent catalog in [src/ai/authoring/scope.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/scope.ts)
  - Removed implicit title-substring auto-focus
  - Stabilized scope across a turn with `stabilizeAuthoringScopeDecision`

## TODO 2: Write-side tool factory extraction

- Status: done
- Changes:
  - Moved write-side tool builders into [src/ai/authoring/tools/write-tools.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/tools/write-tools.ts)
  - [src/ai/authoring/tools/index.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/tools/index.ts) now focuses on shared state and scoped tool wiring

## TODO 3: applyPatch single source of truth

- Status: done
- Changes:
  - `applyPatch` now applies only from the current working draft
  - Removed use of `draftOutput.suggestion.dashboard` as a candidate source
  - Removed synthetic suggestion id fallback

## TODO 4: Persist lastRunCheckState

- Status: done
- Changes:
  - Added `lastRunCheckState` to authoring session prompt state in [src/ai/authoring/contracts/session-state.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/contracts/session-state.ts)
  - Persisted through the authoring chat session orchestrator

## TODO 5: Required runtime dependencies

- Status: done
- Changes:
  - Made runtime-critical fields in [src/ai/authoring/engine/dependencies.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/engine/dependencies.ts) required
  - Validation uses an explicit validation-only dependency provider instead of silent optionals

## TODO 6: Annotate instead of destructive redact

- Status: done
- Changes:
  - [src/ai/authoring/messages/redact.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/messages/redact.ts) now annotates superseded outputs
  - [src/ai/authoring/messages/invalidate-on-mutation.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/messages/invalidate-on-mutation.ts) now annotates stale outputs without dropping payloads

## TODO 7: Step budget tuning

- Status: done
- Changes:
  - Top-level authoring agent cap raised to 20 steps in [src/ai/authoring/agent.ts](/Users/mu/Desktop/simple-dashboard-gen/src/ai/authoring/agent.ts)

## TODO 8: Remove implicit auto-focus

- Status: done
- Changes:
  - Authoring focus now only follows explicit `focusedViewId`
  - Title substring matching was removed from scope resolution
