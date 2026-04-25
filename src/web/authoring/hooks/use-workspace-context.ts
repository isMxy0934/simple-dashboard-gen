"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceContextPayload, WorkspaceMember } from "@/contracts";
import {
  loadWorkspaceContext,
  loadAuthoringSettings,
  saveAuthoringVerboseSetting,
} from "../api/workspace-api";
import { randomUuid } from "../../utils/random-uuid";

const WORKSPACE_ID = "ws_default";
const SELECTED_USER_STORAGE_KEY = "ai-dashboard-studio.selected-user.v1";

function getTabSessionStorageKey(dashboardId: string | null | undefined) {
  return `ai-dashboard-studio.tab-session.v1:${dashboardId ?? "new"}`;
}

function getOrCreateTabSessionId(dashboardId: string | null | undefined) {
  if (typeof window === "undefined") {
    return `sess_${randomUuid()}`;
  }

  const storageKey = getTabSessionStorageKey(dashboardId);
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const next = `sess_${randomUuid()}`;
  window.sessionStorage.setItem(storageKey, next);
  return next;
}

function persistTabSessionId(
  dashboardId: string | null | undefined,
  sessionId: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getTabSessionStorageKey(dashboardId), sessionId);
}

export function useWorkspaceContext(dashboardId?: string | null) {
  const [context, setContext] = useState<WorkspaceContextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedUserId, setSelectedUserIdState] = useState<string>("");
  const [verbose, setVerbose] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() =>
    getOrCreateTabSessionId(dashboardId),
  );

  useEffect(() => {
    setSessionId(getOrCreateTabSessionId(dashboardId));
  }, [dashboardId]);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    void loadWorkspaceContext(WORKSPACE_ID)
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
        void loadAuthoringSettings({
          workspaceId: WORKSPACE_ID,
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
    void loadAuthoringSettings({
      workspaceId: WORKSPACE_ID,
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
    const saved = await saveAuthoringVerboseSetting({
      workspaceId: WORKSPACE_ID,
      userId: selectedUserId,
      verbose: nextVerbose,
    });
    setVerbose(saved.verbose);
  }, [selectedUserId]);

  const selectSessionId = useCallback((nextSessionId: string) => {
    const trimmed = nextSessionId.trim();
    if (!trimmed) {
      return;
    }
    persistTabSessionId(dashboardId, trimmed);
    setSessionId(trimmed);
  }, [dashboardId]);

  const createNewSession = useCallback(() => {
    const nextSessionId = `sess_${randomUuid()}`;
    persistTabSessionId(dashboardId, nextSessionId);
    setSessionId(nextSessionId);
    return nextSessionId;
  }, [dashboardId]);

  const selectedUser = useMemo<WorkspaceMember | null>(() => {
    return (
      context?.users.find((user) => user.user_id === selectedUserId) ?? null
    );
  }, [context, selectedUserId]);

  return {
    loading,
    error,
    workspaceId: WORKSPACE_ID,
    workspaceName: context?.workspace_name ?? "",
    users: context?.users ?? [],
    selectedUserId,
    selectedUser,
    setSelectedUserId,
    verbose,
    setVerbose: toggleVerbose,
    sessionId,
    selectSessionId,
    createNewSession,
  };
}
