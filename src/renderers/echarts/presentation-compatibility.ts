import type { DashboardRenderer } from "@/contracts";
import {
  analyzeDashboardRendererPresentationCompatibility,
  type DashboardRendererPresentationCompatibility,
} from "@/presentation/dashboard/renderer-compatibility";
import type { RendererValidationCheck } from "@/renderers/core/validation-result";

function formatPathList(paths: string[]): string {
  const visiblePaths = paths.slice(0, 5).join(", ");
  return paths.length > 5 ? `${visiblePaths}, +${paths.length - 5} more` : visiblePaths;
}

export function validateEChartsRendererPresentationCompatibility(
  renderer: DashboardRenderer,
): RendererValidationCheck {
  const compatibility = analyzeDashboardRendererPresentationCompatibility(renderer);
  const messages = buildPresentationCompatibilityMessages(compatibility);

  if (messages.length === 0) {
    return {
      target: "presentation",
      status: "ok",
      reason: "Renderer option template is compatible with dashboard presentation tokens.",
    };
  }

  return {
    target: "presentation",
    status: "warning",
    reason: "Renderer option template has presentation compatibility warnings.",
    message: messages.join(" "),
  };
}

function buildPresentationCompatibilityMessages(
  compatibility: DashboardRendererPresentationCompatibility,
): string[] {
  const messages: string[] = [];

  if (compatibility.hardcodedColorPaths.length > 0) {
    const migratableCount = compatibility.hardcodedColors.filter(
      (entry) => entry.status === "migratable",
    ).length;
    const unknownCount = compatibility.hardcodedColors.length - migratableCount;
    const migrationHint =
      migratableCount > 0
        ? ` ${migratableCount} exact theme-token match(es) can be migrated safely; ${unknownCount} value(s) remain warning-only.`
        : "";
    messages.push(
      `Hardcoded ECharts colors will not respond to dashboard theme changes: ${formatPathList(compatibility.hardcodedColorPaths)}.${migrationHint}`,
    );
  }

  if (compatibility.migrations.length > 0) {
    messages.push(
      `Legacy renderer slot paths were detected: ${compatibility.migrations
        .map((migration) => `${migration.slotId} ${migration.fromPath} -> ${migration.toPath}`)
        .join(", ")}.`,
    );
  }

  return messages;
}
