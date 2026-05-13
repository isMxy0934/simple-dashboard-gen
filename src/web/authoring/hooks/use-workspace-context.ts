"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceContextPayload, WorkspaceMember } from "@/contracts";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";
import {
  loadWorkspaceContext,
  loadAuthoringSettings,
  saveAuthoringVerboseSetting,
} from "../api/workspace-api";
import { randomUuid } from "../../utils/random-uuid";

const SELECTED_USER_STORAGE_KEY = "ai-dashboard-studio.selected-user.v1";

function getEditingSessionStorageKey(dashboardId: string | null | undefined) {
  return `ai-dashboard-studio.editing-session.v1:${dashboardId ?? "new"}`;
}

function getChatSessionStorageKey(dashboardId: string | null | undefined) {
  return `ai-dashboard-studio.chat-session.v1:${dashboardId ?? "new"}`;
}

function getOrCreateStoredSessionId(storageKey: string) {
  if (typeof window === "undefined") {
    return `sess_${randomUuid()}`;
  }

  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const next = `sess_${randomUuid()}`;
  window.sessionStorage.setItem(storageKey, next);
  return next;
}

function persistStoredSessionId(storageKey: string, sessionId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(storageKey, sessionId);
}

export function useWorkspaceContext(dashboardId?: string | null) {
  const [context, setContext] = useState<WorkspaceContextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedUserId, setSelectedUserIdState] = useState<string>("");
  const [verbose, setVerbose] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string>(() =>
    getOrCreateStoredSessionId(getEditingSessionStorageKey(dashboardId)),
  );
  const [chatSessionId, setChatSessionId] = useState<string>(() =>
    getOrCreateStoredSessionId(getChatSessionStorageKey(dashboardId)),
  );

  useEffect(() => {
    setEditingSessionId(
      getOrCreateStoredSessionId(getEditingSessionStorageKey(dashboardId)),
    );
    setChatSessionId(
      getOrCreateStoredSessionId(getChatSessionStorageKey(dashboardId)),
    );
  }, [dashboardId]);

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
        if (!nextUserId) {
          setVerbose(false);
          return;
        }
        void loadAuthoringSettings({
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
    const nextUserId = userId.trim();
    setSelectedUserIdState(nextUserId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_USER_STORAGE_KEY, nextUserId);
    }
    if (!nextUserId) {
      setVerbose(false);
      return;
    }
    void loadAuthoringSettings({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: nextUserId,
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
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: selectedUserId,
      verbose: nextVerbose,
    });
    setVerbose(saved.verbose);
  }, [selectedUserId]);

  const selectChatSessionId = useCallback((nextSessionId: string) => {
    const trimmed = nextSessionId.trim();
    if (!trimmed) {
      return;
    }
    persistStoredSessionId(getChatSessionStorageKey(dashboardId), trimmed);
    setChatSessionId(trimmed);
  }, [dashboardId]);

  const createNewChatSession = useCallback(() => {
    const nextSessionId = `sess_${randomUuid()}`;
    persistStoredSessionId(getChatSessionStorageKey(dashboardId), nextSessionId);
    setChatSessionId(nextSessionId);
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
    resolved: !loading && !error && Boolean(selectedUserId),
    workspaceId: DEFAULT_WORKSPACE_ID,
    workspaceName: context?.workspace_name ?? "",
    users: context?.users ?? [],
    selectedUserId,
    effectiveUserId: selectedUserId,
    selectedUser,
    setSelectedUserId,
    verbose,
    setVerbose: toggleVerbose,
    editingSessionId,
    chatSessionId,
    selectChatSessionId,
    createNewChatSession,
  };
}
