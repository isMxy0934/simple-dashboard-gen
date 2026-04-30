import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  parseAuthoringSkillReferenceCheck,
  type AuthoringSkillReferenceCheck,
} from "@/ai/authoring/contracts/skill";
import type { ContextStatusV2 } from "@/ai/authoring/v2/types";

export type ChartCapabilityDataShapeV2 = NonNullable<
  ContextStatusV2["dataFormatSkillLoadedFor"]
>["shape"];

export interface ChartCapabilityV2 {
  chartType: string;
  viewType: string;
  skillId: string;
  referenceName: string;
  referenceKey: string;
  rendererKind: "echarts";
  intentAliases: string[];
  dataShape: ChartCapabilityDataShapeV2;
  pairedDataFormatSkill: string | null;
  requiredSlots: Extract<
    AuthoringSkillReferenceCheck,
    { kind: "echarts-view" }
  >["required_slots"];
  defaultLayout?: Extract<
    AuthoringSkillReferenceCheck,
    { kind: "echarts-view" }
  >["default_layout"];
  supportsCreate: boolean;
  supportsRevise: boolean;
  unsupportedMessage?: string;
  check: Extract<AuthoringSkillReferenceCheck, { kind: "echarts-view" }>;
}

const INTERNAL_SKILLS_ROOT = path.join(
  process.cwd(),
  "src",
  "ai",
  "authoring",
  "skills",
);

function isEchartsCheck(
  check: AuthoringSkillReferenceCheck | null,
): check is Extract<AuthoringSkillReferenceCheck, { kind: "echarts-view" }> {
  return check?.kind === "echarts-view";
}

function buildCapabilityFromCheck(
  check: Extract<AuthoringSkillReferenceCheck, { kind: "echarts-view" }>,
): ChartCapabilityV2 {
  return {
    chartType: check.chart_type,
    viewType: check.supported_view_type,
    skillId: check.skill_id,
    referenceName: check.reference_name,
    referenceKey: check.reference_key,
    rendererKind: check.required_renderer_kind,
    intentAliases: [...new Set(check.intent_aliases)],
    dataShape: check.data_shape,
    pairedDataFormatSkill: check.paired_data_formats[0] ?? null,
    requiredSlots: check.required_slots,
    ...(check.default_layout ? { defaultLayout: check.default_layout } : {}),
    supportsCreate: check.supports_create,
    supportsRevise: check.supports_revise,
    ...(check.unsupported_message
      ? { unsupportedMessage: check.unsupported_message }
      : {}),
    check,
  };
}

function scanChartCapabilities(): ChartCapabilityV2[] {
  const capabilities: ChartCapabilityV2[] = [];
  const skillDirs = readdirSync(INTERNAL_SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const skillId of skillDirs) {
    const referencesDir = path.join(INTERNAL_SKILLS_ROOT, skillId, "references");
    let referenceFiles: string[];
    try {
      referenceFiles = readdirSync(referencesDir)
        .filter((name) => name.endsWith(".md"))
        .sort((left, right) => left.localeCompare(right));
    } catch (err) {
      console.warn(
        `[chart-capabilities] Failed to read references directory for skill "${skillId}"; skipping. Error:`,
        err,
      );
      continue;
    }

    for (const referenceFile of referenceFiles) {
      const referenceName = referenceFile.replace(/\.md$/i, "");
      const content = readFileSync(path.join(referencesDir, referenceFile), "utf8");
      const check = parseAuthoringSkillReferenceCheck({
        skillId,
        referenceName,
        content,
      });
      if (isEchartsCheck(check)) {
        capabilities.push(buildCapabilityFromCheck(check));
      }
    }
  }

  return capabilities;
}

let cachedCapabilities: ChartCapabilityV2[] | null = null;

export function getChartCapabilitiesV2(): ChartCapabilityV2[] {
  cachedCapabilities ??= scanChartCapabilities();
  return cachedCapabilities;
}

function normalizeCapabilityText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function findChartCapabilityV2(
  chartType: string | null | undefined,
): ChartCapabilityV2 | null {
  const normalized = normalizeCapabilityText(chartType);
  if (!normalized) {
    return null;
  }
  return (
    getChartCapabilitiesV2().find(
      (capability) =>
        normalizeCapabilityText(capability.chartType) === normalized ||
        normalizeCapabilityText(capability.viewType) === normalized ||
        normalizeCapabilityText(capability.referenceName) === normalized ||
        capability.intentAliases.some(
          (alias) => normalizeCapabilityText(alias) === normalized,
        ),
    ) ?? null
  );
}

export function findChartCapabilityByReferenceKeyV2(
  referenceKey: string | null | undefined,
): ChartCapabilityV2 | null {
  const normalized = referenceKey?.trim();
  if (!normalized) {
    return null;
  }
  return (
    getChartCapabilitiesV2().find(
      (capability) => capability.referenceKey === normalized,
    ) ?? null
  );
}
