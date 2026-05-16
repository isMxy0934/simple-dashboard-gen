"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DashboardTemplateSummary } from "@/domain/dashboard/templates";
import { listDashboardTemplateSummaries } from "@/domain/dashboard/templates";
import { createManagementDashboard } from "@/web/management/api/management-api";
import { useI18n } from "@/web/i18n/i18n-context";
import { useWorkspaceContext } from "../hooks/use-workspace-context";
import styles from "./template-picker.module.css";

const accentClassByName: Record<DashboardTemplateSummary["accent"], string> = {
  purple: styles.cardPurple,
  teal: styles.cardTeal,
  gold: styles.cardGold,
};

export function TemplatePickerPage() {
  const router = useRouter();
  const { t } = useI18n();
  const {
    loading,
    error: workspaceError,
    workspaceId,
    workspaceName,
    selectedUserId,
  } = useWorkspaceContext("new");
  const [creatingTemplateId, setCreatingTemplateId] = useState("");
  const [createError, setCreateError] = useState("");
  const templates = useMemo(() => listDashboardTemplateSummaries(), []);
  const isBusy = Boolean(creatingTemplateId);
  const canCreate = !loading && !workspaceError && Boolean(workspaceId && selectedUserId);

  async function handleCreate(template: DashboardTemplateSummary) {
    if (!canCreate || isBusy) {
      return;
    }

    setCreateError("");
    setCreatingTemplateId(template.id);
    try {
      const dashboardId = await createManagementDashboard({
        workspaceId,
        userId: selectedUserId,
        templateId: template.id,
        templateVersion: template.version,
      });
      router.push(`/authoring/${encodeURIComponent(dashboardId)}`);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : t("authoring.templates.createFailed"),
      );
      setCreatingTemplateId("");
    }
  }

  const readinessText = loading
    ? t("authoring.templates.workspaceLoading")
    : workspaceError || (!canCreate ? t("authoring.templates.workspaceUnavailable") : "");

  return (
    <main className={styles.shell} aria-labelledby="template-picker-title">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Link href="/?section=reports&tab=drafts" className={styles.backLink}>
            {t("authoring.templates.backReports")}
          </Link>
          <div>
            <p className={styles.eyebrow}>
              {workspaceName || t("authoring.templates.workspaceFallback")}
            </p>
            <h1 id="template-picker-title">{t("authoring.templates.pickerTitle")}</h1>
          </div>
        </div>
        <p className={styles.hint}>{t("authoring.templates.pickerHint")}</p>
      </div>

      {(readinessText || createError) && (
        <div className={styles.notice} role={createError ? "alert" : "status"}>
          {createError || readinessText}
        </div>
      )}

      <section
        className={styles.grid}
        aria-label={t("authoring.templates.templateListAria")}
      >
        {templates.map((template) => {
          const isCreating = creatingTemplateId === template.id;
          const disabled = !canCreate || (isBusy && !isCreating);
          return (
            <button
              key={`${template.id}:${template.version}`}
              type="button"
              className={[
                styles.card,
                accentClassByName[template.accent],
                disabled ? styles.cardDisabled : "",
              ].join(" ")}
              disabled={disabled}
              aria-describedby={`${template.id}-description`}
              onClick={() => void handleCreate(template)}
            >
              <span className={styles.cardTopline}>
                <span className={styles.badge}>{t(template.badgeKey)}</span>
                <span className={styles.version}>
                  {t("authoring.templates.version", { version: template.version })}
                </span>
              </span>
              <span className={styles.preview} aria-hidden="true">
                <span className={styles.previewHero} />
                <span className={styles.previewRow}>
                  <span />
                  <span />
                </span>
                <span className={styles.previewWide} />
              </span>
              <span className={styles.cardBody}>
                <strong>{t(template.nameKey)}</strong>
                <span id={`${template.id}-description`}>
                  {t(template.descriptionKey)}
                </span>
              </span>
              <span className={styles.metaRow}>
                <span>
                  {t("authoring.templates.cards", { count: template.cardCount })}
                </span>
                <span>
                  {t("authoring.templates.filters", { count: template.filterCount })}
                </span>
              </span>
              <span className={styles.featureRow}>
                {template.featureKeys.map((featureKey) => (
                  <span key={featureKey}>{t(featureKey)}</span>
                ))}
              </span>
              <span className={styles.actionText}>
                {isCreating
                  ? t("authoring.templates.creating")
                  : t("authoring.templates.useTemplate")}
              </span>
            </button>
          );
        })}
        <div className={[styles.card, styles.cardComingSoon].join(" ")}>
          <span className={styles.cardTopline}>
            <span className={styles.badge}>{t("authoring.templates.more.badge")}</span>
            <span className={styles.version}>
              {t("management.common.comingSoon")}
            </span>
          </span>
          <span className={styles.preview} aria-hidden="true">
            <span className={styles.previewHero} />
            <span className={styles.previewRow}>
              <span />
              <span />
            </span>
            <span className={styles.previewWide} />
          </span>
          <span className={styles.cardBody}>
            <strong>{t("authoring.templates.more.name")}</strong>
            <span>{t("authoring.templates.more.description")}</span>
          </span>
          <span className={styles.featureRow}>
            <span>{t("authoring.templates.more.featureStructure")}</span>
            <span>{t("authoring.templates.more.featureGoverned")}</span>
          </span>
          <span className={styles.disabledAction} aria-disabled="true">
            {t("management.common.comingSoon")}
          </span>
        </div>
      </section>
    </main>
  );
}
