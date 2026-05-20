import type { JsonArray, JsonObject, JsonValue } from "@/contracts/dashboard";
import {
  LEGACY_DEFAULT_REPORT_THEME_ID,
  REPORT_PURPLE_THEME_ID,
  REPORT_TEAL_THEME_ID,
} from "@/contracts/dashboard-presentation";

export {
  LEGACY_DEFAULT_REPORT_THEME_ID,
  REPORT_PURPLE_THEME_ID,
  REPORT_TEAL_THEME_ID,
} from "@/contracts/dashboard-presentation";

export interface DashboardTheme {
  id: string;
  nameKey: string;
  surface: "report" | "standard";
  shell: {
    pageBg: string;
    headerBg: string;
    headerStrong: string;
    headerText: string;
    headerMuted: string;
    cardBg: string;
    cardBorder: string;
    cardHeaderBorder: string;
    cardDescription: string;
    cardShadow: string;
    controlBg: string;
    controlBorder: string;
    controlText: string;
    controlHoverBg: string;
    controlActiveBg: string;
    controlActiveText: string;
  };
  chart: {
    palette: string[];
    primary: string;
    primaryHover: string;
    primarySoft: string;
    current: string;
    currentSoft: string;
    forecast: string;
    success: string;
    warning: string;
    track: string;
    text: string;
    muted: string;
    grid: string;
    axisLine: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipExtraCssText: string;
    onAccent: string;
    fontFamily: string;
  };
}

export type DashboardThemeTokenPath =
  | `shell.${Exclude<keyof DashboardTheme["shell"], symbol>}`
  | `chart.${Exclude<keyof Omit<DashboardTheme["chart"], "palette">, symbol>}`
  | `chart.palette.${number}`;

export interface DashboardThemeRef extends JsonObject {
  $theme: DashboardThemeTokenPath;
}

// Theme display names use authoring.topbar.themeReport* i18n keys; runtime styling
// is injected as --dashboard-theme-* via dashboardThemeCssVariables(). Global
// --report-purple tokens remain for non-report surfaces (login, management, authoring).
const REPORT_PURPLE_THEME: DashboardTheme = {
  id: REPORT_PURPLE_THEME_ID,
  nameKey: "authoring.topbar.themeReportPurple",
  surface: "report",
  shell: {
    pageBg: "#edf0f4",
    headerBg: "#542c8f",
    headerStrong: "#40206f",
    headerText: "#ffffff",
    headerMuted: "rgba(255, 255, 255, 0.74)",
    cardBg: "#ffffff",
    cardBorder: "rgba(30, 23, 43, 0.11)",
    cardHeaderBorder: "rgba(30, 23, 43, 0.1)",
    cardDescription: "#746b83",
    cardShadow:
      "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 22px rgba(15, 23, 42, 0.06)",
    controlBg: "#f4f0fb",
    controlBorder: "rgba(84, 44, 143, 0.18)",
    controlText: "#2c2050",
    controlHoverBg: "rgba(255, 255, 255, 0.82)",
    controlActiveBg: "#542c8f",
    controlActiveText: "#ffffff",
  },
  chart: {
    palette: ["#3176d3", "#5b2e91", "#c98309", "#2f8d83", "#8a6a14"],
    primary: "#3176d3",
    primaryHover: "#2d6cc4",
    primarySoft: "rgba(49, 118, 211, 0.08)",
    current: "#5b2e91",
    currentSoft: "rgba(84, 44, 143, 0.1)",
    forecast: "#c98309",
    success: "#2f8d83",
    warning: "#bd8a2e",
    track: "#ece7f6",
    text: "#17131f",
    muted: "#776f85",
    grid: "#dde3ec",
    axisLine: "#d7dee9",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(30, 23, 43, 0.12)",
    tooltipExtraCssText:
      "box-shadow:0 10px 28px rgba(15,23,42,.12);border-radius:8px;",
    onAccent: "#ffffff",
    fontFamily: "IBM Plex Sans, PingFang SC, sans-serif",
  },
};

const REPORT_TEAL_THEME: DashboardTheme = {
  id: REPORT_TEAL_THEME_ID,
  nameKey: "authoring.topbar.themeReportTeal",
  surface: "report",
  shell: {
    pageBg: "#eef2f1",
    headerBg: "#0f5f60",
    headerStrong: "#0a494a",
    headerText: "#ffffff",
    headerMuted: "rgba(255, 255, 255, 0.76)",
    cardBg: "#ffffff",
    cardBorder: "rgba(15, 70, 72, 0.12)",
    cardHeaderBorder: "rgba(15, 70, 72, 0.11)",
    cardDescription: "#637774",
    cardShadow:
      "0 1px 2px rgba(10, 39, 42, 0.05), 0 8px 22px rgba(10, 39, 42, 0.06)",
    controlBg: "#e8f4f3",
    controlBorder: "rgba(15, 95, 96, 0.18)",
    controlText: "#174b4c",
    controlHoverBg: "rgba(255, 255, 255, 0.84)",
    controlActiveBg: "#0f5f60",
    controlActiveText: "#ffffff",
  },
  chart: {
    palette: ["#287bc8", "#0f766e", "#b7791f", "#6d5bd0", "#2f855a"],
    primary: "#287bc8",
    primaryHover: "#226eb5",
    primarySoft: "rgba(40, 123, 200, 0.09)",
    current: "#0f766e",
    currentSoft: "rgba(15, 118, 110, 0.1)",
    forecast: "#b7791f",
    success: "#2f855a",
    warning: "#b7791f",
    track: "#dcefeb",
    text: "#132525",
    muted: "#637774",
    grid: "#dbe5e6",
    axisLine: "#cfdbdc",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(15, 70, 72, 0.13)",
    tooltipExtraCssText:
      "box-shadow:0 10px 28px rgba(10,39,42,.13);border-radius:8px;",
    onAccent: "#ffffff",
    fontFamily: "IBM Plex Sans, PingFang SC, sans-serif",
  },
};

