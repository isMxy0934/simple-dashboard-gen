import type {
  DashboardDocument,
  DashboardRenderer,
  DashboardRendererSlot,
  JsonObject,
  JsonValue,
} from "@/contracts";
import {
  dashboardThemeRef,
  listDashboardThemes,
  type DashboardThemeRef,
  type DashboardThemeTokenPath,
} from "@/presentation/dashboard/themes";

export interface DashboardRendererCompatibilityMigration {
  kind: "slot_path";
  slotId: string;
  fromPath: string;
  toPath: string;
  reason: string;
}

export interface DashboardRendererThemeColorMigration {
  kind: "theme_color";
  path: string;
  value: string;
  tokenPath: DashboardThemeTokenPath;
  toRef: DashboardThemeRef;
  reason: string;
}

export interface DashboardRendererHardcodedColorAudit {
  path: string;
  value: string;
  status: "migratable" | "ambiguous" | "unknown";
  tokenPath?: DashboardThemeTokenPath;
  matchingTokenPaths: DashboardThemeTokenPath[];
}

export interface DashboardRendererPresentationAudit {
  hasThemeRefs: boolean;
  hasI18nRefs: boolean;
  hardcodedColors: DashboardRendererHardcodedColorAudit[];
  legacySlotMigrations: DashboardRendererCompatibilityMigration[];
  themeColorMigrations: DashboardRendererThemeColorMigration[];
}

export interface DashboardViewRendererPresentationAudit {
  viewId: string;
  viewTitle: string;
  renderer: DashboardRendererPresentationAudit;
}

export interface DashboardRendererPresentationCompatibility {
  hasThemeRefs: boolean;
  hasI18nRefs: boolean;
  hardcodedColorPaths: string[];
  hardcodedColors: DashboardRendererHardcodedColorAudit[];
  migrations: DashboardRendererCompatibilityMigration[];
  themeColorMigrations: DashboardRendererThemeColorMigration[];
}

const THEME_REF_KEY = "$theme";
const I18N_REF_KEY = "$i18n";
const LEGACY_KPI_VALUE_PATH = "graphic[0].style.text";
const CURRENT_KPI_VALUE_PATH = "graphic[1].style.text";
const COLOR_VALUE_PATTERN =
  /(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\))/i;
const CHART_COLOR_TOKEN_KEYS = [
  "primary",
  "primaryHover",
  "primarySoft",
  "current",
  "currentSoft",
  "forecast",
  "success",
  "warning",
  "track",
  "text",
  "muted",
  "grid",
  "axisLine",
  "tooltipBg",
  "tooltipBorder",
  "onAccent",
] as const;

export function analyzeDashboardRendererPresentationCompatibility(
  renderer: DashboardRenderer,
): DashboardRendererPresentationCompatibility {
  const audit = auditDashboardRendererPresentationCompatibility(renderer);
  return {
    hasThemeRefs: audit.hasThemeRefs,
    hasI18nRefs: audit.hasI18nRefs,
    hardcodedColorPaths: audit.hardcodedColors.map((entry) => entry.path),
    hardcodedColors: audit.hardcodedColors,
    migrations: audit.legacySlotMigrations,
    themeColorMigrations: audit.themeColorMigrations,
  };
}

export function auditDashboardDocumentRendererPresentation(
  document: DashboardDocument,
): DashboardViewRendererPresentationAudit[] {
  return document.dashboard_spec.views.map((view) => ({
    viewId: view.id,
    viewTitle: view.title,
    renderer: auditDashboardRendererPresentationCompatibility(view.renderer),
  }));
}

export function auditDashboardRendererPresentationCompatibility(
  renderer: DashboardRenderer,
): DashboardRendererPresentationAudit {
  const hardcodedColors = findHardcodedEChartsColorAudits(renderer.option_template);
  const legacySlotMigrations = findDashboardRendererCompatibilityMigrations(renderer);
  return {
    hasThemeRefs: hasDashboardThemeRefs(renderer.option_template),
    hasI18nRefs: hasDashboardChartI18nRefs(renderer.option_template),
    hardcodedColors,
    legacySlotMigrations,
    themeColorMigrations: hardcodedColors
      .filter((entry): entry is DashboardRendererHardcodedColorAudit & {
        tokenPath: DashboardThemeTokenPath;
      } =>
        entry.status === "migratable" &&
        Boolean(entry.tokenPath) &&
        isMigratableEChartsColorPath(entry.path))
      .map((entry) => ({
        kind: "theme_color",
        path: entry.path,
        value: entry.value,
        tokenPath: entry.tokenPath,
        toRef: dashboardThemeRef(entry.tokenPath),
        reason:
          "Hardcoded color exactly matches a registered report theme chart token.",
      })),
  };
}

export function hasDashboardThemeRefs(value: JsonValue): boolean {
  return hasObjectRef(value, THEME_REF_KEY);
}

