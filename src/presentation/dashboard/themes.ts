import type { JsonArray, JsonObject, JsonValue } from "@/contracts/dashboard";
import {
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_COLOR_THEME_ID_TEAL,
  DASHBOARD_COLOR_THEME_IDS,
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  DASHBOARD_VIEW_STYLE_IDS,
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
  type DashboardColorThemeId,
  type DashboardDesignKitId,
  type DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";
import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import { listTemplateCapabilityRecipeIds } from "@/contracts/dashboard-template-capability-registry";
import { CANONICAL_DASHBOARD_TEMPLATE_ID } from "@/contracts/dashboard-templates";

export {
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_COLOR_THEME_ID_TEAL,
  DASHBOARD_COLOR_THEME_IDS,
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  DASHBOARD_VIEW_STYLE_IDS,
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
  type DashboardColorThemeId,
  type DashboardDesignKitId,
  type DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";

export interface DashboardShellTokens {
  pageBg: string;
  shellBg: string;
  shellBorder: string;
  shellShadow: string;
  canvasBg: string;
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
  controlBarBg: string;
  controlBarBorder: string;
  controlBarText: string;
  controlBarMuted: string;
  controlBarItemBg: string;
  controlBarItemBorder: string;
  controlBarItemHoverBg: string;
  controlBarItemActiveBg: string;
  controlBarItemActiveText: string;
  controlBarActionBg: string;
  controlBarShadow: string;
  controlBarBackdrop: string;
  statusReadyBg: string;
  statusReadyText: string;
  statusReadyDot: string;
}

export interface DashboardChartTokens {
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
}

export interface DashboardColorTheme {
  id: DashboardColorThemeId;
  nameKey: string;
  shell: DashboardShellTokens;
  chart: DashboardChartTokens;
}

export interface DashboardViewStyle {
  id: DashboardViewStyleId;
  nameKey: string;
  descriptionKey: string;
  emphasisLevel: "quiet" | "polished" | "presentation";
  supportedRecipeIds: EChartsStageChartRecipeId[];
}

export interface DashboardDesignKit {
  id: DashboardDesignKitId;
  nameKey: string;
  surface: "report" | "standard";
  density: "compact" | "comfortable";
  cardChrome: "report" | "standard";
  defaultColorThemeId: DashboardColorThemeId;
  defaultViewStyleId: DashboardViewStyleId;
  colorThemes: DashboardColorTheme[];
  viewStyles: DashboardViewStyle[];
}

export interface DashboardResolvedTheme {
  id: DashboardColorThemeId;
  designKitId: DashboardDesignKitId;
  nameKey: string;
  surface: DashboardDesignKit["surface"];
  density: DashboardDesignKit["density"];
  cardChrome: DashboardDesignKit["cardChrome"];
  shell: DashboardShellTokens;
  chart: DashboardChartTokens;
}

export type DashboardTheme = DashboardResolvedTheme;

export type DashboardThemeTokenPath =
  | `shell.${Exclude<keyof DashboardShellTokens, symbol>}`
  | `chart.${Exclude<keyof Omit<DashboardChartTokens, "palette">, symbol>}`
  | `chart.palette.${number}`;

export interface DashboardThemeRef extends JsonObject {
  $theme: DashboardThemeTokenPath;
}

const SUPPORTED_REPORT_RECIPE_IDS =
  listTemplateCapabilityRecipeIds(CANONICAL_DASHBOARD_TEMPLATE_ID);

const PURPLE_THEME: DashboardColorTheme = {
  id: DASHBOARD_COLOR_THEME_ID_PURPLE,
  nameKey: "authoring.topbar.colorThemePurple",
  shell: {
    pageBg: "#edf0f4",
    shellBg: "#f8f6f2",
    shellBorder: "rgba(42, 30, 60, 0.14)",
    shellShadow:
      "0 1px 2px rgba(15, 23, 42, 0.06), 0 24px 60px rgba(30, 23, 43, 0.12)",
    canvasBg: "#f8f6f2",
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
    controlBarBg: "#4a2678",
    controlBarBorder: "rgba(255, 255, 255, 0.18)",
    controlBarText: "#ffffff",
    controlBarMuted: "rgba(255, 255, 255, 0.72)",
    controlBarItemBg: "rgba(255, 255, 255, 0.1)",
    controlBarItemBorder: "rgba(255, 255, 255, 0.22)",
    controlBarItemHoverBg: "rgba(255, 255, 255, 0.16)",
    controlBarItemActiveBg: "#e8dcff",
    controlBarItemActiveText: "#2f1a57",
    controlBarActionBg: "#f7f1ff",
    controlBarShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 rgba(31, 18, 52, 0.2)",
    controlBarBackdrop: "blur(14px) saturate(1.18)",
    statusReadyBg: "rgba(255, 255, 255, 0.1)",
    statusReadyText: "#ffffff",
    statusReadyDot: "#4fd1c5",
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

const TEAL_THEME: DashboardColorTheme = {
  id: DASHBOARD_COLOR_THEME_ID_TEAL,
  nameKey: "authoring.topbar.colorThemeTeal",
  shell: {
    pageBg: "#eef2f1",
    shellBg: "#f7f8f4",
    shellBorder: "rgba(15, 70, 72, 0.14)",
    shellShadow:
      "0 1px 2px rgba(10, 39, 42, 0.06), 0 24px 60px rgba(10, 39, 42, 0.12)",
    canvasBg: "#f7f8f4",
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
    controlBarBg: "#0d5356",
    controlBarBorder: "rgba(255, 255, 255, 0.2)",
    controlBarText: "#ffffff",
    controlBarMuted: "rgba(255, 255, 255, 0.74)",
    controlBarItemBg: "rgba(255, 255, 255, 0.1)",
    controlBarItemBorder: "rgba(255, 255, 255, 0.24)",
    controlBarItemHoverBg: "rgba(255, 255, 255, 0.16)",
    controlBarItemActiveBg: "#d9f3f0",
    controlBarItemActiveText: "#0d3b3d",
    controlBarActionBg: "#eefcf9",
    controlBarShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 rgba(4, 43, 45, 0.22)",
    controlBarBackdrop: "blur(14px) saturate(1.18)",
    statusReadyBg: "rgba(255, 255, 255, 0.1)",
    statusReadyText: "#ffffff",
    statusReadyDot: "#5eead4",
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

const CANONICAL_PURPLE_THEME: DashboardColorTheme = {
  id: DASHBOARD_COLOR_THEME_ID_PURPLE,
  nameKey: "authoring.topbar.colorThemePurple",
  shell: {
    pageBg: "#edf1f6",
    shellBg: "#f8f6f2",
    shellBorder: "rgba(30, 23, 43, 0.12)",
    shellShadow:
      "0 1px 2px rgba(15, 23, 42, 0.05), 0 24px 60px rgba(15, 23, 42, 0.10)",
    canvasBg: "#f8f6f2",
    headerBg: "#542c8f",
    headerStrong: "#452273",
    headerText: "#ffffff",
    headerMuted: "rgba(255, 255, 255, 0.72)",
    cardBg: "#ffffff",
    cardBorder: "#dfe5ef",
    cardHeaderBorder: "#dfe5ef",
    cardDescription: "#7c738a",
    cardShadow:
      "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 18px rgba(15, 23, 42, 0.05)",
    controlBg: "#ffffff",
    controlBorder: "#dfe5ef",
    controlText: "#211b2b",
    controlHoverBg: "#f6f3fb",
    controlActiveBg: "#542c8f",
    controlActiveText: "#ffffff",
    controlBarBg: "#4a2678",
    controlBarBorder: "rgba(255, 255, 255, 0.18)",
    controlBarText: "#ffffff",
    controlBarMuted: "rgba(255, 255, 255, 0.72)",
    controlBarItemBg: "rgba(255, 255, 255, 0.10)",
    controlBarItemBorder: "rgba(255, 255, 255, 0.22)",
    controlBarItemHoverBg: "rgba(255, 255, 255, 0.16)",
    controlBarItemActiveBg: "#ffffff",
    controlBarItemActiveText: "#2f1a57",
    controlBarActionBg: "#ffffff",
    controlBarShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 rgba(31, 18, 52, 0.2)",
    controlBarBackdrop: "blur(14px) saturate(1.18)",
    statusReadyBg: "#f7fafc",
    statusReadyText: "#4f5b70",
    statusReadyDot: "#2f8d83",
  },
  chart: {
    palette: ["#3176d3", "#5b2e91", "#c78a20", "#2f8d83", "#8a6a14"],
    primary: "#3176d3",
    primaryHover: "#2c6dc4",
    primarySoft: "rgba(49, 118, 211, 0.10)",
    current: "#5b2e91",
    currentSoft: "rgba(91, 46, 145, 0.12)",
    forecast: "#c78a20",
    success: "#2f8d83",
    warning: "#c78a20",
    track: "#eef2f7",
    text: "#1e1b27",
    muted: "#7c738a",
    grid: "#dfe5ef",
    axisLine: "#dfe5ef",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(30, 23, 43, 0.12)",
    tooltipExtraCssText:
      "box-shadow:0 10px 28px rgba(15,23,42,.10);border-radius:8px;",
    onAccent: "#ffffff",
    fontFamily: "IBM Plex Sans, PingFang SC, sans-serif",
  },
};

const CANONICAL_TEAL_THEME: DashboardColorTheme = {
  ...CANONICAL_PURPLE_THEME,
  id: DASHBOARD_COLOR_THEME_ID_TEAL,
  nameKey: "authoring.topbar.colorThemeTeal",
  shell: {
    ...CANONICAL_PURPLE_THEME.shell,
    headerBg: "#0f5f60",
    headerStrong: "#0a494a",
    controlActiveBg: "#0f5f60",
    controlActiveText: "#ffffff",
    controlBarBg: "#0d5356",
    controlBarItemActiveText: "#0d3b3d",
  },
  chart: {
    ...CANONICAL_PURPLE_THEME.chart,
    palette: ["#287bc8", "#0f766e", "#c78a20", "#6d5bd0", "#2f855a"],
    primary: "#287bc8",
    primaryHover: "#226eb5",
    primarySoft: "rgba(40, 123, 200, 0.10)",
    current: "#0f766e",
    currentSoft: "rgba(15, 118, 110, 0.12)",
    success: "#2f855a",
  },
};

const REPORT_VIEW_STYLES: DashboardViewStyle[] = [
  {
    id: DASHBOARD_VIEW_STYLE_ID_CLEAN,
    nameKey: "authoring.topbar.viewStyleClean",
    descriptionKey: "authoring.topbar.viewStyleCleanDescription",
    emphasisLevel: "quiet",
    supportedRecipeIds: [...SUPPORTED_REPORT_RECIPE_IDS],
  },
  {
    id: DASHBOARD_VIEW_STYLE_ID_GRADIENT,
    nameKey: "authoring.topbar.viewStyleGradient",
    descriptionKey: "authoring.topbar.viewStyleGradientDescription",
    emphasisLevel: "polished",
    supportedRecipeIds: [...SUPPORTED_REPORT_RECIPE_IDS],
  },
  {
    id: DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
    nameKey: "authoring.topbar.viewStyleEmphasis",
    descriptionKey: "authoring.topbar.viewStyleEmphasisDescription",
    emphasisLevel: "presentation",
    supportedRecipeIds: [...SUPPORTED_REPORT_RECIPE_IDS],
  },
];

const CANONICAL_RUNTIME_DESIGN_KIT: DashboardDesignKit = {
  id: CANONICAL_RUNTIME_DESIGN_KIT_ID,
  nameKey: "authoring.templates.defaultReport.name",
  surface: "report",
  density: "compact",
  cardChrome: "report",
  defaultColorThemeId: DASHBOARD_COLOR_THEME_ID_PURPLE,
  defaultViewStyleId: DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  colorThemes: [CANONICAL_PURPLE_THEME, CANONICAL_TEAL_THEME],
  viewStyles: REPORT_VIEW_STYLES,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isColorThemeId(value: string): value is DashboardColorThemeId {
  return (DASHBOARD_COLOR_THEME_IDS as readonly string[]).includes(value);
}

function isViewStyleId(value: string): value is DashboardViewStyleId {
  return (DASHBOARD_VIEW_STYLE_IDS as readonly string[]).includes(value);
}

export function getDefaultDashboardDesignKitId(): DashboardDesignKitId {
  return CANONICAL_RUNTIME_DESIGN_KIT.id;
}

export function getDefaultDashboardColorThemeId(
  designKitId: string = CANONICAL_DASHBOARD_TEMPLATE_ID,
): DashboardColorThemeId {
  return resolveDashboardDesignKit(designKitId).defaultColorThemeId;
}

export function getDefaultDashboardViewStyleId(
  designKitId: string = CANONICAL_DASHBOARD_TEMPLATE_ID,
): DashboardViewStyleId {
  return resolveDashboardDesignKit(designKitId).defaultViewStyleId;
}

export function listDashboardDesignKits(): DashboardDesignKit[] {
  return [clone(CANONICAL_RUNTIME_DESIGN_KIT)];
}

export function listDashboardColorThemes(
  designKitId: string = CANONICAL_DASHBOARD_TEMPLATE_ID,
): DashboardColorTheme[] {
  return resolveDashboardDesignKit(designKitId).colorThemes.map((theme) => clone(theme));
}

export function listDashboardViewStyles(
  designKitId: string = CANONICAL_DASHBOARD_TEMPLATE_ID,
): DashboardViewStyle[] {
  return resolveDashboardDesignKit(designKitId).viewStyles.map((style) => clone(style));
}

export function resolveDashboardDesignKit(
  designKitId?: string | null,
): DashboardDesignKit {
  const normalized = designKitId?.trim() || CANONICAL_DASHBOARD_TEMPLATE_ID;
  if (normalized !== CANONICAL_DASHBOARD_TEMPLATE_ID) {
    throw new Error(`Unknown dashboard design kit: ${normalized}`);
  }
  return clone(CANONICAL_RUNTIME_DESIGN_KIT);
}

export function resolveDashboardColorTheme(
  colorThemeId?: string | null,
  designKitId?: string | null,
): DashboardColorTheme {
  const kit = resolveDashboardDesignKit(designKitId);
  const normalized = colorThemeId?.trim() ?? "";
  if (normalized && !isColorThemeId(normalized)) {
    throw new Error(`Unknown dashboard color theme: ${normalized}`);
  }
  const resolvedId = normalized || kit.defaultColorThemeId;
  const theme = kit.colorThemes.find((candidate) => candidate.id === resolvedId);
  if (!theme) {
    throw new Error(`Dashboard color theme "${resolvedId}" is not supported by design kit "${kit.id}".`);
  }
  return clone(theme);
}

export function resolveDashboardViewStyle(
  viewStyleId?: string | null,
  designKitId?: string | null,
): DashboardViewStyle {
  const kit = resolveDashboardDesignKit(designKitId);
  const normalized = viewStyleId?.trim() ?? "";
  if (normalized && !isViewStyleId(normalized)) {
    throw new Error(`Unknown dashboard view style: ${normalized}`);
  }
  const resolvedId = normalized || kit.defaultViewStyleId;
  const style = kit.viewStyles.find((candidate) => candidate.id === resolvedId);
  if (!style) {
    throw new Error(`Dashboard view style "${resolvedId}" is not supported by design kit "${kit.id}".`);
  }
  return clone(style);
}

export function resolveDashboardTheme(
  colorThemeId?: string | null,
  designKitId?: string | null,
): DashboardResolvedTheme {
  const kit = resolveDashboardDesignKit(designKitId);
  const theme = resolveDashboardColorTheme(colorThemeId, kit.id);
  return {
    id: theme.id,
    designKitId: kit.id,
    nameKey: theme.nameKey,
    surface: kit.surface,
    density: kit.density,
    cardChrome: kit.cardChrome,
    shell: clone(theme.shell),
    chart: {
      ...clone(theme.chart),
      palette: [...theme.chart.palette],
    },
  };
}

export function dashboardThemeRef(path: DashboardThemeTokenPath): DashboardThemeRef {
  return { $theme: path };
}

export function dashboardThemeCssVariables(
  colorThemeId?: string | null,
  designKitId?: string | null,
): Record<`--${string}`, string> {
  const theme = resolveDashboardTheme(colorThemeId, designKitId);
  const densityTokens =
    theme.density === "compact"
      ? {
          pagePaddingY: "30px",
          pagePaddingX: "42px",
          canvasPadding: "20px 28px 28px",
          toolbarPadding: "12px 28px",
          gridGap: "16px",
          cardHeaderPadding: "20px 24px 14px",
        }
      : {
          pagePaddingY: "34px",
          pagePaddingX: "48px",
          canvasPadding: "24px 32px 32px",
          toolbarPadding: "14px 32px",
          gridGap: "18px",
          cardHeaderPadding: "18px 22px 14px",
      };
  const chromeTokens = {
    cardRadius: "8px",
    cardSelectedOutline: "#1a7cff",
    cardSelectedShadow: "0 0 0 3px rgba(26, 124, 255, 0.12)",
    resizeHandleColor: "rgba(49, 118, 211, 0.26)",
  };
  return {
    "--dashboard-theme-bg": theme.shell.pageBg,
    "--dashboard-theme-shell": theme.shell.shellBg,
    "--dashboard-theme-shell-border": theme.shell.shellBorder,
    "--dashboard-theme-shell-shadow": theme.shell.shellShadow,
    "--dashboard-theme-canvas": theme.shell.canvasBg,
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
    "--dashboard-theme-control-bar": theme.shell.controlBarBg,
    "--dashboard-theme-control-bar-border": theme.shell.controlBarBorder,
    "--dashboard-theme-control-bar-text": theme.shell.controlBarText,
    "--dashboard-theme-control-bar-muted": theme.shell.controlBarMuted,
    "--dashboard-theme-control-bar-item": theme.shell.controlBarItemBg,
    "--dashboard-theme-control-bar-item-border": theme.shell.controlBarItemBorder,
    "--dashboard-theme-control-bar-item-hover": theme.shell.controlBarItemHoverBg,
    "--dashboard-theme-control-bar-item-active": theme.shell.controlBarItemActiveBg,
    "--dashboard-theme-control-bar-item-active-text": theme.shell.controlBarItemActiveText,
    "--dashboard-theme-control-bar-action": theme.shell.controlBarActionBg,
    "--dashboard-theme-control-bar-shadow": theme.shell.controlBarShadow,
    "--dashboard-theme-control-bar-backdrop": theme.shell.controlBarBackdrop,
    "--dashboard-theme-status-ready-bg": theme.shell.statusReadyBg,
    "--dashboard-theme-status-ready-text": theme.shell.statusReadyText,
    "--dashboard-theme-status-ready-dot": theme.shell.statusReadyDot,
    "--dashboard-theme-card": theme.shell.cardBg,
    "--dashboard-theme-card-border": theme.shell.cardBorder,
    "--dashboard-theme-card-header-border": theme.shell.cardHeaderBorder,
    "--dashboard-theme-card-description": theme.shell.cardDescription,
    "--dashboard-theme-card-radius": chromeTokens.cardRadius,
    "--dashboard-theme-card-selected-outline": chromeTokens.cardSelectedOutline,
    "--dashboard-theme-card-selected-shadow": chromeTokens.cardSelectedShadow,
    "--dashboard-theme-resize-handle-color": chromeTokens.resizeHandleColor,
    "--dashboard-theme-shadow": theme.shell.cardShadow,
    "--dashboard-theme-accent-soft": theme.chart.currentSoft,
    "--dashboard-density-page-padding-y": densityTokens.pagePaddingY,
    "--dashboard-density-page-padding-x": densityTokens.pagePaddingX,
    "--dashboard-density-canvas-padding": densityTokens.canvasPadding,
    "--dashboard-density-toolbar-padding": densityTokens.toolbarPadding,
    "--dashboard-density-grid-gap": densityTokens.gridGap,
    "--dashboard-density-card-header-padding": densityTokens.cardHeaderPadding,
  };
}

export function resolveDashboardThemeToken(
  theme: DashboardResolvedTheme,
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
    const value = theme.chart[parts[1] as keyof DashboardChartTokens];
    return Array.isArray(value) ? value[0] ?? theme.chart.primary : value;
  }

  if (parts[0] === "shell" && parts[1] && parts[1] in theme.shell) {
    return theme.shell[parts[1] as keyof DashboardShellTokens];
  }

  return theme.chart.primary;
}

export function resolveDashboardThemeRefs<T extends JsonValue>(
  value: T,
  options?: {
    colorThemeId?: string | null;
    designKitId?: string | null;
  } | string | null,
): T {
  const theme =
    typeof options === "string" || options === null || options === undefined
      ? resolveDashboardTheme(options)
      : resolveDashboardTheme(options.colorThemeId, options.designKitId);
  return resolveDashboardThemeRefsWithTheme(value, theme) as T;
}

function resolveDashboardThemeRefsWithTheme(
  value: JsonValue,
  theme: DashboardResolvedTheme,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => resolveDashboardThemeRefsWithTheme(item, theme)) as JsonArray;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as JsonObject;
  if (typeof record.$theme === "string") {
    return resolveDashboardThemeToken(theme, record.$theme as DashboardThemeTokenPath);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      resolveDashboardThemeRefsWithTheme(entry as JsonValue, theme),
    ]),
  ) as JsonObject;
}
