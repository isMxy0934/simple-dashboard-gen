"use client";

import { useRef, useState } from "react";
import {
  getAiDockPanelSize,
  useAiDockPosition,
} from "./use-ai-dock-position";

export function useAuthoringDock() {
  const dockBoundsRef = useRef<HTMLDivElement | null>(null);
  const [chatDockCollapsed, setChatDockCollapsed] = useState(false);
  const {
    position: chatDockPosition,
    dragging: chatDockDragging,
    beginDrag: beginChatDockDrag,
    onDragPointerMove: onChatDockPointerMove,
    endDragCapsule: endChatDockCapsule,
    endDragHeader: endChatDockHeader,
  } = useAiDockPosition(chatDockCollapsed, dockBoundsRef);

  return {
    dockBoundsRef,
    chatDockCollapsed,
    setChatDockCollapsed,
    chatDockPosition,
    chatDockDragging,
    beginChatDockDrag,
    onChatDockPointerMove,
    endChatDockCapsule,
    endChatDockHeader,
    getAiDockPanelSize,
  };
}
