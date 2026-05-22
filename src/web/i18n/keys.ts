export const I18N_KEYS = {
  errorAuthoringAgentTimeout: "error.authoring.agent_timeout",
  errorChartRenderFailed: "error.chart.render_failed",
  errorAuthRequired: "error.auth.required",
  errorAuthSessionExpired: "error.auth.session_expired",
  errorAuthPermissionDenied: "error.auth.permission_denied",
} as const;

export type I18nKey = (typeof I18N_KEYS)[keyof typeof I18N_KEYS];