export function hasDashboardChartI18nRefs(value: JsonValue): boolean {
  return hasObjectRef(value, I18N_REF_KEY);
}

export function hasHardcodedEChartsColors(value: JsonValue): boolean {
  return findHardcodedEChartsColorPaths(value).length > 0;
}

export function findHardcodedEChartsColorPaths(value: JsonValue): string[] {
  return findHardcodedEChartsColorAudits(value).map((entry) => entry.path);
}

export function findHardcodedEChartsColorAudits(
  value: JsonValue,
): DashboardRendererHardcodedColorAudit[] {
  const audits: DashboardRendererHardcodedColorAudit[] = [];
  visitJson(value, "", (entry, path) => {
    if (typeof entry === "string" && COLOR_VALUE_PATTERN.test(entry)) {
      const classification = classifyHardcodedColorValue(entry);
      audits.push({
        path: path || "$",
        value: entry,
        status: classification.status,
        tokenPath: classification.tokenPath,
        matchingTokenPaths: classification.matchingTokenPaths,
      });
    }
  });
  return audits;
}

export function findDashboardRendererCompatibilityMigrations(
  renderer: DashboardRenderer,
): DashboardRendererCompatibilityMigration[] {
  const migrations: DashboardRendererCompatibilityMigration[] = [];

  for (const slot of renderer.slots) {
    if (
      slot.id === "value" &&
      slot.path === LEGACY_KPI_VALUE_PATH &&
      hasGraphicTextAtPath(renderer.option_template, CURRENT_KPI_VALUE_PATH)
    ) {
      migrations.push({
        kind: "slot_path",
        slotId: slot.id,
        fromPath: LEGACY_KPI_VALUE_PATH,
        toPath: CURRENT_KPI_VALUE_PATH,
        reason:
          "KPI text recipes now reserve graphic[0] for the label and bind the primary value at graphic[1].",
      });
    }
  }

  return migrations;
}

export function migrateDashboardRendererCompatibility(
  renderer: DashboardRenderer,
): {
  renderer: DashboardRenderer;
  migrations: DashboardRendererCompatibilityMigration[];
} {
  const migrations = findDashboardRendererCompatibilityMigrations(renderer);
  if (migrations.length === 0) {
    return { renderer, migrations };
  }

  const slotMigrations = new Map(
    migrations.map((migration) => [
      `${migration.slotId}:${migration.fromPath}`,
      migration.toPath,
    ]),
  );
  return {
    renderer: {
      ...renderer,
      slots: renderer.slots.map((slot) => migrateRendererSlot(slot, slotMigrations)),
    },
    migrations,
  };
}

export function migrateDashboardRendererThemeColorRefs(
  renderer: DashboardRenderer,
): {
  renderer: DashboardRenderer;
  migrations: DashboardRendererThemeColorMigration[];
} {
  const migrations: DashboardRendererThemeColorMigration[] = [];
  const optionTemplate = replaceHardcodedThemeColors(
    renderer.option_template,
    "",
    migrations,
  ) as JsonObject;

  if (migrations.length === 0) {
    return { renderer, migrations };
  }

  return {
    renderer: {
      ...renderer,
      option_template: optionTemplate,
    },
    migrations,
  };
}

function migrateRendererSlot(
  slot: DashboardRendererSlot,
  slotMigrations: Map<string, string>,
): DashboardRendererSlot {
  const nextPath = slotMigrations.get(`${slot.id}:${slot.path}`);
  return nextPath ? { ...slot, path: nextPath } : slot;
}

function hasObjectRef(value: JsonValue, refKey: "$theme" | "$i18n"): boolean {
  let found = false;
  visitJson(value, "", (entry) => {
    if (found || !isPlainObject(entry)) {
      return;
    }
    const keys = Object.keys(entry);
    found = keys.length === 1 && typeof entry[refKey] === "string";
  });
  return found;
}

function hasGraphicTextAtPath(optionTemplate: JsonObject, path: string): boolean {
  if (path !== CURRENT_KPI_VALUE_PATH) {
    return false;
  }
  const graphic = optionTemplate.graphic;
  if (!Array.isArray(graphic)) {
    return false;
  }
  const valueGraphic = graphic[1];
  return (
    isPlainObject(valueGraphic) &&
    valueGraphic.type === "text" &&
    isPlainObject(valueGraphic.style)
  );
}

function replaceHardcodedThemeColors(
  value: JsonValue,
  path: string,
  migrations: DashboardRendererThemeColorMigration[],
): JsonValue {
  if (typeof value === "string" && COLOR_VALUE_PATTERN.test(value)) {
    const classification = classifyHardcodedColorValue(value);
    if (
      classification.status === "migratable" &&
      classification.tokenPath &&
      isMigratableEChartsColorPath(path || "$")
    ) {
      const migration: DashboardRendererThemeColorMigration = {
        kind: "theme_color",
        path: path || "$",
        value,
        tokenPath: classification.tokenPath,
        toRef: dashboardThemeRef(classification.tokenPath),
        reason:
          "Hardcoded color exactly matches a registered report theme chart token.",
      };
      migrations.push(migration);
      return migration.toRef;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      replaceHardcodedThemeColors(entry, `${path}[${index}]`, migrations),
    );
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    next[key] =
      entry === undefined
        ? undefined
        : replaceHardcodedThemeColors(entry, childPath, migrations);
  }
  return next;
}

