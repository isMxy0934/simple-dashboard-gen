"use client";

import type { ReactNode } from "react";
import styles from "./viewer.module.css";

export function ViewerRendererWarningStack({
  warning,
  children,
}: {
  warning?: string | null;
  children: ReactNode;
}) {
  if (!warning) {
    return <>{children}</>;
  }

  return (
    <div className={styles.rendererWarningStack}>
      <div className={styles.rendererWarningNotice} role="status" aria-live="polite">
        {warning}
      </div>
      {children}
    </div>
  );
}
