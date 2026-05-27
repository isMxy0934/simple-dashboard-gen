import type { DatasourceContext } from "@/contracts";
import {
  DASHBOARD_VIEW_KIND_IDS,
} from "@/contracts/dashboard-view-intent";
import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringGoal, ContextStatus } from "@/ai/authoring/contracts/progress";
import {
  getSemanticSkillIdForViewKind,
} from "@/ai/authoring/semantic-view-kinds";

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

function viewKindsFromCatalog(skills: Iterable<AuthoringSkillSummary>) {
  const availableSkillIds = new Set([...skills].map((skill) => skill.id));
  return DASHBOARD_VIEW_KIND_IDS.filter((viewKind) =>
    availableSkillIds.has(getSemanticSkillIdForViewKind(viewKind)),
  );
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
  const availableViewKinds = viewKindsFromCatalog(input.skillCatalog);
  const viewKind = input.goal?.viewPlan?.viewKind;
  const semanticSkillId = viewKind
    ? getSemanticSkillIdForViewKind(viewKind)
    : undefined;
  const loadedSkillBody = semanticSkillId
    ? input.loadedSkillContent.get(semanticSkillId)
    : undefined;

  return {
    datasourcesLoaded: input.datasourceListLoaded,
    availableViewKinds,
    ...(schemaLoadedFor ? { schemaLoadedFor } : {}),
    ...(viewKind && semanticSkillId && loadedSkillBody
      ? {
          semanticSkillLoadedFor: {
            viewKind,
            skillId: semanticSkillId,
            version: hashStableJson(
              { skillId: semanticSkillId, content: loadedSkillBody },
              "skill",
            ),
            loadedAt: input.loadedSkillLoadedAt.get(semanticSkillId) ?? loadedAt,
          },
        }
      : {}),
  };
}
