import type {
  AgentEvent,
  AgentMessage,
} from "@mariozechner/pi-agent-core";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import { writeAuthoringTrace } from "@/ai/authoring/runtime/dependencies";
import {
  encodeAuthoringAgentProtocolEvent,
  type AuthoringAgentFinishPayload,
} from "@/ai/authoring/agent/protocol";

interface StreamableAuthoringAgent {
  state: {
    messages: AgentMessage[];
    errorMessage?: string | null;
  };
  abort: () => void;
  continue: () => Promise<void>;
  prompt: (text: string) => Promise<void>;
  subscribe: (handler: (event: AgentEvent) => void | Promise<void>) => void;
}

export function createAuthoringAgentEventStream(input: {
  agent: StreamableAuthoringAgent;
  promptText: string;
  sessionId?: string;
  abortSignal?: AbortSignal;
  wallClockTimeoutMs: number;
  dependencies: AuthoringDependencies;
  onFinish?: (payload: AuthoringAgentFinishPayload) => Promise<void> | void;
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      const wallTimer = setTimeout(() => {
        if (!finished) {
          input.agent.abort();
        }
      }, input.wallClockTimeoutMs);

      const abort = () => input.agent.abort();
      input.abortSignal?.addEventListener("abort", abort, { once: true });

      const fail = (error: unknown) => {
        finished = true;
        clearTimeout(wallTimer);
        input.abortSignal?.removeEventListener("abort", abort);
        controller.error(error);
      };

      input.agent.subscribe(async (event) => {
        try {
          await handleAgentEvent({
            event,
            controller,
            agent: input.agent,
            sessionId: input.sessionId,
            dependencies: input.dependencies,
            onFinish: input.onFinish,
            markFinished: () => {
              finished = true;
              clearTimeout(wallTimer);
              input.abortSignal?.removeEventListener("abort", abort);
            },
          });
        } catch (error) {
          fail(error);
          throw error;
        }
      });

      const run = input.promptText
        ? input.agent.prompt(input.promptText)
        : input.agent.continue();
      void run.catch(fail);
    },
    cancel() {
      input.agent.abort();
    },
  });
}

async function handleAgentEvent(input: {
  event: AgentEvent;
  controller: ReadableStreamDefaultController<Uint8Array>;
  agent: StreamableAuthoringAgent;
  sessionId?: string;
  dependencies: AuthoringDependencies;
  onFinish?: (payload: AuthoringAgentFinishPayload) => Promise<void> | void;
  markFinished: () => void;
}) {
  input.controller.enqueue(
    encodeAuthoringAgentProtocolEvent({
      protocol: "authoring-agent-v1",
      event: input.event,
    }),
  );

  if (input.event.type === "tool_execution_end") {
    await writeAuthoringTrace(
      input.dependencies,
      "authoring-agent",
      "tool_execution_end",
      {
        sessionId: input.sessionId,
        toolName: input.event.toolName,
        hasError: input.event.isError,
      },
    );
  }

  if (input.event.type !== "agent_end") {
    return;
  }

  input.markFinished();
  await writeAuthoringTrace(
    input.dependencies,
    "authoring-agent",
    "turn_finish",
    {
      sessionId: input.sessionId,
      messageCount: input.agent.state.messages.length,
      errorMessage: input.agent.state.errorMessage ?? null,
      lastMessageRole:
        input.agent.state.messages[input.agent.state.messages.length - 1]?.role ??
        null,
    },
  );
  await input.onFinish?.({
    agentMessages: input.agent.state.messages,
  });
  input.controller.close();
}
