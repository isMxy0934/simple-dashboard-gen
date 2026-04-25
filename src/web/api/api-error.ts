interface ApiIssue {
  path?: string;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssue(issue: ApiIssue): string {
  return issue.path ? `${issue.path}: ${issue.message ?? "Invalid value"}` : issue.message ?? "Invalid value";
}

export function getApiErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (!isRecord(payload)) {
    return fallback;
  }

  const details = isRecord(payload.details) ? payload.details : null;
  const issues = Array.isArray(details?.issues)
    ? details.issues
    : isRecord(payload.data) && Array.isArray(payload.data.issues)
      ? payload.data.issues
      : [];
  const formattedIssues = issues
    .filter(isRecord)
    .map((issue) => formatIssue(issue))
    .filter(Boolean);
  if (formattedIssues.length > 0) {
    return formattedIssues.slice(0, 4).join("\n");
  }

  if (typeof details?.message === "string" && details.message.trim()) {
    return details.message;
  }

  if (typeof payload.reason === "string" && payload.reason.trim()) {
    return payload.reason;
  }

  return fallback;
}
