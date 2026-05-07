import type { AuthoringToolDefinition } from "@/ai/authoring/tools/definition";
import {
  extractAuthoringToolGateError,
  type AuthoringToolGateErrorSnapshot,
} from "@/ai/authoring/contracts/errors";

export type AuthoringToolErrorPhase =
  | "arguments"
  | "execution"
  | "unavailable";

export interface NormalizedAuthoringToolError {
  kind: "gate" | "invalid_arguments" | "runtime_error" | "unavailable";
  tool_name: string;
  phase: AuthoringToolErrorPhase;
  message: string;
  retryable: boolean;
  gate?: AuthoringToolGateErrorSnapshot;
  contract?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function formatAuthoringToolContract(
  definition: AuthoringToolDefinition | null | undefined,
): string {
  if (!definition?.contract) {
    return "";
  }

  const parts = [
    ...(definition.contract.parameters ?? []).map((line) => `parameters: ${line}`),
    ...(definition.contract.prohibited ?? []).map((line) => `do not provide: ${line}`),
    ...(definition.contract.preconditions ?? []).map((line) => `precondition: ${line}`),
  ];
  return parts.join(" ");
}

export function normalizeAuthoringToolError(input: {
  toolName: string;
  definition?: AuthoringToolDefinition | null;
  phase: AuthoringToolErrorPhase;
  error: unknown;
}): NormalizedAuthoringToolError {
  const gate = extractAuthoringToolGateError(input.error);
  const nestedGate =
    gate ??
    (typeof input.error === "object" && input.error !== null
      ? extractAuthoringToolGateError((input.error as { error?: unknown }).error)
      : null);
  if (nestedGate) {
    return {
      kind: "gate",
      tool_name: input.toolName,
      phase: input.phase,
      message: `${input.toolName} blocked: ${nestedGate.userSafeSummary} Recovery: ${nestedGate.recoveryHint}`,
      retryable: nestedGate.retryable,
      gate: nestedGate,
      contract: formatAuthoringToolContract(input.definition),
    };
  }

  const detail = errorMessage(input.error).trim() || "Unknown tool failure.";
  const contract =
    formatAuthoringToolContract(input.definition) ||
    input.definition?.description ||
    "";
  if (input.phase === "arguments") {
    const prefix = detail.startsWith(`Invalid ${input.toolName}`)
      ? detail
      : `Invalid ${input.toolName} arguments: ${detail}`;
    return {
      kind: "invalid_arguments",
      tool_name: input.toolName,
      phase: input.phase,
      message: [
        prefix,
        contract ? `Contract: ${contract}` : "",
      ].filter(Boolean).join(" "),
      retryable: true,
      contract,
    };
  }

  if (input.phase === "unavailable") {
    return {
      kind: "unavailable",
      tool_name: input.toolName,
      phase: input.phase,
      message: detail,
      retryable: true,
      contract,
    };
  }

  return {
    kind: "runtime_error",
    tool_name: input.toolName,
    phase: input.phase,
    message: [
      `${input.toolName} failed: ${detail}`,
      contract ? `Contract: ${contract}` : "",
    ].filter(Boolean).join(" "),
    retryable: true,
    contract,
  };
}

export function normalizedAuthoringToolErrorDetails(
  error: NormalizedAuthoringToolError,
): { error: AuthoringToolGateErrorSnapshot } | {
  error: {
    kind: Exclude<NormalizedAuthoringToolError["kind"], "gate">;
    tool_name: string;
    phase: AuthoringToolErrorPhase;
    message: string;
    retryable: boolean;
    contract?: string;
  };
} {
  if (error.kind === "gate" && error.gate) {
    return { error: error.gate };
  }

  const kind = error.kind === "gate" ? "runtime_error" : error.kind;

  return {
    error: {
      kind,
      tool_name: error.tool_name,
      phase: error.phase,
      message: error.message,
      retryable: error.retryable,
      ...(error.contract ? { contract: error.contract } : {}),
    },
  };
}
