export const AUTHORING_TOOL_GATE_ERROR_CODES = [
  "missing_skill",
  "unsupported_view_type",
  "schema_mismatch",
  "binding_mismatch",
  "scope_violation",
  "no_semantic_change",
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
      /^\[(missing_skill|unsupported_view_type|schema_mismatch|binding_mismatch|scope_violation|no_semantic_change)\]\s+([\s\S]*?)\s+Recovery:\s+([\s\S]*)$/,
    );
    if (match) {
      return {
        code: match[1] as AuthoringToolGateErrorCode,
        userSafeSummary: match[2].trim(),
        recoveryHint: match[3].trim(),
        retryable: match[1] !== "unsupported_view_type",
      };
    }
  }

  return null;
}
