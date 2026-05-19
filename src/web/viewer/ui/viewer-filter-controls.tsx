"use client";

import type { DashboardDocument, JsonValue } from "../../../contracts";
import type { TranslateFn } from "../../i18n";
import {
  FILTERS,
  labelForRange,
  labelForViewMode,
  type ViewMode,
} from "../state/viewer-state";
import styles from "./viewer.module.css";

export const VIEW_MODES: ViewMode[] = ["desktop", "mobile"];

export function ViewModeControls({
  viewMode,
  compact = false,
  onChange,
  t,
}: {
  viewMode: ViewMode;
  compact?: boolean;
  onChange: (mode: ViewMode) => void;
  t: TranslateFn;
}) {
  return (
    <>
      {VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`${styles.filterButton} ${
            compact ? styles.filterButtonCompact : ""
          } ${viewMode === mode ? styles.filterButtonActive : ""}`}
          onClick={() => onChange(mode)}
        >
          {labelForViewMode(mode, t)}
        </button>
      ))}
    </>
  );
}

export function ViewerFilterControls({
  dashboard,
  filterValues,
  compact = false,
  onChange,
  t,
}: {
  dashboard: DashboardDocument;
  filterValues: Record<string, JsonValue>;
  compact?: boolean;
  onChange: (nextValues: Record<string, JsonValue>) => void;
  t: TranslateFn;
}) {
  return (
    <>
      {dashboard.dashboard_spec.filters.flatMap((filter) => {
        const currentValue = filterValues[filter.id] ?? filter.default_value;
        const options =
          filter.kind === "time_range"
            ? FILTERS.map((range) => ({
                label: labelForRange(range, t),
                value: range,
              }))
            : filter.options;

        return options.map((option) => (
          <button
            key={`${filter.id}:${option.value}`}
            type="button"
            className={`${styles.filterButton} ${
              compact ? styles.filterButtonCompact : ""
            } ${currentValue === option.value ? styles.filterButtonActive : ""}`}
            onClick={() =>
              onChange({
                ...filterValues,
                [filter.id]: option.value,
              })
            }
          >
            {filter.kind === "single_select" ? `${filter.label}: ${option.label}` : option.label}
          </button>
        ));
      })}
    </>
  );
}
