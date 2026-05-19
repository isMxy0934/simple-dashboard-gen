import type { JsonObject } from "@/contracts";
import type { DashboardChartI18nRef } from "@/domain/dashboard/chart-i18n";
import type { DashboardTheme, DashboardThemeRef } from "@/domain/dashboard/themes";
import { dashboardThemeRef, resolveDashboardTheme } from "@/domain/dashboard/themes";

interface DashboardThemeChartRefs {
  palette: DashboardThemeRef[];
  primary: DashboardThemeRef;
  primaryHover: DashboardThemeRef;
  primarySoft: DashboardThemeRef;
  current: DashboardThemeRef;
  currentSoft: DashboardThemeRef;
  forecast: DashboardThemeRef;
  success: DashboardThemeRef;
  warning: DashboardThemeRef;
  track: DashboardThemeRef;
  text: DashboardThemeRef;
  muted: DashboardThemeRef;
  grid: DashboardThemeRef;
  axisLine: DashboardThemeRef;
  tooltipBg: DashboardThemeRef;
  tooltipBorder: DashboardThemeRef;
  onAccent: DashboardThemeRef;
  fontFamily: DashboardThemeRef;
}

const TOOLTIP_EXTRA_CSS =
  "box-shadow:0 10px 28px rgba(15,23,42,.12);border-radius:8px;";

export function resolveRecipeTheme(themeId?: string | null): DashboardTheme {
  return resolveDashboardTheme(themeId);
}

export function dashboardThemeChart(theme: DashboardTheme): DashboardThemeChartRefs {
  return {
    palette: theme.chart.palette.map((_color, index) =>
      dashboardThemeRef(`chart.palette.${index}`),
    ),
    primary: dashboardThemeRef("chart.primary"),
    primaryHover: dashboardThemeRef("chart.primaryHover"),
    primarySoft: dashboardThemeRef("chart.primarySoft"),
    current: dashboardThemeRef("chart.current"),
    currentSoft: dashboardThemeRef("chart.currentSoft"),
    forecast: dashboardThemeRef("chart.forecast"),
    success: dashboardThemeRef("chart.success"),
    warning: dashboardThemeRef("chart.warning"),
    track: dashboardThemeRef("chart.track"),
    text: dashboardThemeRef("chart.text"),
    muted: dashboardThemeRef("chart.muted"),
    grid: dashboardThemeRef("chart.grid"),
    axisLine: dashboardThemeRef("chart.axisLine"),
    tooltipBg: dashboardThemeRef("chart.tooltipBg"),
    tooltipBorder: dashboardThemeRef("chart.tooltipBorder"),
    onAccent: dashboardThemeRef("chart.onAccent"),
    fontFamily: dashboardThemeRef("chart.fontFamily"),
  };
}

export function dashboardThemeTooltip(
  theme: DashboardTheme,
  trigger: "axis" | "item" = "axis",
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    trigger,
    backgroundColor: chart.tooltipBg,
    borderColor: chart.tooltipBorder,
    borderWidth: 1,
    textStyle: {
      color: chart.text,
      fontSize: 12,
    },
    extraCssText: TOOLTIP_EXTRA_CSS,
    axisPointer:
      trigger === "axis"
        ? {
            type: "shadow",
            shadowStyle: {
              color: chart.primarySoft,
            },
          }
        : undefined,
  };
}

export function dashboardThemeGrid(overrides: JsonObject = {}): JsonObject {
  return {
    left: 34,
    right: 24,
    top: 34,
    bottom: 34,
    containLabel: true,
    ...overrides,
  };
}

export function dashboardThemeCategoryAxis(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "category",
    axisLine: {
      lineStyle: { color: chart.axisLine },
    },
    axisTick: { show: false },
    axisLabel: {
      color: chart.muted,
      fontSize: 12,
      margin: 10,
      hideOverlap: true,
    },
    ...overrides,
  };
}

export function dashboardThemeValueAxis(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "value",
    splitLine: {
      lineStyle: {
        color: chart.grid,
        type: "solid",
      },
    },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: chart.muted,
      fontSize: 12,
      margin: 10,
      hideOverlap: true,
    },
    ...overrides,
  };
}

export function dashboardThemeLegend(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    bottom: 0,
    left: 0,
    icon: "roundRect",
    itemWidth: 14,
    itemHeight: 8,
    textStyle: {
      color: chart.muted,
      fontSize: 12,
    },
    ...overrides,
  };
}

export function dashboardThemeBarSeries(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "bar",
    barMaxWidth: 34,
    barCategoryGap: "44%",
    itemStyle: {
      color: chart.primary,
      borderRadius: [5, 5, 0, 0],
    },
    emphasis: {
      itemStyle: {
        color: chart.primaryHover,
      },
    },
    ...overrides,
  };
}

export function dashboardThemeLineSeries(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "line",
    smooth: true,
    showSymbol: false,
    symbolSize: 5,
    lineStyle: {
      width: 2,
      color: chart.forecast,
    },
    itemStyle: {
      color: chart.forecast,
    },
    ...overrides,
  };
}

export function dashboardThemeGraphicText(
  theme: DashboardTheme,
  text: string | DashboardChartI18nRef,
  style: JsonObject = {},
  placement: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "text",
    left: 22,
    top: 20,
    ...placement,
    style: {
      text,
      fill: chart.text,
      fontFamily: chart.fontFamily,
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 18,
      ...style,
    },
  };
}
