import type { DatasourceContext } from "@/contracts";
import type { AuthoringSkillReferenceCheck } from "@/ai/authoring/contracts/skill";
import type { AuthoringGoalV2, ContextStatusV2 } from "@/ai/authoring/v2/types";
import {
  dataShapeToContextShapeV2,
  expectedDataFormatShapeForGoalV2,
} from "@/ai/authoring/v2/context-shape";
import { findChartCapabilityV2 } from "@/ai/authoring/v2/chart-capabilities";

function chartSkillMatchesGoal(
  check: AuthoringSkillReferenceCheck,
  goal: AuthoringGoalV2 | null | undefined,
): boolean {
  if (check.kind !== "echarts-view") {
    return false;
  }
  const chartType = goal?.chartPlan?.chartType;
  if (!chartType) {
    return true;
  }
  const capability = findChartCapabilityV2(chartType);
  return capability
    ? check.reference_key === capability.referenceKey
    : check.chart_type === chartType;
}

function dataFormatSkillMatchesGoal(
  check: AuthoringSkillReferenceCheck,
  goal: AuthoringGoalV2 | null | undefined,
): boolean {
  if (check.kind !== "data-format") {
    return false;
  }
  const expectedShape = expectedDataFormatShapeForGoalV2(goal);
  return Boolean(
    expectedShape &&
      dataShapeToContextShapeV2(check.data_shape) === expectedShape,
  );
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const nested = input[key];
    if (nested !== undefined) {
      output[key] = sortKeysDeep(nested);
    }
  }
  return output;
}

export function hashStableJson(value: unknown, prefix: string) {
  const stable = JSON.stringify(sortKeysDeep(value));
  let hash = 0;
  for (let index = 0; index < stable.length; index++) {
    hash = (hash * 31 + stable.charCodeAt(index)) | 0;
  }
  return `${prefix}_${Math.abs(hash).toString(36)}`;
}

export function buildContextStatusSnapshotV2(input: {
  goal?: AuthoringGoalV2 | null;
  datasourceListLoaded: boolean;
  datasourceSchemaCache: Map<string, DatasourceContext>;
  datasourceSchemaLoadedAt: Map<string, string>;
  loadedSkillReferenceChecks: Iterable<AuthoringSkillReferenceCheck>;
  loadedSkillReferenceLoadedAt: Map<string, string>;
  now?: string;
}): ContextStatusV2 {
  const loadedChecks = [...input.loadedSkillReferenceChecks];
  const schemaDatasourceId = input.goal?.targetRefs.datasourceId;
  const schemaContext = schemaDatasourceId
    ? input.datasourceSchemaCache.get(schemaDatasourceId)
    : undefined;
  const loadedAt = input.now ?? new Date().toISOString();
  const schemaLoadedFor =
    schemaDatasourceId && schemaContext
      ? {
          datasourceId: schemaDatasourceId,
          ...(input.goal?.targetRefs.table ? { table: input.goal.targetRefs.table } : {}),
          fingerprint: hashStableJson(schemaContext, "schema"),
          loadedAt:
            input.datasourceSchemaLoadedAt.get(schemaDatasourceId) ??
            loadedAt,
        }
      : undefined;
  const chartCheck = loadedChecks.find((check) =>
    chartSkillMatchesGoal(check, input.goal),
  );
  const dataFormatCheck = loadedChecks.find((check) =>
    dataFormatSkillMatchesGoal(check, input.goal),
  );

  return {
    datasourcesLoaded: input.datasourceListLoaded,
    ...(schemaLoadedFor ? { schemaLoadedFor } : {}),
    ...(chartCheck && chartCheck.kind === "echarts-view"
      ? {
          chartSkillLoadedFor: {
            chartType:
              input.goal?.chartPlan?.chartType ??
              chartCheck.chart_type,
            referenceKey: chartCheck.reference_key,
            version: hashStableJson(chartCheck, "skill"),
            loadedAt:
              input.loadedSkillReferenceLoadedAt.get(chartCheck.reference_key) ??
              loadedAt,
          },
        }
      : {}),
    ...(dataFormatCheck && dataFormatCheck.kind === "data-format"
      ? {
          dataFormatSkillLoadedFor: {
            shape: dataShapeToContextShapeV2(dataFormatCheck.data_shape),
            referenceKey: dataFormatCheck.reference_key,
            version: hashStableJson(dataFormatCheck, "skill"),
            loadedAt:
              input.loadedSkillReferenceLoadedAt.get(dataFormatCheck.reference_key) ??
              loadedAt,
          },
        }
      : {}),
  };
}
