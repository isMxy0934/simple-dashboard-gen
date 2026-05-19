"use client";

import type { TranslateFn } from "../../i18n";
import type { ViewRenderStatus } from "../state/rendered-views";
import styles from "./viewer.module.css";

export function StatusPill({
  status,
  t,
}: {
  status: ViewRenderStatus | "template";
  t: TranslateFn;
}) {
  const label =
    status === "loading"
      ? t("viewer.dashboard.pillLoading")
      : status === "ok"
        ? t("viewer.dashboard.pillOk")
        : status === "empty"
          ? t("viewer.dashboard.pillEmpty")
          : status === "template"
            ? t("viewer.dashboard.pillTemplate")
            : t("viewer.dashboard.pillError");
  const className =
    status === "loading"
      ? styles.statusLoading
      : status === "ok"
        ? styles.statusOk
        : status === "empty"
          ? styles.statusEmpty
          : status === "template"
            ? styles.statusEmpty
            : styles.statusError;

  return <span className={`${styles.statusPill} ${className}`}>{label}</span>;
}

export function LoadingState({ t }: { t: TranslateFn }) {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingBars} aria-hidden="true">
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
      </div>
      <div className={styles.stateTitle}>{t("viewer.dashboard.loadingTitle")}</div>
      <p className={styles.stateBody}>{t("viewer.dashboard.loadingBody")}</p>
    </div>
  );
}

export function EmptyState({
  message,
  t,
}: {
  message: string;
  t: TranslateFn;
}) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.stateTitle}>{t("viewer.dashboard.emptyTitle")}</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}

export function ErrorState({
  message,
  t,
}: {
  message: string;
  t: TranslateFn;
}) {
  return (
    <div className={styles.errorState}>
      <div className={styles.stateTitle}>{t("viewer.dashboard.errorTitle")}</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}
