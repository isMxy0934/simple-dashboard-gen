import type { CSSProperties } from "react";
import {
  getTemplateCapability,
  type TemplateViewKindVisualContract,
} from "@/contracts/dashboard-template-capability-registry";
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
    { templateId: runtime.id },
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
          {runtime.pickerPreview.sampleViewKinds.map((sample, index) => {
            const capability = getTemplateCapability(runtime.id, sample.viewKind);
            if (!capability) {
              return null;
            }
            const visual = capability.visual;
            return (
              <span
                key={`${sample.viewKind}:${index}`}
                className={`${styles.runtimePreviewCard} ${
                  visual.preview.width === "wide"
                    ? styles.runtimePreviewCardWide
                    : styles.runtimePreviewCardHalf
                }`}
                data-card-chrome={visual.cardChrome}
                data-preview-body={visual.preview.body}
                data-emphasis={sample.emphasis}
                style={buildPreviewCardStyle(visual)}
              >
                <span className={styles.runtimePreviewCardHeader}>
                  <span className={styles.runtimePreviewCardTitleBlock}>
                    <span className={styles.runtimePreviewCardEyebrow} />
                    <span className={styles.runtimePreviewCardTitle} />
                  </span>
                  {visual.statusPlacement === "topline" ? (
                    <span className={styles.runtimePreviewStatus} />
                  ) : null}
                </span>
                {visual.localFilterPlacement === "inline" ? (
                  <span className={styles.runtimePreviewInlineFilters}>
                    <span className={styles.runtimePreviewInlineFilter} />
                    <span className={styles.runtimePreviewInlineFilter} />
                  </span>
                ) : null}
                {visual.localFilterPlacement === "toolbar" ? (
                  <span className={styles.runtimePreviewCardToolbar}>
                    <span className={styles.runtimePreviewToolbarPill} />
                    <span className={styles.runtimePreviewToolbarPill} />
                  </span>
                ) : null}
                <PreviewBody body={visual.preview.body} />
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}

function buildPreviewCardStyle(
  visual: TemplateViewKindVisualContract,
): CSSProperties {
  const style = {} as CSSProperties & Record<`--${string}`, string>;
  const tokens = visual.tokens;
  if (tokens?.cardBorderColor) {
    style["--runtime-preview-card-border-color"] = tokens.cardBorderColor;
  }
  if (tokens?.cardRadius) {
    style["--runtime-preview-card-radius"] = tokens.cardRadius;
  }
  if (tokens?.cardShadow) {
    style["--runtime-preview-card-shadow"] = tokens.cardShadow;
  }
  if (tokens?.bodyBackground) {
    style["--runtime-preview-card-background"] = tokens.bodyBackground;
  }
  return style;
}
