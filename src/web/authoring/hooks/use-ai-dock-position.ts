"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const STORAGE_KEY = "authoring-ai-dock-pos-v1";
const CAPSULE = 48;
const DRAG_THRESHOLD_PX = 8;
/** When `boundsRef` is set, wait for that element to layout before first clamp. */
const MAX_BOUNDS_WAIT_FRAMES = 24;

/** Must match `.aiPanel` width / height in authoring.module.css (incl. @media max-width: 960px). */
function expandedPanelSize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const compact = vw <= 960;
  const w = Math.min(compact ? 420 : 380, vw - 24);
  const h = compact
    ? Math.min(Math.round(vh * 0.72), 720)
    : Math.min(Math.round(vh * 0.82), 680);
  return { w, h };
}

export function getAiDockPanelSize(collapsed: boolean): { w: number; h: number } {
  if (typeof window === "undefined") {
    return { w: collapsed ? CAPSULE : 380, h: collapsed ? CAPSULE : 680 };
  }
  if (collapsed) {
    return { w: CAPSULE, h: CAPSULE };
  }
  return expandedPanelSize();
}

function readBoundsRect(
  boundsElement: HTMLElement | null,
): DOMRectReadOnly | null {
  if (!boundsElement) {
    return null;
  }
  const r = boundsElement.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) {
    return null;
  }
  return r;
}

function clampDockPosition(
  x: number,
  y: number,
  collapsed: boolean,
  bounds: DOMRectReadOnly | null,
): { x: number; y: number } {
  const { w, h } = getAiDockPanelSize(collapsed);
  const pad = 8;
  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;
  if (bounds) {
    minX = bounds.left + pad;
    maxX = bounds.right - w - pad;
    minY = bounds.top + pad;
    maxY = bounds.bottom - h - pad;
  } else {
    minX = pad;
    maxX = Math.max(pad, window.innerWidth - w - pad);
    minY = pad;
    maxY = Math.max(pad, window.innerHeight - h - pad);
  }
  const loX = Math.min(minX, maxX);
  const hiX = Math.max(minX, maxX);
  const loY = Math.min(minY, maxY);
  const hiY = Math.max(minY, maxY);
  return {
    x: Math.min(Math.max(x, loX), hiX),
    y: Math.min(Math.max(y, loY), hiY),
  };
}

function defaultDockPosition(
  collapsed: boolean,
  bounds: DOMRectReadOnly | null,
): { x: number; y: number } {
  const { w, h } = getAiDockPanelSize(collapsed);
  if (bounds) {
    return clampDockPosition(
      bounds.right - w - 12,
      bounds.bottom - h - 12,
      collapsed,
      bounds,
    );
  }
  return clampDockPosition(
    window.innerWidth - w - 12,
    window.innerHeight - h - 12,
    collapsed,
    null,
  );
}

type GestureState = {
  kind: "capsule" | "header";
  pointerId: number;
  originX: number;
  originY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

export function useAiDockPosition(
  collapsed: boolean,
  boundsRef?: RefObject<HTMLElement | null>,
) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;

  const gestureRef = useRef<GestureState | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const prevCollapsedRef = useRef<boolean | null>(null);

  const readBounds = useCallback(
    () => readBoundsRect(boundsRef?.current ?? null),
    [boundsRef],
  );

  const reclampToBounds = useCallback(() => {
    const bounds = readBounds();
    setPos((p) => {
      if (p == null) {
        return p;
      }
      return clampDockPosition(p.x, p.y, collapsed, bounds);
    });
  }, [collapsed, readBounds]);

  useLayoutEffect(() => {
    let cancelled = false;
    let framesWaited = 0;

    const placeInitialPosition = () => {
      if (cancelled) {
        return;
      }
      framesWaited += 1;
      const bounds = readBoundsRect(boundsRef?.current ?? null);
      const needBounds = Boolean(boundsRef);
      const boundsReady = bounds != null;
      if (needBounds && !boundsReady && framesWaited < MAX_BOUNDS_WAIT_FRAMES) {
        window.requestAnimationFrame(placeInitialPosition);
        return;
      }

      const c = collapsedRef.current;
      const clampBounds = boundsReady ? bounds : null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
          if (typeof p.x === "number" && typeof p.y === "number") {
            setPos(clampDockPosition(p.x, p.y, c, clampBounds));
            return;
          }
        }
      } catch {
        // ignore
      }
      setPos(defaultDockPosition(c, clampBounds));
    };

    placeInitialPosition();

    return () => {
      cancelled = true;
    };
  }, [boundsRef]);

  useEffect(() => {
    setPos((p) => {
      if (p == null) {
        return p;
      }
      return clampDockPosition(
        p.x,
        p.y,
        collapsed,
        readBoundsRect(boundsRef?.current ?? null),
      );
    });
  }, [collapsed, boundsRef]);

  useEffect(() => {
    const onResize = () => {
      reclampToBounds();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reclampToBounds]);

  useEffect(() => {
    const onScroll = () => {
      reclampToBounds();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [reclampToBounds]);

  useEffect(() => {
    const el = boundsRef?.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      reclampToBounds();
    });
    ro.observe(el);
    reclampToBounds();
    return () => ro.disconnect();
  }, [boundsRef, reclampToBounds]);

  const persistPosition = useCallback((xy: { x: number; y: number }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(xy));
    } catch {
      // ignore
    }
  }, []);

  /** 收起时回到视口右下角（与默认一致） */
  useEffect(() => {
    const prev = prevCollapsedRef.current;
    if (prev === false && collapsed === true) {
      const bounds = readBoundsRect(boundsRef?.current ?? null);
      const next = defaultDockPosition(true, bounds);
      setPos(next);
      persistPosition(next);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed, boundsRef, persistPosition]);

  const beginDrag = useCallback(
    (kind: "capsule" | "header", event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const p = posRef.current;
      if (p === null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = {
        kind,
        pointerId: event.pointerId,
        originX: p.x,
        originY: p.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
      };
    },
    [],
  );

  const onDragPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== event.pointerId) return;
      const dx = event.clientX - g.startClientX;
      const dy = event.clientY - g.startClientY;
      if (!g.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        g.moved = true;
        setDragging(true);
      }
      if (g.moved) {
        setPos(
          clampDockPosition(
            g.originX + dx,
            g.originY + dy,
            collapsed,
            readBounds(),
          ),
        );
      }
    },
    [collapsed, readBounds],
  );

  const endDragCapsule = useCallback(
    (event: ReactPointerEvent<HTMLElement>, onOpen: () => void) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== event.pointerId) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      const final = posRef.current;
      if (g.moved && final) {
        persistPosition(final);
      } else if (!g.moved && g.kind === "capsule") {
        onOpen();
      }
      gestureRef.current = null;
      setDragging(false);
    },
    [persistPosition],
  );

  const endDragHeader = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== event.pointerId) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (g.moved && posRef.current) {
        persistPosition(posRef.current);
      }
      gestureRef.current = null;
      setDragging(false);
    },
    [persistPosition],
  );

  return {
    position: pos,
    dragging,
    beginDrag,
    onDragPointerMove,
    endDragCapsule,
    endDragHeader,
  };
}
