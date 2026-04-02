function effectiveLayoutRowHeight(rowHeight?: number): number {
  const base = rowHeight ?? 30;
  const n = Number.isFinite(base) ? base : 30;
  return Math.min(80, Math.max(24, n));
}

export function cssGridAutoRowsForLayout(rowHeight?: number): string {
  return `minmax(${effectiveLayoutRowHeight(rowHeight)}px, auto)`;
}
