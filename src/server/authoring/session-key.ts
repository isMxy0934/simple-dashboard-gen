export function buildMainAgentCompositeSessionId(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
}) {
  return [
    input.workspaceId.trim(),
    input.userId.trim(),
    input.dashboardId.trim(),
    input.sessionId.trim(),
  ].join(":");
}

export const buildAuthoringCompositeSessionId =
  buildMainAgentCompositeSessionId;
