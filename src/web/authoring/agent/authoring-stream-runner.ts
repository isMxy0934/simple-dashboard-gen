"use client";

import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type {
  AuthoringApprovalEvent,
  AuthoringIntent,
} from "@/ai/authoring/contracts/tool-io";
import type { DashboardDocument } from "@/contracts";
import { drainAuthoringSseStream } from "@/web/authoring/agent/drain-sse-stream";

export interface AuthoringAgentRequestBody {
  chatSessionId: string;
  editingSessionId: string;
  dashboardId: string;
  focusedViewId: string | null;
  dashboard: DashboardDocument;
  baseVersion: number;
  approvalEvent: AuthoringApprovalEvent | null;
  intent: AuthoringIntent;
  messageText: string;
}

export interface AuthoringStreamCallbacks {
  onOpen: () => void;
  onEvent: (event: AgentEvent) => void;
  onDone: () => void;
  onAbort: () => void;
  onError: (error: Error) => void;
}

export async function runAuthoringAgentStream(input: {
  requestBody: AuthoringAgentRequestBody;
  signal: AbortSignal;
  callbacks: AuthoringStreamCallbacks;
}): Promise<void> {
  const response = await fetch("/api/authoring/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: input.signal,
    body: JSON.stringify(input.requestBody),
  });

  if (!response.ok || !response.body) {
    let detail = "";
    try {
      const payload = await response.clone().json();
      detail =
        typeof payload?.reason === "string"
          ? `: ${payload.reason}${payload.data ? ` ${JSON.stringify(payload.data)}` : ""}`
          : "";
    } catch {
      detail = "";
    }
    throw new Error(`Agent request failed (${response.status})${detail}.`);
  }

  input.callbacks.onOpen();

  try {
    await drainAuthoringSseStream(
      response.body,
      {
        onEvent: input.callbacks.onEvent,
        onDone: input.callbacks.onDone,
        onAbort: input.callbacks.onAbort,
        onError: input.callbacks.onError,
      },
      input.signal,
    );
  } catch (error) {
    throw new Error("Streaming failed", { cause: error });
  }
}
