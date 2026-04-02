export type RendererValidationTarget = "server" | "browser";
export type RendererValidationStatus = "ok" | "warning" | "error" | "unknown";

export interface RendererValidationCheck {
  target: RendererValidationTarget;
  status: RendererValidationStatus;
  reason: string;
  message?: string;
}

export interface RendererValidationChecks {
  server: RendererValidationCheck;
  browser: RendererValidationCheck;
}

export type RendererChecksByView = Record<string, Partial<RendererValidationChecks>>;

export function createUnknownRendererCheck(
  target: RendererValidationTarget,
  reason = "Renderer validation has not run yet.",
): RendererValidationCheck {
  return {
    target,
    status: "unknown",
    reason,
  };
}

export function normalizeRendererValidationChecks(
  checks?: Partial<RendererValidationChecks> | null,
): RendererValidationChecks {
  return {
    server:
      checks?.server ??
      createUnknownRendererCheck("server", "Server renderer validation has not run yet."),
    browser:
      checks?.browser ??
      createUnknownRendererCheck("browser", "Browser renderer validation has not run yet."),
  };
}

export function summarizeRendererValidationChecks(
  checks?: Partial<RendererValidationChecks> | null,
): {
  status: RendererValidationStatus;
  reason: string;
} {
  const normalized = normalizeRendererValidationChecks(checks);
  const orderedChecks = [normalized.browser, normalized.server];

  const errorCheck = orderedChecks.find((check) => check.status === "error");
  if (errorCheck) {
    return {
      status: "error",
      reason: errorCheck.message ?? errorCheck.reason,
    };
  }

  const warningCheck = orderedChecks.find((check) => check.status === "warning");
  if (warningCheck) {
    return {
      status: "warning",
      reason: warningCheck.message ?? warningCheck.reason,
    };
  }

  const okChecks = orderedChecks.filter((check) => check.status === "ok");
  if (okChecks.length > 0) {
    return {
      status: "ok",
      reason:
        okChecks.length === 2
          ? "Server and browser renderer validation passed."
          : okChecks[0]?.reason ?? "Renderer validation passed.",
    };
  }

  return {
    status: "unknown",
    reason: normalized.browser.reason,
  };
}
