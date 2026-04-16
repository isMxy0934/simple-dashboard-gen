"use client";

import { useEffect, useState } from "react";
import { loadEditingPresence } from "../api/workspace-api";

export function useAuthoringPresence(input: {
  workspaceId: string;
  dashboardId?: string | null;
}) {
  const [editingPresence, setEditingPresence] = useState<
    Array<{
      user_name: string;
      session_id: string;
      is_active: boolean;
      last_saved_at?: string | null;
    }>
  >([]);

  useEffect(() => {
    if (!input.dashboardId) {
      return;
    }

    let active = true;
    const load = async () => {
      const dashboardId = input.dashboardId;
      if (!dashboardId) {
        return;
      }
      try {
        const presence = await loadEditingPresence({
          workspaceId: input.workspaceId,
          dashboardId,
        });
        if (active) {
          setEditingPresence(presence);
        }
      } catch {
        if (active) {
          setEditingPresence([]);
        }
      }
    };

    void load();
    const id = window.setInterval(() => {
      void load();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [input.dashboardId, input.workspaceId]);

  return {
    editingPresence,
    activeEditorNames: editingPresence
      .filter((entry) => entry.is_active)
      .map((entry) => entry.user_name),
  };
}
