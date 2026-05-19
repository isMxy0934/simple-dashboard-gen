export const REPORT_PURPLE_THEME_ID = "report_purple";
export const REPORT_TEAL_THEME_ID = "report_teal";
export const LEGACY_DEFAULT_REPORT_THEME_ID = "default_report";

export const REGISTERED_DASHBOARD_THEME_IDS = [
  REPORT_PURPLE_THEME_ID,
  REPORT_TEAL_THEME_ID,
] as const;

export const LEGACY_DASHBOARD_THEME_IDS = [
  LEGACY_DEFAULT_REPORT_THEME_ID,
] as const;

export const DASHBOARD_THEME_IDS = [
  ...REGISTERED_DASHBOARD_THEME_IDS,
  ...LEGACY_DASHBOARD_THEME_IDS,
] as const;
