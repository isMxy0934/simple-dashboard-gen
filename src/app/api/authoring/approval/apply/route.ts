import { handleAuthoringChatRoute } from "@/server/authoring/chat-service";
import type { DashboardDocument } from "@/contracts";
import type { ApplyPatchToolOutput } from "@/ai/authoring/contracts/tool-io";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardDocumentLike(value: unknown): value is DashboardDocument {
  return (
    isRecord(value) &&
    isRecord(value.dashboard_spec) &&
    Array.isArray(value.query_defs) &&
    Array.isArray(value.bindings)
  );
}

function isApplyPatchOutput(value: unknown): value is ApplyPatchToolOutput {
  return (
    isRecord(value) &&
    value.applied === true &&
    typeof value.suggestion_id === "string"
  );
}

async function collectApplyPatchOutput(response: Response) {
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output: ApplyPatchToolOutput | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame
          .split(/\r?\n/)
          .find((line) => line.startsWith("data: "));
        if (!dataLine) {
          continue;
        }
        const parsed = JSON.parse(dataLine.slice(6)) as {
          event?: {
            type?: string;
            toolName?: string;
            isError?: boolean;
            result?: { details?: unknown };
          };
        };
        const event = parsed.event;
        if (
          event?.type === "tool_execution_end" &&
          event.toolName === "applyPatch" &&
          !event.isError &&
          isApplyPatchOutput(event.result?.details)
        ) {
          output = event.result.details;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return output;
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.dashboardId !== "string" ||
    typeof payload.proposalId !== "string" ||
    payload.proposalId.trim().length === 0 ||
    typeof payload.baseVersion !== "number" ||
    !Number.isInteger(payload.baseVersion) ||
    payload.baseVersion < 0 ||
    typeof payload.currentDocumentHash !== "string" ||
    payload.currentDocumentHash.trim().length === 0 ||
    (payload.focusedViewId !== undefined &&
      payload.focusedViewId !== null &&
      typeof payload.focusedViewId !== "string") ||
    !isDashboardDocumentLike(payload.dashboard)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_APPROVAL_APPLY_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const requestDocumentHash = dashboardDocumentPersistenceFingerprint(payload.dashboard);
    if (requestDocumentHash !== payload.currentDocumentHash.trim()) {
      return Response.json(
        {
          status_code: 409,
          reason: "AUTHORING_APPROVAL_HASH_CONFLICT",
          data: {
            currentDocumentHash: payload.currentDocumentHash.trim(),
            requestDocumentHash,
          },
        },
        { status: 409 },
      );
    }

    const result = await handleAuthoringChatRoute(new Request(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        sessionId: payload.sessionId,
        dashboardId: payload.dashboardId,
        focusedViewId:
          typeof payload.focusedViewId === "string" ? payload.focusedViewId : null,
        dashboard: payload.dashboard,
        baseVersion: payload.baseVersion,
        approvalEvent: {
          proposalId: payload.proposalId.trim(),
          decision: "approve",
          baseVersion: payload.baseVersion,
        },
        intent: "apply",
        messageText: "Apply the approved staged patch.",
      }),
      signal: request.signal,
    }));

    if (!result.ok) {
      return result;
    }

    const output = await collectApplyPatchOutput(result);
    if (output) {
      return Response.json({
        status_code: 200,
        reason: "OK",
        data: output,
      });
    }

    return Response.json(
      {
        status_code: 409,
        reason: "AUTHORING_APPROVAL_APPLY_FAILED",
        data: null,
      },
      { status: 409 },
    );
  } catch (error) {
    return Response.json(
      {
        status_code: 409,
        reason:
          error instanceof Error
            ? error.message
            : "AUTHORING_APPROVAL_APPLY_FAILED",
        data: null,
      },
      { status: 409 },
    );
  }
}
