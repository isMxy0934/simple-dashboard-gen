import type { BindingResults, DashboardDocument } from "../../../contracts";
import type { MobileLayoutMode } from "../state/authoring-state";
import { reconcileDashboardDocumentContract } from "../../../domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "../../../domain/dashboard/document-fingerprint";
import { formatTimestamp } from "../../utils/time";
import { getApiErrorMessage } from "../../api/api-error";

export interface LoadedRemoteAuthoringState {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  message: string;
  version: number;
  updatedAt: string;
}

interface PublishValidationIssue {
  path?: string;
  message?: string;
}

interface PublishRendererCheck {
  status?: string;
  reason?: string;
  message?: string;
}

type PublishRendererChecks = Record<
  string,
  {
    server?: PublishRendererCheck;
    browser?: PublishRendererCheck;
  }
>;

export type PublishDashboardErrorKind =
  | "invalid-document"
  | "publish-check-failed";

export class PublishDashboardError extends Error {
  readonly kind: PublishDashboardErrorKind;
  readonly issueCount: number;
  readonly bindingErrorCount: number;
  readonly rendererErrorCount: number;
  readonly details: string[];

  constructor(input: {
    kind: PublishDashboardErrorKind;
    message: string;
    issueCount?: number;
    bindingErrorCount?: number;
    rendererErrorCount?: number;
    details?: string[];
  }) {
    super(input.message);
    this.name = "PublishDashboardError";
    this.kind = input.kind;
    this.issueCount = input.issueCount ?? 0;
    this.bindingErrorCount = input.bindingErrorCount ?? 0;
    this.rendererErrorCount = input.rendererErrorCount ?? 0;
    this.details = input.details ?? [];
  }
}

function summarizeValidationIssues(issues: PublishValidationIssue[]): string[] {
  return issues.slice(0, 3).map((issue) => {
    const message = issue.message?.trim() || "Invalid dashboard document.";
    return `Document structure: ${message}`;
  });
}

function summarizeBindingErrors(bindingResults: BindingResults | undefined): string[] {
  if (!bindingResults) {
    return [];
  }

  const details: string[] = [];
  Object.values(bindingResults).forEach((result) => {
    if (result.status !== "error" || details.length >= 3) {
      return;
    }

    const prefix = result.view_id ? `Card ${result.view_id}` : "Card data";
    details.push(`${prefix}: ${result.message ?? result.code ?? "Data check failed."}`);
  });

  return details;
}

function summarizeRendererErrors(rendererChecks: PublishRendererChecks | undefined): string[] {
  if (!rendererChecks) {
    return [];
  }

  const details: string[] = [];
  Object.entries(rendererChecks).forEach(([viewId, checks]) => {
    (["server", "browser"] as const).forEach((target) => {
      const check = checks[target];
      if (check?.status !== "error") {
        return;
      }

      details.push(
        `Card ${viewId}: ${check.message ?? check.reason ?? "Display check failed."}`,
      );
    });
  });

  return details.slice(0, 3);
}

function countBindingErrors(bindingResults: BindingResults | undefined): number {
  return Object.values(bindingResults ?? {}).filter(
    (result) => result.status === "error",
  ).length;
}

function countRendererErrors(rendererChecks: PublishRendererChecks | undefined): number {
  return Object.values(rendererChecks ?? {}).reduce((count, checks) => {
    const serverError = checks.server?.status === "error" ? 1 : 0;
    const browserError = checks.browser?.status === "error" ? 1 : 0;
    return count + serverError + browserError;
  }, 0);
}

