import type {
  DashboardDocument,
  DatasourceContext,
} from "@/contracts";
import type {
  AuthoringSkillSummary,
  AuthoringDraftOutput,
  DeclareAuthoringGoalToolInput,
  DeclareAuthoringGoalToolOutput,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AiSuggestionKind } from "@/ai/authoring/contracts/artifacts";
import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { AuthoringGoal, ContextStatus } from "@/ai/authoring/contracts/progress";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import {
  buildCandidateDocument,
  buildDocumentFingerprint,
} from "@/ai/authoring/tools/candidate-document";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneDatasourceSchema,
  cloneQuery,
  cloneWorkingDraftOwnership,
  createEmptyWorkingDraftOwnership,
  createWorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import {
  buildDraftStatus,
} from "@/ai/authoring/tools/draft-status";
import type { LastRunCheckState } from "@/ai/authoring/tools/reliability";
import { buildContextStatusSnapshot } from "@/ai/authoring/tools/context-status";

export interface BuildAuthoringToolsInput {
  scope: AuthoringScope;
  activeTools?: AuthoringToolName[];
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  findLatestDraftOutput?: () => AuthoringDraftOutput | null;
  findDraftOutputBySuggestionId?: (suggestionId: string) => AuthoringDraftOutput | null;
  getActiveGoalId?: () => string | null | undefined;
  getActiveGoal?: () => AuthoringGoal | null;
  getRuntimeApprovalContext?: () => {
    approved: boolean;
    proposalId?: string | null;
    baseVersion?: number | null;
    pendingProposalId?: string | null;
    pendingProposalBaseVersion?: number | null;
    draftFingerprint?: string | null;
    baseDocumentFingerprint?: string | null;
  } | null | undefined;
  getBaseVersion?: () => number | undefined;
  onDeclareAuthoringGoal?: (
    declaration: DeclareAuthoringGoalToolInput,
  ) => Promise<DeclareAuthoringGoalToolOutput> | DeclareAuthoringGoalToolOutput;
  dependencies: AuthoringDependencies;
}

export interface AuthoringToolRuntimeUpdate {
  dashboard: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  focusedViewId?: string | null;
}

export interface AuthoringProposalMeta {
  suggestionId: string;
  kind: AiSuggestionKind;
  title: string;
  summary: string;
  patchSummary: string;
}

export interface AuthoringToolRuntimeContext {
  readonly dashboard: DashboardDocument;
  readonly checks: ViewCheckSnapshot[] | null;
  readonly focusedViewId: string | null;
  readonly workingDraft: ReturnType<typeof createWorkingDraftState>;
  readonly skillCatalog: Map<string, AuthoringSkillSummary>;
  readonly datasourceSchemaCache: Map<string, DatasourceContext>;
  readonly datasourceSchemaLoadedAt: Map<string, string>;
  readonly loadedSkillContent: Map<string, string>;
  readonly loadedSkillLoadedAt: Map<string, string>;
  readonly datasourceListLoaded: boolean;
  getDatasourceList: () => Promise<DatasourceListItemSummary[]>;
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
  markWorkingDraftUpdated: () => void;
  resetWorkingDraft: () => void;
  getDraftSnapshot: () => AuthoringWorkingDraftSnapshot | null;
  getDraftStatusSnapshot: (activeGoal?: AuthoringGoal | null) => DraftStatusToolOutput;
  getLastRunCheckState: () => LastRunCheckState | null;
  setLastRunCheckState: (value: LastRunCheckState | null) => void;
  getLastRunCheckStateSnapshot: () => AuthoringRunCheckStateSnapshot | null;
  setLatestProposalMeta: (proposal: AuthoringProposalMeta | null) => void;
  getLatestProposalMeta: () => AuthoringProposalMeta | null;
  recordLoadedSkill: (skill: { skill_id: string; content: string }) => void;
  updateRuntimeContext: (ctx: AuthoringToolRuntimeUpdate) => void;
  getCandidateDocumentSnapshot: () => DashboardDocument;
  getCandidateDocumentFingerprintSnapshot: () => string;
  getContextStatusSnapshot: (goal?: AuthoringGoal | null) => ContextStatus;
}