function isMigratableEChartsColorPath(path: string): boolean {
  if (isDataBearingPath(path)) {
    return false;
  }

  const normalized = normalizeIndexedPath(path);
  if (normalized === "color" || normalized === "backgroundColor") {
    return true;
  }

  if (
    normalized.endsWith(".color") ||
    normalized.endsWith(".backgroundColor") ||
    normalized.endsWith(".borderColor") ||
    normalized.endsWith(".fill") ||
    normalized.endsWith(".stroke") ||
    normalized.endsWith(".shadowColor")
  ) {
    return true;
  }

  return normalized.includes(".lineStyle.") ||
    normalized.includes(".itemStyle.") ||
    normalized.includes(".areaStyle.") ||
    normalized.includes(".textStyle.") ||
    normalized.includes(".label.") ||
    normalized.includes(".labelLine.") ||
    normalized.includes(".axisLine.") ||
    normalized.includes(".splitLine.");
}

function isDataBearingPath(path: string): boolean {
  const normalized = normalizeIndexedPath(path);
  return (
    normalized === "dataset.source" ||
    normalized.startsWith("dataset.source.") ||
    normalized === "data" ||
    normalized.startsWith("data.") ||
    normalized.endsWith(".data") ||
    normalized.includes(".data.") ||
    normalized.endsWith(".style.text") ||
    normalized.endsWith(".name")
  );
}

function normalizeIndexedPath(path: string): string {
  return path.replace(/\[\d+\]/g, "");
}

function classifyHardcodedColorValue(value: string): {
  status: DashboardRendererHardcodedColorAudit["status"];
  tokenPath?: DashboardThemeTokenPath;
  matchingTokenPaths: DashboardThemeTokenPath[];
} {
  const matchingTokenPaths = getKnownReportChartColorTokenPaths(value);
  if (matchingTokenPaths.length === 1) {
    return {
      status: "migratable",
      tokenPath: matchingTokenPaths[0],
      matchingTokenPaths,
    };
  }

  if (matchingTokenPaths.length > 1) {
    return {
      status: "ambiguous",
      matchingTokenPaths,
    };
  }

  return {
    status: "unknown",
    matchingTokenPaths,
  };
}

function getKnownReportChartColorTokenPaths(value: string): DashboardThemeTokenPath[] {
  const normalizedValue = normalizeExactColorValue(value);
  if (!normalizedValue) {
    return [];
  }

  return getReportChartColorTokenMap().get(normalizedValue) ?? [];
}

function normalizeExactColorValue(value: string): string {
  return value.trim().toLowerCase();
}

let reportChartColorTokenMap: Map<string, DashboardThemeTokenPath[]> | null = null;

function getReportChartColorTokenMap(): Map<string, DashboardThemeTokenPath[]> {
  if (reportChartColorTokenMap) {
    return reportChartColorTokenMap;
  }

  const next = new Map<string, Set<DashboardThemeTokenPath>>();
  for (const theme of listDashboardThemes()) {
    if (theme.surface !== "report") {
      continue;
    }

    for (const key of CHART_COLOR_TOKEN_KEYS) {
      addColorTokenPath(next, theme.chart[key], `chart.${key}`);
    }

    theme.chart.palette.forEach((value, index) => {
      addColorTokenPath(next, value, `chart.palette.${index}`);
    });
  }

  reportChartColorTokenMap = new Map(
    [...next.entries()].map(([value, paths]) => {
      const pathList = [...paths];
      const namedPaths = pathList.filter((path) => !path.startsWith("chart.palette."));
      return [value, namedPaths.length > 0 ? namedPaths : pathList];
    }),
  );
  return reportChartColorTokenMap;
}

function addColorTokenPath(
  map: Map<string, Set<DashboardThemeTokenPath>>,
  value: string,
  path: DashboardThemeTokenPath,
): void {
  if (!COLOR_VALUE_PATTERN.test(value)) {
    return;
  }
  const normalized = normalizeExactColorValue(value);
  const paths = map.get(normalized) ?? new Set<DashboardThemeTokenPath>();
  paths.add(path);
  map.set(normalized, paths);
}

function visitJson(
  value: JsonValue | undefined,
  path: string,
  visitor: (value: JsonValue, path: string) => void,
): void {
  if (value === undefined) {
    return;
  }

  visitor(value, path);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitJson(entry, `${path}[${index}]`, visitor);
    });
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    visitJson(entry, childPath, visitor);
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
