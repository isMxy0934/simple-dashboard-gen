"use client";

import type { DashboardFilter, JsonValue } from "../../../contracts";
import type { TranslateFn } from "../../i18n";
import { ViewerFilterControls } from "./viewer-filter-controls";

export function ViewLocalFilterControls(props: {
  filters: DashboardFilter[];
  filterValues: Record<string, JsonValue>;
  disabled?: boolean;
  onChange: (nextValues: Record<string, JsonValue>) => void;
  t: TranslateFn;
}) {
  return (
    <ViewerFilterControls
      filters={props.filters}
      filterValues={props.filterValues}
      compact
      disabled={props.disabled}
      onChange={props.onChange}
      t={props.t}
    />
  );
}