export function createAuthoringToolRuntimeContext(
  input: BuildAuthoringToolsInput,
): AuthoringToolRuntimeContext {
  let currentDashboard: DashboardDocument = input.dashboard;
  let currentChecks: ViewCheckSnapshot[] | null = input.checks ?? null;
  let currentFocusedViewId: string | null =
    input.scope.kind === "focused" ? input.scope.viewId : null;

  const workingDraft = createWorkingDraftState(input.initialWorkingDraft);
  let datasourceListCache =
    input.datasources?.map((datasource) => ({ ...datasource })) ?? null;
  let skillCatalog = new Map(
    (input.skills ?? []).map((skill) => [skill.id, { ...skill }]),
  );
  const datasourceSchemaCache = new Map<string, DatasourceContext>();
  const datasourceSchemaLoadedAt = new Map<string, string>();
  const loadedSkillContent = new Map<string, string>();
  const loadedSkillLoadedAt = new Map<string, string>();
  let lastRunCheckState: LastRunCheckState | null = input.initialLastRunCheckState
    ? {
        fingerprint: input.initialLastRunCheckState.fingerprint,
        signatures: [...input.initialLastRunCheckState.signatures],
        consecutive_repeat_count:
          input.initialLastRunCheckState.consecutiveRepeatCount,
      }
    : null;
  let latestProposalMeta: AuthoringProposalMeta | null = null;

  const getDatasourceList = async (): Promise<DatasourceListItemSummary[]> => {
    if (datasourceListCache) {
      return datasourceListCache.map((datasource) => ({ ...datasource }));
    }

    const datasources = await input.dependencies.listDatasources();
    datasourceListCache = datasources.map((datasource) => ({ ...datasource }));
    return datasourceListCache.map((datasource) => ({ ...datasource }));
  };

  const getDatasourceSchema = async (
    datasourceId: string,
  ): Promise<DatasourceContext> => {
    const cached = datasourceSchemaCache.get(datasourceId);
    if (cached) {
      return cloneDatasourceSchema(cached);
    }

    const schema = await input.dependencies.loadDatasourceSchema(datasourceId);
    datasourceSchemaCache.set(datasourceId, cloneDatasourceSchema(schema));
    datasourceSchemaLoadedAt.set(datasourceId, new Date().toISOString());
    return cloneDatasourceSchema(schema);
  };

  const markWorkingDraftUpdated = () => {
    workingDraft.stagedAt = new Date().toISOString();
  };

  const resetWorkingDraft = () => {
    workingDraft.dashboardSpec = undefined;
    workingDraft.queryDefs = undefined;
    workingDraft.bindings = undefined;
    workingDraft.bindingMode = undefined;
    workingDraft.dirtyViewIds.clear();
    workingDraft.dirtyQueryIds.clear();
    workingDraft.dirtyBindingIds.clear();
    workingDraft.layoutTouched = false;
    workingDraft.ownership = createEmptyWorkingDraftOwnership();
    workingDraft.stagedAt = null;
  };

  const getDraftSnapshot = (): AuthoringWorkingDraftSnapshot | null => {
    if (
      !workingDraft.dashboardSpec &&
      !workingDraft.queryDefs &&
      !workingDraft.bindings &&
      !workingDraft.bindingMode &&
      workingDraft.dirtyViewIds.size === 0 &&
      workingDraft.dirtyQueryIds.size === 0 &&
      workingDraft.dirtyBindingIds.size === 0 &&
      !workingDraft.layoutTouched
    ) {
      return null;
    }

    return {
      ...(workingDraft.dashboardSpec
        ? { dashboardSpec: cloneDashboardSpec(workingDraft.dashboardSpec) }
        : {}),
      ...(workingDraft.queryDefs
        ? { queryDefs: workingDraft.queryDefs.map(cloneQuery) }
        : {}),
      ...(workingDraft.bindings
        ? { bindings: workingDraft.bindings.map(cloneBinding) }
        : {}),
      ...(workingDraft.bindingMode ? { bindingMode: workingDraft.bindingMode } : {}),
      dirtyViewIds: [...workingDraft.dirtyViewIds],
      dirtyQueryIds: [...workingDraft.dirtyQueryIds],
      dirtyBindingIds: [...workingDraft.dirtyBindingIds],
      layoutTouched: workingDraft.layoutTouched,
      ownership: cloneWorkingDraftOwnership(workingDraft.ownership),
      stagedAt: workingDraft.stagedAt ?? new Date().toISOString(),
    };
  };

  const getLastRunCheckStateSnapshot = (): AuthoringRunCheckStateSnapshot | null => {
    if (!lastRunCheckState) {
      return null;
    }

    return {
      fingerprint: lastRunCheckState.fingerprint,
      signatures: [...lastRunCheckState.signatures],
      consecutiveRepeatCount: lastRunCheckState.consecutive_repeat_count,
    };
  };

  const getDraftStatusSnapshot = (
    activeGoal?: AuthoringGoal | null,
  ): DraftStatusToolOutput => {
    const candidate = buildCandidateDocument(currentDashboard, workingDraft);
    return buildDraftStatus({
      dashboard: currentDashboard,
      candidate,
      draft: getDraftSnapshot(),
      activeGoal: activeGoal ?? null,
      documentHash: buildDocumentFingerprint(candidate),
      lastRunCheckState: getLastRunCheckStateSnapshot(),
    });
  };

  return {
    get dashboard() {
      return currentDashboard;
    },
    get checks() {
      return currentChecks;
    },
    get focusedViewId() {
      return currentFocusedViewId;
    },
    get workingDraft() {
      return workingDraft;
    },
    get skillCatalog() {
      return skillCatalog;
    },
    get datasourceSchemaCache() {
      return datasourceSchemaCache;
    },
    get datasourceSchemaLoadedAt() {
      return datasourceSchemaLoadedAt;
    },
    get loadedSkillContent() {
      return loadedSkillContent;
    },
    get loadedSkillLoadedAt() {
      return loadedSkillLoadedAt;
    },
    get datasourceListLoaded() {
      return Boolean(datasourceListCache);
    },
    getDatasourceList,
    getDatasourceSchema,
    markWorkingDraftUpdated,
    resetWorkingDraft,
    getDraftSnapshot,
    getDraftStatusSnapshot,
    getLastRunCheckState: () => lastRunCheckState,
    setLastRunCheckState: (value) => {
      lastRunCheckState = value;
    },
    getLastRunCheckStateSnapshot,
    setLatestProposalMeta: (proposal) => {
      latestProposalMeta = proposal;
    },
    getLatestProposalMeta: () => latestProposalMeta,
    recordLoadedSkill: (skill) => {
      loadedSkillContent.set(skill.skill_id, skill.content);
      loadedSkillLoadedAt.set(skill.skill_id, new Date().toISOString());
    },
    updateRuntimeContext(ctx) {
      currentDashboard = ctx.dashboard;
      currentChecks = ctx.checks ?? null;
      currentFocusedViewId = ctx.focusedViewId ?? null;
      datasourceListCache = ctx.datasources?.map((ds) => ({ ...ds })) ?? null;
      skillCatalog = new Map((ctx.skills ?? []).map((s) => [s.id, { ...s }]));
    },
    getCandidateDocumentSnapshot: () =>
      buildCandidateDocument(currentDashboard, workingDraft),
    getCandidateDocumentFingerprintSnapshot: () =>
      buildDocumentFingerprint(buildCandidateDocument(currentDashboard, workingDraft)),
    getContextStatusSnapshot: (goal?: AuthoringGoal | null): ContextStatus =>
      buildContextStatusSnapshot({
        goal,
        datasourceListLoaded: Boolean(datasourceListCache),
        datasourceSchemaCache,
        datasourceSchemaLoadedAt,
        skillCatalog: skillCatalog.values(),
        loadedSkillContent,
        loadedSkillLoadedAt,
      }),
  };
}
