"use client";

import type { WorkspaceMember } from "@/contracts";
import styles from "./management.module.css";

interface SettingsPanelProps {
  workspaceName: string;
  users: WorkspaceMember[];
  selectedUserId: string;
  verbose: boolean;
  loading: boolean;
  error: string;
  onSelectUser: (userId: string) => void;
  onToggleVerbose: (nextVerbose: boolean) => void;
}

export function SettingsPanel({
  workspaceName,
  users,
  selectedUserId,
  verbose,
  loading,
  error,
  onSelectUser,
  onToggleVerbose,
}: SettingsPanelProps) {
  return (
    <section className={styles.overviewGrid}>
      <div className={styles.overviewBody}>
        <section className={styles.overviewFeed}>
          <div className={styles.overviewPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.headerEyebrow}>Settings</div>
                <h2 className={styles.pageTitle}>工作区设置</h2>
              </div>
            </div>

            <div className={styles.settingsPanelBody}>
              <label className={styles.settingsField}>
                <span>Workspace</span>
                <input value={workspaceName} readOnly />
              </label>

              <label className={styles.settingsField}>
                <span>Current User</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => onSelectUser(event.target.value)}
                >
                  {users.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.settingsToggle}>
                <input
                  type="checkbox"
                  checked={verbose}
                  onChange={(event) => onToggleVerbose(event.target.checked)}
                />
                <div>
                  <strong>Verbose agent trace</strong>
                  <p>只对当前用户生效。打开后会显示 worker route 与详细过程。</p>
                </div>
              </label>

              {loading ? (
                <div className={styles.settingsState}>Loading settings…</div>
              ) : null}
              {error ? <div className={styles.settingsState}>{error}</div> : null}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
