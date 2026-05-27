import type { JsonObject } from "@/contracts";
import {
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
} from "@/contracts/dashboard-presentation";
import type { DashboardChartI18nRef } from "@/presentation/dashboard/chart-i18n";
import type { DashboardViewPresentationContext } from "@/presentation/dashboard/presentation-context";
import type { DashboardTheme, DashboardThemeRef, DashboardViewStyleId } from "@/presentation/dashboard/themes";
import {
  dashboardThemeRef,
  resolveDashboardTheme,
  resolveDashboardViewStyle,
} from "@/presentation/dashboard/themes";

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
  tooltipExtraCssText: DashboardThemeRef;
  onAccent: DashboardThemeRef;
  fontFamily: DashboardThemeRef;
}

export type EChartsGraphicTextValue = string | DashboardChartI18nRef;

export interface EChartsGraphicTextStyle extends JsonObject {
  text: EChartsGraphicTextValue;
  fill?: string | DashboardThemeRef;
  fontFamily?: string | DashboardThemeRef;
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
}

export interface EChartsGraphicTextElement extends JsonObject {
  type: "text";
  left?: string | number;
  right?: string | number;
  top?: string | number;
  bottom?: string | number;
  style: EChartsGraphicTextStyle;
}

export interface EChartsGraphicRectElement extends JsonObject {
  type: "rect";
  left?: string | number;
  right?: string | number;
  top?: string | number;
  bottom?: string | number;
  shape?: JsonObject;
  style?: JsonObject;
}

export type EChartsGraphicElement =
  | EChartsGraphicTextElement
  | EChartsGraphicRectElement
  | JsonObject;

export function resolveRecipeTheme(
  presentation?: DashboardViewPresentationContext | null,
): DashboardTheme {
  return presentation?.theme ??
    resolveDashboardTheme(
      presentation?.chartPresentation.colorThemeId,
      presentation?.chartPresentation.designKitId,
    );
}

export function resolveRecipeViewStyleId(
  presentation?: DashboardViewPresentationContext | null,
): DashboardViewStyleId {
  return (
    presentation?.viewStyle?.id ??
    resolveDashboardViewStyle(
      presentation?.chartPresentation.viewStyleId,
      presentation?.chartPresentation.designKitId,
    ).id
  );
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
    tooltipExtraCssText: dashboardThemeRef("chart.tooltipExtraCssText"),
    onAccent: dashboardThemeRef("chart.onAccent"),
    fontFamily: dashboardThemeRef("chart.fontFamily"),
  };
}

export function isExecutiveReportTheme(theme: DashboardTheme): boolean {
  return theme.designKitId === EXECUTIVE_REPORT_DESIGN_KIT_ID;
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
    extraCssText: chart.tooltipExtraCssText,
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

export function dashboardReportGrid(
  theme: DashboardTheme,
  overrides: JsonObject = {},
): JsonObject {
  return dashboardThemeGrid({
    ...(isExecutiveReportTheme(theme)
      ? {
          left: 46,
          right: 34,
          top: 42,
          bottom: 42,
        }
      : {}),
    ...overrides,
  });
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
  styleId: DashboardViewStyleId = DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  const gradientStyle =
    styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
      ? {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: chart.primary },
              { offset: 1, color: chart.currentSoft },
            ],
          },
        }
      : {};
  return {
    type: "bar",
    barMaxWidth: isExecutiveReportTheme(theme)
      ? 42
      : styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
        ? 28
        : 36,
    barCategoryGap: isExecutiveReportTheme(theme)
      ? "44%"
      : styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
        ? "42%"
        : "48%",
    itemStyle: {
      color: chart.primary,
      borderRadius: isExecutiveReportTheme(theme)
        ? [7, 7, 0, 0]
        : styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? [3, 3, 0, 0]
          : [6, 6, 0, 0],
      shadowBlur: !isExecutiveReportTheme(theme) && styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
          ? 6
          : undefined,
      shadowColor:
        !isExecutiveReportTheme(theme) && styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
          ? chart.primarySoft
          : undefined,
      ...gradientStyle,
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
  styleId: DashboardViewStyleId = DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  overrides: JsonObject = {},
): JsonObject {
  const chart = dashboardThemeChart(theme);
  return {
    type: "line",
    smooth: true,
    showSymbol: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
    symbol: "circle",
    symbolSize: isExecutiveReportTheme(theme)
      ? 5
      : styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
        ? 6
        : 4,
    lineStyle: {
      width: isExecutiveReportTheme(theme)
        ? 2
        : styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 2
          : 3,
      color: chart.forecast,
      shadowBlur: !isExecutiveReportTheme(theme) && styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
          ? 8
          : undefined,
      shadowColor:
        !isExecutiveReportTheme(theme) && styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
          ? chart.currentSoft
          : undefined,
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
): EChartsGraphicTextElement {
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
  } as EChartsGraphicTextElement;
}
