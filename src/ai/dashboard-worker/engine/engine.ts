import type {
  UIMessageStreamOnFinishCallback,
  UIMessageStreamOnStepFinishCallback,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
  MainAgentSkillSummary,
  ViewCheckSnapshot,
} from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentWorkingDraftSnapshot } from "@/ai/main-agent/contracts/session-state";
import { buildViewListSummary } from "@/ai/dashboard-worker/context";
import type { MainAgentDependencies } from "@/ai/main-agent/engine/dependencies";
import { createWorkerAgentStream } from "@/ai/dashboard-worker/engine/loop";
import {
  buildWorkerConversationReply,
  createWorkerWorkflow,
} from "@/ai/dashboard-worker/workflow";
import { createWorkerEngineStreamCore } from "@/ai/shared/worker/engine-core";

export async function createWorkerEngineStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: MainAgentSkillSummary[] | null;
  messages: MainAgentMessage[];
  modelMessages?: MainAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: MainAgentWorkingDraftSnapshot | null;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<MainAgentMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<MainAgentMessage>;
  dependencies?: MainAgentDependencies;
}) {
  return createWorkerEngineStreamCore({
    workerTraceScope: "dashboard-engine",
    ...input,
    buildWorkflow: (args) => createWorkerWorkflow(args),
    createAgentStream: (args) => createWorkerAgentStream(args),
    buildViewSummary: (args) =>
      buildViewListSummary({
        document: args.document,
        dashboardId: args.dashboardId,
        checks: args.checks,
      }),
    buildConversationReply: (args) => buildWorkerConversationReply(args),
  });
}
