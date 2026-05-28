import type { CSSProperties } from "react";
import { resolveViewFamily } from "@/contracts/dashboard-view-family-registry";
import { dashboardThemeCssVariables } from "@/presentation/dashboard/themes";
import { resolveTemplateRuntime } from "@/presentation/dashboard/runtime";
import styles from "./template-picker.module.css";

function PreviewBody({ body }: { body: "metric" | "trend" | "signal" | "analysis" }) {
  if (body === "metric") {
    return (
      <span className={styles.runtimePreviewMetricBody}>
        <span className={styles.runtimePreviewMetricValue} />
        <span className={styles.runtimePreviewMetricDelta} />
      </span>
    );
  }

  if (body === "signal") {
    return (
      <span className={styles.runtimePreviewSignalBody}>
        <span />
        <span />
        <span />
      </span>
    );
  }

  if (body === "analysis") {
    return (
      <span className={styles.runtimePreviewAnalysisBody}>
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }

  return (
    <span className={styles.runtimePreviewTrendBody}>
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function TemplatePreview({ templateId }: { templateId: string }) {
  const runtime = resolveTemplateRuntime(templateId);
  const runtimeStyle = dashboardThemeCssVariables(
    runtime.shell.defaultColorThemeId,
    runtime.id,
  ) as CSSProperties;

  return (
    <span className={styles.runtimePreview} style={runtimeStyle} aria-hidden="true">
      <span className={styles.runtimePreviewShell}>
        {runtime.pickerPreview.hero ? <span className={styles.runtimePreviewHero} /> : null}
        {runtime.pickerPreview.controlBand ? (
          <span className={styles.runtimePreviewToolbar}>
            <span className={styles.runtimePreviewControlPill} />
            <span className={styles.runtimePreviewControlPill} />
            <span className={styles.runtimePreviewControlAction} />
          </span>
        ) : null}
        <span
          className={styles.runtimePreviewCanvas}
          data-template-canvas-style={runtime.shell.canvasStyle}
        >
          {runtime.pickerPreview.sampleFamilies.map((sample, index) => {
            const family = resolveViewFamily(sample.familyId);
            return (
              <span
                key={`${sample.familyId}:${index}`}
                className={`${styles.runtimePreviewCard} ${
                  family.preview.width === "wide"
                    ? styles.runtimePreviewCardWide
                    : styles.runtimePreviewCardHalf
                }`}
                data-view-family={family.id}
                data-card-chrome={family.cardChrome}
                data-emphasis={sample.emphasis}
              >
                <span className={styles.runtimePreviewCardHeader}>
                  <span className={styles.runtimePreviewCardTitleBlock}>
                    <span className={styles.runtimePreviewCardEyebrow} />
                    <span className={styles.runtimePreviewCardTitle} />
                  </span>
                  {family.statusPlacement === "topline" ? (
                    <span className={styles.runtimePreviewStatus} />
                  ) : null}
                </span>
                {family.localFilterPlacement === "inline" ? (
                  <span className={styles.runtimePreviewInlineFilters}>
                    <span className={styles.runtimePreviewInlineFilter} />
                    <span className={styles.runtimePreviewInlineFilter} />
                  </span>
                ) : null}
                {family.localFilterPlacement === "toolbar" ? (
                  <span className={styles.runtimePreviewCardToolbar}>
                    <span className={styles.runtimePreviewToolbarPill} />
                    <span className={styles.runtimePreviewToolbarPill} />
                  </span>
                ) : null}
                <PreviewBody body={family.preview.body} />
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}
