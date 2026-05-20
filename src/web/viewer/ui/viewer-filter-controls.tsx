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

function valueKey(value: JsonValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

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
    <div
      className={`${styles.segmentedControl} ${
        compact ? styles.segmentedControlCompact : ""
      }`}
    >
      {VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={viewMode === mode}
          className={`${styles.filterButton} ${
            compact ? styles.filterButtonCompact : ""
          } ${viewMode === mode ? styles.filterButtonActive : ""}`}
          onClick={() => onChange(mode)}
        >
          {labelForViewMode(mode, t)}
        </button>
      ))}
    </div>
  );
}

export function ViewerFilterControls({
  dashboard,
  filterValues,
  compact = false,
  disabled = false,
  onChange,
  t,
}: {
  dashboard: DashboardDocument;
  filterValues: Record<string, JsonValue>;
  compact?: boolean;
  disabled?: boolean;
  onChange: (nextValues: Record<string, JsonValue>) => void;
  t: TranslateFn;
}) {
  return (
    <>
      {dashboard.dashboard_spec.filters.map((filter) => {
        const currentValue = filterValues[filter.id] ?? filter.default_value;
        const options =
          filter.kind === "time_range"
            ? FILTERS.map((range) => ({
                label: labelForRange(range, t),
                value: range,
              }))
            : filter.options;
        const currentKey = valueKey(currentValue);

        if (filter.kind === "single_select") {
          return (
            <label
              key={filter.id}
              className={`${styles.filterControlGroup} ${
                compact ? styles.filterControlGroupCompact : ""
              }`}
            >
              <span className={styles.filterControlLabel}>{filter.label}</span>
              <select
                className={styles.filterSelect}
                value={currentKey}
                disabled={disabled}
                onChange={(event) => {
                  const selected = options.find(
                    (option) => valueKey(option.value) === event.target.value,
                  );
                  if (!selected) {
                    return;
                  }
                  onChange({
                    ...filterValues,
                    [filter.id]: selected.value ?? null,
                  });
                }}
              >
                {options.map((option) => (
                  <option
                    key={`${filter.id}:${valueKey(option.value)}`}
                    value={valueKey(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        return (
          <div
            key={filter.id}
            className={`${styles.filterControlGroup} ${
              compact ? styles.filterControlGroupCompact : ""
            }`}
          >
            <span className={styles.filterControlLabel}>{filter.label}</span>
            <div
              className={`${styles.segmentedControl} ${
                compact ? styles.segmentedControlCompact : ""
              }`}
            >
              {options.map((option) => (
                <button
                  key={`${filter.id}:${valueKey(option.value)}`}
                  type="button"
                  aria-pressed={currentKey === valueKey(option.value)}
                  disabled={disabled}
                  className={`${styles.filterButton} ${
                    compact ? styles.filterButtonCompact : ""
                  } ${currentKey === valueKey(option.value) ? styles.filterButtonActive : ""}`}
                  onClick={() =>
                    onChange({
                      ...filterValues,
                      [filter.id]: option.value ?? null,
                    })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
