import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardFilter,
  DashboardLayoutItem,
  DashboardPresentation,
  DashboardTemplateRef,
  DashboardView,
} from "../../contracts";

export const DEFAULT_DASHBOARD_TEMPLATE_ID = "delivery-return-report";
export const DEFAULT_DASHBOARD_TEMPLATE_VERSION = "1";

export const DEFAULT_DASHBOARD_TEMPLATE_REF: DashboardTemplateRef = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
};

export interface DashboardTemplateDefinition {
  id: string;
  version: string;
  dashboardDefaults: {
    name: string;
    description: string;
  };
  presentation: DashboardPresentation;
  layout: {
    desktop: Pick<DashboardBreakpointLayout, "cols" | "row_height">;
    mobile: Pick<DashboardBreakpointLayout, "cols" | "row_height">;
  };
  starter: {
    views: DashboardView[];
    desktopItems: DashboardLayoutItem[];
    mobileItems: DashboardLayoutItem[];
  };
  filters: DashboardFilter[];
  chartRecipeIds: string[];
}

const REPORT_BLUE = "#4e79a7";
const REPORT_ORANGE = "#f28e2b";

function buildStackedAreaView(input: {
  id: string;
  title: string;
  legend: [string, string];
  slotIds: [string, string];
}): DashboardView {
  return {
    id: input.id,
    title: input.title,
    description: "",
    renderer: {
      kind: "echarts",
      option_template: {
        color: [REPORT_ORANGE, REPORT_BLUE],
        tooltip: { trigger: "axis" },
        legend: {
          left: 0,
          top: 0,
          itemWidth: 16,
          itemHeight: 14,
          data: input.legend,
        },
        grid: { left: 8, right: 10, top: 46, bottom: 48, containLabel: true },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: [],
          axisLabel: { rotate: 90 },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: "#ededed" } },
        },
        series: [
          {
            name: input.legend[0],
            type: "line",
            stack: "total",
            areaStyle: {},
            symbol: "none",
            data: [],
          },
          {
            name: input.legend[1],
            type: "line",
            stack: "total",
            areaStyle: {},
            symbol: "none",
            data: [],
          },
        ],
      },
      slots: [
        { id: "date", path: "xAxis.data", value_kind: "array", required: true },
        {
          id: input.slotIds[0],
          path: "series[0].data",
          value_kind: "array",
          required: true,
        },
        {
          id: input.slotIds[1],
          path: "series[1].data",
          value_kind: "array",
          required: true,
        },
      ],
    },
  };
}

function buildStackedBarView(): DashboardView {
  return {
    id: "delivery_return_damaged_individual",
    title: "Damaged vs Individual",
    description: "",
    renderer: {
      kind: "echarts",
      option_template: {
        color: [REPORT_BLUE, REPORT_ORANGE],
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: {
          right: "38%",
          top: 0,
          itemWidth: 16,
          itemHeight: 14,
          data: ["DAMAGED RETURN", "INDIVIDUAL RETURN"],
        },
        grid: { left: 8, right: 10, top: 46, bottom: 48, containLabel: true },
        xAxis: {
          type: "category",
          data: [],
          axisLabel: { rotate: 90 },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: "#ededed" } },
        },
        series: [
          {
            name: "DAMAGED RETURN",
            type: "bar",
            stack: "return",
            data: [],
            barMaxWidth: 16,
          },
          {
            name: "INDIVIDUAL RETURN",
            type: "bar",
            stack: "return",
            data: [],
            barMaxWidth: 16,
          },
        ],
      },
      slots: [
        { id: "date", path: "xAxis.data", value_kind: "array", required: true },
        {
          id: "damaged_return",
          path: "series[0].data",
          value_kind: "array",
          required: true,
        },
        {
          id: "individual_return",
          path: "series[1].data",
          value_kind: "array",
          required: true,
        },
      ],
    },
  };
}

