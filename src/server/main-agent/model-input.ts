import type { DashboardDocument } from "@/contracts";
import { createHash } from "crypto";
import {
  type MainAgentMessage,
  type DatasourceListItemSummary,
  type ViewCheckSnapshot,
} from "@/ai/main-agent/contracts/agent-contract";
import { buildWorkerContextBlock } from "@/ai/dashboard-worker/prompt";

function extractUserText(message: MainAgentMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function mergeLatestUserMessageWithContext(input: {
  messages: MainAgentMessage[];
  contextBlock: string;
}): MainAgentMessage[] {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message.role !== "user") {
      continue;
    }

    const userText = extractUserText(message);
    if (!userText) {
      return input.messages;
    }

    const mergedText = [
      "Context:",
      input.contextBlock,
      "",
      "User request:",
      userText,
    ].join("\n");

    const nextMessages = [...input.messages];
    nextMessages[index] = {
      ...message,
      parts: [
        { type: "text", text: mergedText },
        ...message.parts.filter((part) => part.type !== "text"),
      ],
    };
    return nextMessages;
  }

  return input.messages;
}

function buildContextFingerprint(contextBlock: string): string {
  return createHash("sha256").update(contextBlock).digest("hex");
}

export function buildMainAgentModelInput(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  messages: MainAgentMessage[];
  lastContextFingerprint?: string | null;
}): {
  messages: MainAgentMessage[];
  contextFingerprint: string;
  injectedContext: boolean;
} {
  const contextBlock = buildWorkerContextBlock({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    focusedViewId: input.focusedViewId,
    datasources: input.datasources,
    checks: input.checks,
  });
  const contextFingerprint = buildContextFingerprint(contextBlock);
  const shouldInjectContext =
    !input.lastContextFingerprint || input.lastContextFingerprint !== contextFingerprint;

  return {
    messages: shouldInjectContext
      ? mergeLatestUserMessageWithContext({
          messages: input.messages,
          contextBlock,
        })
      : input.messages,
    contextFingerprint,
    injectedContext: shouldInjectContext,
  };
}
