import { effectiveLayoutRowHeight } from "../../domain/dashboard/layout";

export function cssGridAutoRowsForLayout(rowHeight?: number): string {
  return `minmax(${effectiveLayoutRowHeight(rowHeight)}px, auto)`;
}

/**
 * Fixed-height implicit rows for authoring canvas. Matches the row height used in
 * `useCanvasInteraction` so drag deltas map 1:1 to `y` / `h` in layout JSON.
 * (Variable `auto` row sizes made "empty" space and move steps feel wrong.)
 */
export function cssGridAutoRowsForAuthoring(rowHeight?: number): string {
  const h = effectiveLayoutRowHeight(rowHeight);
  return `${h}px`;
}
