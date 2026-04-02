import type {
  DashboardBreakpointLayout,
  DashboardLayoutItem,
} from "../../contracts";

/** Row height in px used for layout math and CSS grid tracks (clamped for sane rendering). */
const LAYOUT_ROW_HEIGHT_MIN = 24;
const LAYOUT_ROW_HEIGHT_MAX = 80;

export function effectiveLayoutRowHeight(rowHeight?: number): number {
  const base = rowHeight ?? 30;
  const n = Number.isFinite(base) ? base : 30;
  return Math.min(LAYOUT_ROW_HEIGHT_MAX, Math.max(LAYOUT_ROW_HEIGHT_MIN, n));
}

/** Grid tracks grow with card content so fixed min-height on cards cannot paint over rows below. */
export function cssGridAutoRowsForLayout(rowHeight?: number): string {
  return `minmax(${effectiveLayoutRowHeight(rowHeight)}px, auto)`;
}

export function generateMobileLayout(
  desktopLayout: DashboardBreakpointLayout,
): DashboardBreakpointLayout {
  let cursorY = 0;
  const items = [...desktopLayout.items]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((item) => {
      const mobileItem: DashboardLayoutItem = {
        view_id: item.view_id,
        x: 0,
        y: cursorY,
        w: 4,
        h: Math.max(5, Math.min(10, item.h)),
      };

      cursorY += mobileItem.h;
      return mobileItem;
    });

  return {
    cols: 4,
    row_height: effectiveLayoutRowHeight(desktopLayout.row_height),
    items,
  };
}

function dedupeLayoutItemsByViewId(
  items: DashboardLayoutItem[],
): DashboardLayoutItem[] {
  const seen = new Set<string>();
  const out: DashboardLayoutItem[] = [];
  for (const item of items) {
    if (seen.has(item.view_id)) {
      continue;
    }
    seen.add(item.view_id);
    out.push(item);
  }
  return out;
}

export function reconcileLayout(
  layout: DashboardBreakpointLayout,
  anchoredViewId?: string,
): DashboardBreakpointLayout {
  const uniqueItems = dedupeLayoutItemsByViewId(layout.items);
  const anchoredItem = anchoredViewId
    ? uniqueItems.find((item) => item.view_id === anchoredViewId)
    : undefined;
  const orderedItems = [
    ...(anchoredItem ? [anchoredItem] : []),
    ...uniqueItems
      .filter((item) => item.view_id !== anchoredViewId)
      .sort((left, right) => left.y - right.y || left.x - right.x),
  ];

  const placed: DashboardLayoutItem[] = [];
  for (const rawItem of orderedItems) {
    const nextItem = clampLayoutItem(rawItem, layout.cols);
    while (placed.some((candidate) => intersects(candidate, nextItem))) {
      nextItem.y += 1;
    }
    placed.push(nextItem);
  }

  const compacted = compactLayout(placed);

  return {
    ...layout,
    row_height: effectiveLayoutRowHeight(layout.row_height),
    items: compacted.sort((left, right) => left.y - right.y || left.x - right.x),
  };
}

export function createAppendedLayoutItem(
  layout: DashboardBreakpointLayout,
  viewId: string,
): DashboardLayoutItem {
  const nextY = layout.items.reduce((maxY, item) => Math.max(maxY, item.y + item.h), 0);
  const defaultWidth = layout.cols >= 12 ? 6 : layout.cols;

  return {
    view_id: viewId,
    x: 0,
    y: nextY,
    w: defaultWidth,
    h: 7,
  };
}

function clampLayoutItem(
  item: DashboardLayoutItem,
  cols: number,
): DashboardLayoutItem {
  const width = Math.max(1, Math.min(item.w, cols));
  return {
    ...item,
    x: Math.max(0, Math.min(item.x, cols - width)),
    y: Math.max(0, item.y),
    w: width,
    h: Math.max(1, item.h),
  };
}

function compactLayout(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const placed: DashboardLayoutItem[] = [];

  for (const item of [...items].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const nextItem = { ...item };
    while (nextItem.y > 0) {
      const candidate = { ...nextItem, y: nextItem.y - 1 };
      if (placed.some((placedItem) => intersects(placedItem, candidate))) {
        break;
      }
      nextItem.y -= 1;
    }
    placed.push(nextItem);
  }

  return placed;
}

function intersects(
  left: DashboardLayoutItem,
  right: DashboardLayoutItem,
): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}
