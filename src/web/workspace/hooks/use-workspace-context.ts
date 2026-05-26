"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkspaceContextPayload,
  WorkspaceMember,
  WorkspaceRoleId,
} from "@/contracts";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";
import type { AppLocale } from "../../i18n";
import { useI18n } from "../../i18n/i18n-context";
import {
  loadWorkspaceContext,
  loadWorkspaceUserSettings,
  saveWorkspaceLocaleSetting,
  saveWorkspaceVerboseSetting,
  updateWorkspaceUserRole,
} from "../api/workspace-api";

export function useWorkspaceContext() {
  const { setLocale } = useI18n();
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
        const nextUserId = payload.current_user_id || payload.users[0]?.user_id || "";
        setSelectedUserIdState(nextUserId);
        if (!nextUserId) {
          setVerbose(false);
          setLocale("zh");
          return;
        }
        void loadWorkspaceUserSettings({
          workspaceId: DEFAULT_WORKSPACE_ID,
          userId: nextUserId,
        })
          .then((settings) => {
            if (active) {
              setVerbose(settings.verbose);
              setLocale(settings.locale);
            }
          })
          .catch(() => {
            if (active) {
              setVerbose(false);
              setLocale("zh");
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
  }, [setLocale]);

  const setSelectedUserId = useCallback((userId: string) => {
    const nextUserId =
      context?.current_user_id && userId.trim() !== context.current_user_id
        ? context.current_user_id
        : userId.trim();
    setSelectedUserIdState(nextUserId);
    if (!nextUserId) {
      setVerbose(false);
      setLocale("zh");
      return;
    }
    void loadWorkspaceUserSettings({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: nextUserId,
    })
      .then((settings) => {
        setVerbose(settings.verbose);
        setLocale(settings.locale);
      })
      .catch(() => {
        setVerbose(false);
        setLocale("zh");
      });
  }, [context?.current_user_id, setLocale]);

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

  const updateLocale = useCallback(async (nextLocale: AppLocale) => {
    if (!selectedUserId) {
      setLocale(nextLocale);
      return;
    }
    const saved = await saveWorkspaceLocaleSetting({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: selectedUserId,
      locale: nextLocale,
    });
    setLocale(saved.locale);
  }, [selectedUserId, setLocale]);

  const updateUserRole = useCallback(async (input: {
    userId: string;
    roleId: WorkspaceRoleId;
  }) => {
    const result = await updateWorkspaceUserRole({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: input.userId,
      roleId: input.roleId,
    });
    setContext((current) =>
      current
        ? {
            ...current,
            users: current.users.map((user) =>
              user.user_id === result.user.user_id ? result.user : user,
            ),
          }
        : current,
    );
    return result;
  }, []);

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
    roles: context?.roles ?? [],
    currentUserId: context?.current_user_id ?? selectedUserId,
    currentUserPermissions: context?.current_user_permissions ?? [],
    canManageRoles:
      context?.current_user_permissions.includes("workspace.admin") ?? false,
    selectedUserId,
    effectiveUserId: selectedUserId,
    selectedUser,
    setSelectedUserId,
    updateUserRole,
    verbose,
    setVerbose: toggleVerbose,
    setUserLocale: updateLocale,
  };
}