const DELIVERY_RETURN_REPORT_TEMPLATE: DashboardTemplateDefinition = {
  id: DEFAULT_DASHBOARD_TEMPLATE_ID,
  version: DEFAULT_DASHBOARD_TEMPLATE_VERSION,
  dashboardDefaults: {
    name: "Delivery Return Dashboard",
    description: "",
  },
  presentation: {
    theme_id: "delivery-return-report",
    density: "compact",
    card_chrome: "report",
  },
  layout: {
    desktop: {
      cols: 12,
      row_height: 30,
    },
    mobile: {
      cols: 4,
      row_height: 30,
    },
  },
  starter: {
    views: [
      buildStackedAreaView({
        id: "delivery_return_individual_total",
        title: "Individual Return / Total Return",
        legend: ["INDIVIDUAL RETURN PACKAGE", "RETURN PACKAGE"],
        slotIds: ["individual_return_package", "return_package"],
      }),
      buildStackedBarView(),
      buildStackedAreaView({
        id: "delivery_return_drivers",
        title: "Individual Return Drivers / Total Return Drivers",
        legend: ["Cumulative Adopted Driver", "Cumulative All Driver"],
        slotIds: ["cumulative_adopted_driver", "cumulative_all_driver"],
      }),
    ],
    desktopItems: [
      { view_id: "delivery_return_individual_total", x: 0, y: 0, w: 6, h: 12 },
      { view_id: "delivery_return_damaged_individual", x: 6, y: 0, w: 6, h: 12 },
      { view_id: "delivery_return_drivers", x: 0, y: 12, w: 12, h: 12 },
    ],
    mobileItems: [
      { view_id: "delivery_return_individual_total", x: 0, y: 0, w: 4, h: 10 },
      { view_id: "delivery_return_damaged_individual", x: 0, y: 10, w: 4, h: 10 },
      { view_id: "delivery_return_drivers", x: 0, y: 20, w: 4, h: 10 },
    ],
  },
  filters: [
    {
      id: "f_time_range",
      kind: "time_range",
      label: "Time Range",
      default_value: "last_12_weeks",
      resolved_fields: ["start", "end", "timezone"],
    },
    {
      id: "f_region",
      kind: "single_select",
      label: "Region",
      default_value: "all",
      options: [
        { label: "All Regions", value: "all" },
        { label: "East", value: "East" },
        { label: "West", value: "West" },
        { label: "South", value: "South" },
      ],
    },
  ],
  chartRecipeIds: [
    "echarts-bar",
    "echarts-line",
    "echarts-kpi-text",
    "echarts-kpi-gauge",
  ],
};

const DASHBOARD_TEMPLATES = [DELIVERY_RETURN_REPORT_TEMPLATE];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDashboardTemplate(
  ref?: DashboardTemplateRef | null,
): DashboardTemplateDefinition {
  if (ref && isNonEmptyString(ref.id) && isNonEmptyString(ref.version)) {
    const match = DASHBOARD_TEMPLATES.find(
      (template) => template.id === ref.id && template.version === ref.version,
    );
    if (match) {
      return match;
    }
  }

  return DELIVERY_RETURN_REPORT_TEMPLATE;
}

function hasKnownDashboardTemplateRef(ref?: DashboardTemplateRef | null): boolean {
  return Boolean(
    ref &&
      isNonEmptyString(ref.id) &&
      isNonEmptyString(ref.version) &&
      DASHBOARD_TEMPLATES.some(
        (template) => template.id === ref.id && template.version === ref.version,
      ),
  );
}

function normalizeTemplateRef(
  ref: DashboardTemplateRef | undefined,
  resolvedTemplate: DashboardTemplateDefinition,
): DashboardTemplateRef {
  if (ref && isNonEmptyString(ref.id) && isNonEmptyString(ref.version)) {
    return {
      id: ref.id.trim(),
      version: ref.version.trim(),
    };
  }

  return {
    id: resolvedTemplate.id,
    version: resolvedTemplate.version,
  };
}

export function createDashboardFromTemplate(
  ref: DashboardTemplateRef = DEFAULT_DASHBOARD_TEMPLATE_REF,
): DashboardDocument {
  const template = resolveDashboardTemplate(ref);
  return {
    dashboard_spec: {
      schema_version: "0.2",
      template: {
        id: template.id,
        version: template.version,
      },
      presentation: clone(template.presentation),
      dashboard: {
        name: template.dashboardDefaults.name,
        description: template.dashboardDefaults.description,
      },
      layout: {
        desktop: {
          ...template.layout.desktop,
          items: clone(template.starter.desktopItems),
        },
        mobile: {
          ...template.layout.mobile,
          items: clone(template.starter.mobileItems),
        },
      },
      views: clone(template.starter.views),
      filters: clone(template.filters),
    },
    query_defs: [],
    bindings: [],
  };
}

export function applyDashboardTemplateDefaults(
  document: DashboardDocument,
): DashboardDocument {
  const existingTemplate = document.dashboard_spec.template;
  const template = resolveDashboardTemplate(existingTemplate);
  const hasKnownTemplate = hasKnownDashboardTemplateRef(existingTemplate);
  const shouldApplyTemplatePresentation =
    !existingTemplate ||
    hasKnownTemplate ||
    !document.dashboard_spec.presentation;
  const desktop = document.dashboard_spec.layout.desktop;
  const mobile = document.dashboard_spec.layout.mobile;
  const filters = Array.isArray(document.dashboard_spec.filters)
    ? document.dashboard_spec.filters
    : clone(template.filters);
  const layout = {
    ...document.dashboard_spec.layout,
    desktop: desktop ?? {
      ...template.layout.desktop,
      items: [],
    },
    ...(mobile ? { mobile } : {}),
  };

  return {
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      template: normalizeTemplateRef(existingTemplate, template),
      presentation:
        shouldApplyTemplatePresentation
          ? clone(template.presentation)
          : document.dashboard_spec.presentation,
      layout,
      filters,
    },
  };
}
