"use client";

import { AuthoringApp } from "../../authoring";
import styles from "./management.module.css";

interface CreatorHostProps {
  dashboardId: string;
  sidebarCollapsed: boolean;
  onSaved: () => void;
  onToggleEmbeddedMenu: () => void;
}

export function CreatorHost({
  dashboardId,
  sidebarCollapsed,
  onSaved,
  onToggleEmbeddedMenu,
}: CreatorHostProps) {
  return (
    <section className={styles.creatorHost}>
      <AuthoringApp
        dashboardId={dashboardId}
        embedded
        onSaved={onSaved}
        onToggleEmbeddedMenu={onToggleEmbeddedMenu}
        embeddedMenuCollapsed={sidebarCollapsed}
      />
    </section>
  );
}
