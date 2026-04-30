import type { DatasourceContext } from "@/contracts";
import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringGoal, ContextStatus } from "@/ai/authoring/workflow/types";

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

function chartSkillIdsFromCatalog(skills: Iterable<AuthoringSkillSummary>) {
  return [...skills]
    .filter((skill) => skill.id.startsWith("echarts-"))
    .map((skill) => skill.id)
    .sort((left, right) => left.localeCompare(right));
}

export function buildContextStatusSnapshot(input: {
  goal?: AuthoringGoal | null;
  datasourceListLoaded: boolean;
  datasourceSchemaCache: Map<string, DatasourceContext>;
  datasourceSchemaLoadedAt: Map<string, string>;
  skillCatalog: Iterable<AuthoringSkillSummary>;
  loadedSkillContent: Map<string, string>;
  loadedSkillLoadedAt: Map<string, string>;
  now?: string;
}): ContextStatus {
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
  const availableChartSkillIds = chartSkillIdsFromCatalog(input.skillCatalog);
  const chartSkillId = input.goal?.chartPlan?.chartSkillId;
  const loadedSkillBody = chartSkillId
    ? input.loadedSkillContent.get(chartSkillId)
    : undefined;

  return {
    datasourcesLoaded: input.datasourceListLoaded,
    availableChartSkillIds,
    ...(schemaLoadedFor ? { schemaLoadedFor } : {}),
    ...(chartSkillId && loadedSkillBody
      ? {
          chartSkillLoadedFor: {
            skillId: chartSkillId,
            version: hashStableJson(
              { skillId: chartSkillId, content: loadedSkillBody },
              "skill",
            ),
            loadedAt: input.loadedSkillLoadedAt.get(chartSkillId) ?? loadedAt,
          },
        }
      : {}),
  };
}
