export const AUTHORING_TOOL_GATE_ERROR_CODES = [
  "missing_skill",
  "unsupported_view_type",
  "schema_mismatch",
  "output_schema_mismatch",
  "binding_mismatch",
  "missing_layout",
  "stale_check",
  "scope_violation",
  "no_semantic_change",
  "approval_required",
  "approval_proposal_mismatch",
  "approval_base_version_mismatch",
  "approval_draft_fingerprint_missing",
  "approval_draft_fingerprint_mismatch",
] as const;

export type AuthoringToolGateErrorCode =
  (typeof AUTHORING_TOOL_GATE_ERROR_CODES)[number];

export interface AuthoringToolGateErrorSnapshot {
  code: AuthoringToolGateErrorCode;
  userSafeSummary: string;
  recoveryHint: string;
  retryable: boolean;
}

export class AuthoringToolGateError extends Error {
  readonly code: AuthoringToolGateErrorCode;
  readonly userSafeSummary: string;
  readonly recoveryHint: string;
  readonly retryable: boolean;

  constructor(input: AuthoringToolGateErrorSnapshot) {
    super(
      `[${input.code}] ${input.userSafeSummary} Recovery: ${input.recoveryHint}`,
    );
    this.name = "AuthoringToolGateError";
    this.code = input.code;
    this.userSafeSummary = input.userSafeSummary;
    this.recoveryHint = input.recoveryHint;
    this.retryable = input.retryable;
  }
}

export function isAuthoringToolGateErrorCode(
  value: unknown,
): value is AuthoringToolGateErrorCode {
  return (
    typeof value === "string" &&
    AUTHORING_TOOL_GATE_ERROR_CODES.includes(
      value as AuthoringToolGateErrorCode,
    )
  );
}

export function extractAuthoringToolGateError(
  value: unknown,
): AuthoringToolGateErrorSnapshot | null {
  if (value instanceof AuthoringToolGateError) {
    return {
      code: value.code,
      userSafeSummary: value.userSafeSummary,
      recoveryHint: value.recoveryHint,
      retryable: value.retryable,
    };
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      isAuthoringToolGateErrorCode(record.code) &&
      typeof record.userSafeSummary === "string" &&
      typeof record.recoveryHint === "string" &&
      typeof record.retryable === "boolean"
    ) {
      return {
        code: record.code,
        userSafeSummary: record.userSafeSummary,
        recoveryHint: record.recoveryHint,
        retryable: record.retryable,
      };
    }
  }

  if (typeof value === "string") {
    const match = value.match(
      /^\[(missing_skill|unsupported_view_type|schema_mismatch|output_schema_mismatch|binding_mismatch|missing_layout|stale_check|scope_violation|no_semantic_change|approval_required|approval_proposal_mismatch|approval_base_version_mismatch|approval_draft_fingerprint_missing|approval_draft_fingerprint_mismatch)\]\s+([\s\S]*?)\s+Recovery:\s+([\s\S]*)$/,
    );
    if (match) {
      const code = match[1] as AuthoringToolGateErrorCode;
      return {
        code,
        userSafeSummary: match[2].trim(),
        recoveryHint: match[3].trim(),
        retryable:
          code !== "unsupported_view_type" &&
          !code.startsWith("approval_"),
      };
    }
  }

  return null;
}
