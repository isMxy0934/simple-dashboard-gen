import type {
  DashboardRenderer,
  DashboardRendererSlot,
  JsonObject,
  JsonValue,
} from "@/contracts";

export interface DashboardRendererCompatibilityMigration {
  kind: "slot_path";
  slotId: string;
  fromPath: string;
  toPath: string;
  reason: string;
}

export interface DashboardRendererPresentationCompatibility {
  hasThemeRefs: boolean;
  hasI18nRefs: boolean;
  hardcodedColorPaths: string[];
  migrations: DashboardRendererCompatibilityMigration[];
}

const THEME_REF_KEY = "$theme";
const I18N_REF_KEY = "$i18n";
const LEGACY_KPI_VALUE_PATH = "graphic[0].style.text";
const CURRENT_KPI_VALUE_PATH = "graphic[1].style.text";
const COLOR_VALUE_PATTERN =
  /(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\))/i;

export function analyzeDashboardRendererPresentationCompatibility(
  renderer: DashboardRenderer,
): DashboardRendererPresentationCompatibility {
  return {
    hasThemeRefs: hasDashboardThemeRefs(renderer.option_template),
    hasI18nRefs: hasDashboardChartI18nRefs(renderer.option_template),
    hardcodedColorPaths: findHardcodedEChartsColorPaths(renderer.option_template),
    migrations: findDashboardRendererCompatibilityMigrations(renderer),
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
  const paths: string[] = [];
  visitJson(value, "", (entry, path) => {
    if (typeof entry === "string" && COLOR_VALUE_PATTERN.test(entry)) {
      paths.push(path || "$");
    }
  });
  return paths;
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