export async function loadRemoteAuthoringState(
  input: {
    workspaceId: string;
    dashboardId: string;
  },
): Promise<LoadedRemoteAuthoringState> {
  const response = await fetch(
    `/api/dashboards/${input.dashboardId}?mode=authoring&workspaceId=${encodeURIComponent(input.workspaceId)}`,
    {
    cache: "no-store",
    },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      document: DashboardDocument;
      version: number;
      updated_at: string;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.document) {
    throw new Error(payload.reason || "Unable to load dashboard.");
  }

  const restoredDashboard = reconcileDashboardDocumentContract(payload.data.document, {
    mobileLayoutMode: "custom",
  });
  return {
    dashboard: restoredDashboard,
    selectedViewId: null,
    mobileLayoutMode: "custom",
    message: `Loaded dashboard v${payload.data.version} from ${formatTimestamp(payload.data.updated_at)}.`,
    version: payload.data.version,
    updatedAt: payload.data.updated_at,
  };
}

export async function saveRemoteDashboardDraft(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  expectedDraftVersion: number;
  expectedDocumentHash: string;
  dashboard: DashboardDocument;
  force?: boolean;
}): Promise<{ version: number; savedAt: string; changed: boolean }> {
  const response = await fetch("/api/dashboard/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      expectedDraftVersion: input.expectedDraftVersion,
      expectedDocumentHash: input.expectedDocumentHash,
      force: input.force ?? false,
      draft: input.dashboard,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      version: number;
      saved_at: string;
      changed?: boolean;
    } | null;
  };

  if (payload.status_code === 409) {
    const conflict = new Error(payload.reason || "Dashboard draft is stale.");
    conflict.name = "DraftVersionConflictError";
    throw conflict;
  }

  if (payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to save dashboard.");
  }

  return {
    version: payload.data.version,
    savedAt: payload.data.saved_at,
    changed: payload.data.changed ?? true,
  };
}

export async function publishRemoteDashboard(input: {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  draftVersion: number;
  documentHash: string;
}): Promise<{ version: number; publishedAt: string; changed: boolean }> {
  const response = await fetch("/api/dashboard/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dashboardId: input.dashboardId,
      sessionId: input.sessionId,
      draftVersion: input.draftVersion,
      documentHash: input.documentHash,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?:
      | {
          version: number;
          published_at: string;
          changed?: boolean;
        }
      | {
          issues?: PublishValidationIssue[];
        }
      | {
          binding_results?: BindingResults;
          renderer_checks?: PublishRendererChecks;
        }
      | null;
  };

  if (payload.status_code === 409) {
    const conflict = new Error(payload.reason || "Dashboard publish is stale.");
    conflict.name = "PublishVersionConflictError";
    throw conflict;
  }

  if (
    payload.status_code === 400 &&
    payload.reason === "INVALID_DASHBOARD_DOCUMENT"
  ) {
    const issues = Array.isArray((payload.data as { issues?: unknown } | null)?.issues)
      ? ((payload.data as { issues: PublishValidationIssue[] }).issues)
      : [];
    throw new PublishDashboardError({
      kind: "invalid-document",
      message: payload.reason,
      issueCount: issues.length,
      details: summarizeValidationIssues(issues),
    });
  }

  if (payload.status_code === 422 && payload.reason === "PUBLISH_CHECK_FAILED") {
    const checkData = payload.data as {
      binding_results?: BindingResults;
      renderer_checks?: PublishRendererChecks;
    } | null;
    const bindingDetails = summarizeBindingErrors(checkData?.binding_results);
    const rendererDetails = summarizeRendererErrors(checkData?.renderer_checks);
    throw new PublishDashboardError({
      kind: "publish-check-failed",
      message: payload.reason,
      bindingErrorCount: countBindingErrors(checkData?.binding_results),
      rendererErrorCount: countRendererErrors(checkData?.renderer_checks),
      details: [...bindingDetails, ...rendererDetails].slice(0, 3),
    });
  }

  if (payload.status_code !== 200 || !payload.data) {
    throw new Error(getApiErrorMessage(payload, "Unable to publish dashboard."));
  }

  const published = payload.data as {
    version: number;
    published_at: string;
    changed?: boolean;
  };

  return {
    version: published.version,
    publishedAt: published.published_at,
    changed: published.changed ?? true,
  };
}

export function dashboardDraftDocumentHash(document: DashboardDocument): string {
  return dashboardDocumentPersistenceFingerprint(document);
}
