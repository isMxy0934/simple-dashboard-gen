export const CANONICAL_RUNTIME_DESIGN_KIT_ID = "report_runtime_v1" as const;
export const OPERATIONAL_REPORT_DESIGN_KIT_ID = "operational_report" as const;
export const EXECUTIVE_REPORT_DESIGN_KIT_ID = "executive_report" as const;
export const DASHBOARD_COLOR_THEME_ID_PURPLE = "purple" as const;
export const DASHBOARD_COLOR_THEME_ID_TEAL = "teal" as const;
export const DASHBOARD_VIEW_STYLE_ID_CLEAN = "clean" as const;
export const DASHBOARD_VIEW_STYLE_ID_GRADIENT = "gradient" as const;
export const DASHBOARD_VIEW_STYLE_ID_EMPHASIS = "emphasis" as const;

export const DASHBOARD_DESIGN_KIT_IDS = [
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
] as const;

export const DASHBOARD_COLOR_THEME_IDS = [
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_COLOR_THEME_ID_TEAL,
] as const;

export const DASHBOARD_VIEW_STYLE_IDS = [
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
] as const;
