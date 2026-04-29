import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringChatRequestBody,
  AuthoringIntent,
} from "@/ai/authoring/contracts/tool-io";

const ALLOWED_INTENTS: readonly AuthoringIntent[] = [
  "apply",
  "cancel",
  "ask-capability",
  "explore",
  "author",
];

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

export function isAuthoringIntent(value: unknown): value is AuthoringIntent {
  return typeof value === "string" && (ALLOWED_INTENTS as readonly string[]).includes(value);
}

export function isAuthoringApprovalEvent(
  value: unknown,
): value is AuthoringApprovalEvent {
  return (
    isRecord(value) &&
    typeof value.proposalId === "string" &&
    value.proposalId.trim().length > 0 &&
    (value.decision === "approve" || value.decision === "reject") &&
    typeof value.baseVersion === "number" &&
    Number.isInteger(value.baseVersion) &&
    value.baseVersion >= 0
  );
}

export function isAgentChatRequestBody(
  value: unknown,
): value is AuthoringChatRequestBody {
  return (
    isRecord(value) &&
    (value.workspaceId === undefined ||
      value.workspaceId === null ||
      typeof value.workspaceId === "string") &&
    typeof value.sessionId === "string" &&
    (value.dashboardId === undefined ||
      value.dashboardId === null ||
      typeof value.dashboardId === "string") &&
    (value.focusedViewId === undefined ||
      value.focusedViewId === null ||
      typeof value.focusedViewId === "string") &&
    (value.baseVersion === undefined ||
      (typeof value.baseVersion === "number" &&
        Number.isInteger(value.baseVersion) &&
        value.baseVersion >= 0)) &&
    (value.approvalEvent === undefined ||
      value.approvalEvent === null ||
      isAuthoringApprovalEvent(value.approvalEvent)) &&
    (value.intent === undefined ||
      value.intent === null ||
      isAuthoringIntent(value.intent)) &&
    Array.isArray(value.messages) &&
    isDashboardDocumentLike(value.dashboard)
  );
}