const DASHBOARD_THEMES = [REPORT_PURPLE_THEME, REPORT_TEAL_THEME] satisfies DashboardTheme[];

export function getDefaultDashboardThemeId(): string {
  return REPORT_PURPLE_THEME_ID;
}

export function listDashboardThemes(): DashboardTheme[] {
  return DASHBOARD_THEMES.map((theme) => ({
    ...theme,
    shell: { ...theme.shell },
    chart: {
      ...theme.chart,
      palette: [...theme.chart.palette],
    },
  }));
}

export function resolveDashboardTheme(themeId?: string | null): DashboardTheme {
  const normalized = themeId?.trim();
  const resolvedId =
    normalized === LEGACY_DEFAULT_REPORT_THEME_ID || !normalized
      ? REPORT_PURPLE_THEME_ID
      : normalized;
  const theme =
    DASHBOARD_THEMES.find((candidate) => candidate.id === resolvedId) ??
    REPORT_PURPLE_THEME;

  return {
    ...theme,
    shell: { ...theme.shell },
    chart: {
      ...theme.chart,
      palette: [...theme.chart.palette],
    },
  };
}

export function dashboardThemeRef(path: DashboardThemeTokenPath): DashboardThemeRef {
  return { $theme: path };
}

export function dashboardThemeCssVariables(
  themeId?: string | null,
): Record<`--${string}`, string> {
  const theme = resolveDashboardTheme(themeId);
  return {
    "--dashboard-theme-bg": theme.shell.pageBg,
    "--dashboard-theme-header": theme.shell.headerBg,
    "--dashboard-theme-header-strong": theme.shell.headerStrong,
    "--dashboard-theme-header-text": theme.shell.headerText,
    "--dashboard-theme-header-muted": theme.shell.headerMuted,
    "--dashboard-theme-control": theme.shell.controlBg,
    "--dashboard-theme-control-border": theme.shell.controlBorder,
    "--dashboard-theme-control-text": theme.shell.controlText,
    "--dashboard-theme-control-hover": theme.shell.controlHoverBg,
    "--dashboard-theme-control-active-bg": theme.shell.controlActiveBg,
    "--dashboard-theme-control-active-text": theme.shell.controlActiveText,
    "--dashboard-theme-card": theme.shell.cardBg,
    "--dashboard-theme-card-border": theme.shell.cardBorder,
    "--dashboard-theme-card-header-border": theme.shell.cardHeaderBorder,
    "--dashboard-theme-card-description": theme.shell.cardDescription,
    "--dashboard-theme-shadow": theme.shell.cardShadow,
    "--dashboard-theme-accent-soft": theme.chart.currentSoft,
  };
}

export function resolveDashboardThemeToken(
  theme: DashboardTheme,
  path: DashboardThemeTokenPath,
): string {
  const parts = path.split(".");
  if (parts[0] === "chart" && parts[1] === "palette") {
    const index = Number(parts[2]);
    return Number.isInteger(index)
      ? theme.chart.palette[index] ?? theme.chart.primary
      : theme.chart.primary;
  }

  if (parts[0] === "chart" && parts[1] && parts[1] in theme.chart) {
    const value = theme.chart[parts[1] as keyof DashboardTheme["chart"]];
    return Array.isArray(value) ? value[0] ?? theme.chart.primary : value;
  }

  if (parts[0] === "shell" && parts[1] && parts[1] in theme.shell) {
    return theme.shell[parts[1] as keyof DashboardTheme["shell"]];
  }

  return theme.chart.primary;
}

export function resolveDashboardThemeRefs<T extends JsonValue>(
  value: T,
  themeId?: string | null,
): T {
  const theme = resolveDashboardTheme(themeId);
  return resolveDashboardThemeRefsWithTheme(value, theme) as T;
}

export function resolveDashboardThemeRefsWithTheme(
  value: JsonValue,
  theme: DashboardTheme,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveDashboardThemeRefsWithTheme(entry, theme),
    ) as JsonArray;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (isDashboardThemeRef(value)) {
    return resolveDashboardThemeToken(theme, value.$theme);
  }

  const next: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] =
      entry === undefined
        ? undefined
        : resolveDashboardThemeRefsWithTheme(entry, theme);
  }
  return next;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardThemeRef(value: JsonObject): value is DashboardThemeRef {
  const keys = Object.keys(value);
  return keys.length === 1 && typeof value.$theme === "string";
}
