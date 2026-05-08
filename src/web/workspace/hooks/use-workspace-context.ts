"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceContextPayload, WorkspaceMember } from "@/contracts";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";
import {
  loadWorkspaceContext,
  loadWorkspaceUserSettings,
  saveWorkspaceVerboseSetting,
} from "../api/workspace-api";

const SELECTED_USER_STORAGE_KEY = "ai-dashboard-studio.selected-user.v1";

export function useWorkspaceContext() {
  const [context, setContext] = useState<WorkspaceContextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedUserId, setSelectedUserIdState] = useState<string>("");
  const [verbose, setVerbose] = useState(false);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    void loadWorkspaceContext(DEFAULT_WORKSPACE_ID)
      .then((payload) => {
        if (!active) {
          return;
        }

        setContext(payload);
        const persistedUserId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SELECTED_USER_STORAGE_KEY) ?? ""
            : "";
        const nextUserId =
          payload.users.find((user) => user.user_id === persistedUserId)?.user_id ??
          payload.users[0]?.user_id ??
          "";
        setSelectedUserIdState(nextUserId);
        void loadWorkspaceUserSettings({
          workspaceId: DEFAULT_WORKSPACE_ID,
          userId: nextUserId,
        })
          .then((settings) => {
            if (active) {
              setVerbose(settings.verbose);
            }
          })
          .catch(() => {
            if (active) {
              setVerbose(false);
            }
          });
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }

        setContext(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load workspace context.",
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const setSelectedUserId = useCallback((userId: string) => {
    setSelectedUserIdState(userId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_USER_STORAGE_KEY, userId);
    }
    void loadWorkspaceUserSettings({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId,
    })
      .then((settings) => {
        setVerbose(settings.verbose);
      })
      .catch(() => {
        setVerbose(false);
      });
  }, []);

  const toggleVerbose = useCallback(async (nextVerbose: boolean) => {
    if (!selectedUserId) {
      return;
    }
    const saved = await saveWorkspaceVerboseSetting({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: selectedUserId,
      verbose: nextVerbose,
    });
    setVerbose(saved.verbose);
  }, [selectedUserId]);

  const selectedUser = useMemo<WorkspaceMember | null>(() => {
    return (
      context?.users.find((user) => user.user_id === selectedUserId) ?? null
    );
  }, [context, selectedUserId]);

  return {
    loading,
    error,
    workspaceId: DEFAULT_WORKSPACE_ID,
    workspaceName: context?.workspace_name ?? "",
    users: context?.users ?? [],
    selectedUserId,
    selectedUser,
    setSelectedUserId,
    verbose,
    setVerbose: toggleVerbose,
  };
}
