# AI Layer

`ai/` contains agent, workflow, prompt, runtime, and tool logic.

Allowed here:

- Prompt construction
- Workflow routing
- Tool definitions
- Agent runtime contracts
- Message inspection and task sync helpers

Rules:

- Depend on `domain/`, `contracts/`, and `shared/`.
- Do not depend on `client/`, `components/`, or `app/`.
- Avoid server infrastructure coupling except thin operational integrations already required by runtime behavior.

Subareas:

- `ai/agent`: agent definitions and validation
- `ai/authoring`: authoring-specific AI logic
- `ai/runtime`: runtime contracts and message/task helpers
- `ai/skills`: skill registry and skill providers
- `ai/workflow`: workflow orchestration
