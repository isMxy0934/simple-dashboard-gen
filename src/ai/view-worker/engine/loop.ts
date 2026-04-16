import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
} from "@/ai/main-agent/contracts/agent-contract";
import { summarizeAgentToolResult } from "@/ai/view-worker/tools/adapters";
import type { WorkerWorkflow } from "@/ai/view-worker/workflow";
import { buildMainAgentTools } from "@/ai/view-worker/tools/tools";
import type { MainAgentDependencies } from "@/ai/main-agent/engine/dependencies";
import {
  createWorkerAgentStreamCore,
  safeValidateWorkerMessagesCore,
} from "@/ai/shared/worker/loop-core";

export async function safeValidateMainAgentMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: MainAgentDependencies;
}) {
  return safeValidateWorkerMessagesCore({
    ...input,
    buildTools: (args) => buildMainAgentTools(args),
  });
}

export async function createWorkerAgentStream(input: {
  workflow: WorkerWorkflow;
  messages: MainAgentMessage[];
  originalMessages?: MainAgentMessage[];
  abortSignal?: AbortSignal;
  dependencies?: MainAgentDependencies;
  sessionId?: string;
}) {
  return createWorkerAgentStreamCore({
    workerId: "view-worker",
    instructions: input.workflow.instructions,
    tools: input.workflow.tools,
    activeTools: input.workflow.activeTools,
    messages: input.messages,
    originalMessages: input.originalMessages,
    abortSignal: input.abortSignal,
    dependencies: input.dependencies,
    sessionId: input.sessionId,
    summarizeToolResult: summarizeAgentToolResult,
  });
}
