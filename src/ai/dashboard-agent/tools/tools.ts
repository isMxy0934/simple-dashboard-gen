import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  Binding,
  BindingResult,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
  JsonValue,
  PreviewRequest,
  QueryDef,
  DashboardView,
  DatasourceContext,
} from "@/contracts";
import {
  validateDashboardDocument,
  type ValidationIssue,
} from "@/contracts/validation";
import type {
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
  BindingDetail,
  DashboardAgentCheckFailure,
  DashboardAgentCheckSummary,
  DashboardAgentDraftOutput,
  DashboardAgentMessage,
  DashboardAgentSkillSummary,
  DatasourceListItemSummary,
  DeleteBindingToolInput,
  DeleteBindingToolOutput,
  DeleteQueryToolInput,
  DeleteQueryToolOutput,
  DeleteViewToolInput,
  DeleteViewToolOutput,
  GetBindingToolInput,
  GetDatasourcesToolInput,
  GetDatasourcesToolOutput,
  GetQueryToolInput,
  GetSchemaByDatasourceToolInput,
  GetSchemaByDatasourceToolOutput,
  GetViewToolInput,
  GetViewsToolInput,
  LoadSkillReferenceToolInput,
  LoadSkillReferenceToolOutput,
  LoadSkillToolInput,
  LoadSkillToolOutput,
  QueryDetail,
  RunCheckToolInput,
  RunCheckToolOutput,
  UpsertBindingToolInput,
  UpsertBindingToolOutput,
  UpsertQueryToolInput,
  UpsertQueryToolOutput,
  UpsertViewToolInput,
  UpsertViewToolOutput,
  ViewCheckSnapshot,
  ViewDetail,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentWorkingDraftSnapshot } from "@/ai/dashboard-agent/contracts/session-state";
import type {
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
} from "@/ai/dashboard-agent/tools/artifacts";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import { createMockBindingForView } from "@/domain/dashboard/bindings";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
  hasGrantedApplyPatchApprovalInModelMessages,
  hasPendingApprovalResponse,
} from "@/ai/dashboard-agent/messages/message-inspection";
import {
  cloneDashboardDocument,
  getLayoutItemsForView,
  reconcileDashboardDocumentContract,
  removeBindingFromDocument,
  removeQueryFromDocument,
  removeViewFromDocument,
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import {
  buildViewListSummary,
} from "@/ai/dashboard-agent/context";
import type { DashboardAgentDependencies } from "@/ai/dashboard-agent/engine/dependencies";
import { summarizeEChartsRenderer } from "@/renderers/echarts/summary";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  createUnknownRendererCheck,
  summarizeRendererValidationChecks,
} from "@/renderers/core/validation-result";

const layoutItemSchema = z.object({
  view_id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
const rendererSlotSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  value_kind: z.enum(["rows", "array", "object", "scalar"]),
  required: z.boolean().optional(),
  formatter: z.enum(["integer", "usd_0", "usd_2"]).optional(),
});
const rendererSchema = z.object({
  kind: z.literal("echarts"),
  option_template: z.record(z.string(), z.any()),
  slots: z.array(rendererSlotSchema),
});
const queryParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  required: z.boolean().optional(),
  default_value: z.any().optional(),
  cardinality: z.enum(["scalar", "array"]).optional(),
});
const resultSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  nullable: z.boolean(),
});
const queryOutputSchema = z.union([
  z.object({
    kind: z.literal("rows"),
    schema: z.array(resultSchemaFieldSchema),
  }),
  z.object({
    kind: z.literal("array"),
  }),
  z.object({
    kind: z.literal("object"),
  }),
  z.object({
    kind: z.literal("scalar"),
    value_type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  }),
]);
const querySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  datasource_id: z.string().min(1),
  sql_template: z.string().min(1),
  params: z.array(queryParamSchema),
  output: queryOutputSchema,
});
const bindingParamMappingSchema = z.object({
  source: z.enum(["filter", "constant", "runtime_context"]),
  value: z.any(),
});
const bindingSchema = z.object({
  id: z.string().min(1),
  view_id: z.string().min(1),
  slot_id: z.string().min(1),
  mode: z.enum(["mock", "live"]).optional(),
  query_id: z.string().min(1).optional(),
  param_mapping: z.record(z.string(), bindingParamMappingSchema).optional(),
  result_selector: z.string().nullable().optional(),
  mock_value: z.any().optional(),
  mock_data: z
    .object({
      rows: z.array(z.record(z.string(), z.any())),
    })
    .optional(),
});

const MAX_AUTOREPAIR_ATTEMPTS = 2;

interface WorkingDraftState {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: Set<string>;
  dirtyQueryIds: Set<string>;
  dirtyBindingIds: Set<string>;
  layoutTouched: boolean;
  stagedAt: string | null;
}

interface LastRunCheckState {
  fingerprint: string;
  signatures: string[];
  consecutive_repeat_count: number;
}

type DraftPhase = "view" | "data";

export function buildDashboardAgentTools(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: DashboardAgentSkillSummary[] | null;
  messages?: DashboardAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: DashboardAgentWorkingDraftSnapshot | null;
  dependencies?: DashboardAgentDependencies;
}) {
  const workingDraft = createWorkingDraftState(input.initialWorkingDraft);
  let datasourceListCache =
    input.datasources?.map((datasource) => ({ ...datasource })) ?? null;
  const skillCatalog = new Map(
    (input.skills ?? []).map((skill) => [skill.id, { ...skill }]),
  );
  const datasourceSchemaCache = new Map<string, DatasourceContext>();
  let lastRunCheckState: LastRunCheckState | null = null;

  const getDatasourceList = async (): Promise<DatasourceListItemSummary[]> => {
    if (datasourceListCache) {
      return datasourceListCache.map((datasource) => ({ ...datasource }));
    }

    const datasources = await input.dependencies?.listDatasources?.();
    datasourceListCache = (datasources ?? []).map((datasource) => ({
      ...datasource,
    }));
    return datasourceListCache.map((datasource) => ({ ...datasource }));
  };

  const getDatasourceSchema = async (
    datasourceId: string,
  ): Promise<DatasourceContext> => {
    const cached = datasourceSchemaCache.get(datasourceId);
    if (cached) {
      return cloneDatasourceSchema(cached);
    }

    const schema = await input.dependencies?.loadDatasourceSchema?.(datasourceId);
    if (!schema) {
      throw new Error(`Datasource schema "${datasourceId}" is unavailable.`);
    }

    datasourceSchemaCache.set(datasourceId, cloneDatasourceSchema(schema));
    return cloneDatasourceSchema(schema);
  };

  const ensureRepairWindowOpen = (toolName: "upsertView" | "upsertQuery" | "upsertBinding") => {
    if (
      lastRunCheckState &&
      lastRunCheckState.consecutive_repeat_count >= MAX_AUTOREPAIR_ATTEMPTS
    ) {
      throw new Error(
        `Repair dead-end reached after repeated ${toolName} attempts. The same reliability failures are still present, so stop retrying and explain the issue.`,
      );
    }
  };

  const clearViewPhaseDraft = () => {
    workingDraft.dashboardSpec = undefined;
    workingDraft.bindings = undefined;
    workingDraft.bindingMode = undefined;
    workingDraft.dirtyViewIds.clear();
    workingDraft.dirtyBindingIds.clear();
    workingDraft.layoutTouched = false;
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
    workingDraft.stagedAt = null;
  };

  const getDraftSnapshot = (): DashboardAgentWorkingDraftSnapshot | null => {
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
      stagedAt: workingDraft.stagedAt ?? new Date().toISOString(),
    };
  };

  const tools = {
    loadSkill: tool({
      description:
        "Load one internal skill by exact id so the agent can follow its specialized authoring instructions.",
      inputSchema: z.object({
        name: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({ name }: LoadSkillToolInput): Promise<LoadSkillToolOutput> => {
        const skillName = name.trim();
        if (skillCatalog.size > 0 && !skillCatalog.has(skillName)) {
          throw new Error(
            `Skill "${skillName}" is not available. Use one of: ${[...skillCatalog.keys()].join(", ")}.`,
          );
        }

        const skill = await input.dependencies?.loadSkill?.(skillName);
        if (!skill) {
          throw new Error(`Skill "${skillName}" is unavailable.`);
        }

        return {
          skill_id: skill.skill_id,
          skill_directory: skill.skill_directory,
          content: skill.content,
        };
      },
    }),
    loadSkillReference: tool({
      description:
        "Load one reference file from an already known internal skill for variant-specific instructions.",
      inputSchema: z.object({
        skill_id: z.string().min(1),
        reference_name: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({
        skill_id,
        reference_name,
      }: LoadSkillReferenceToolInput): Promise<LoadSkillReferenceToolOutput> => {
        const skillId = skill_id.trim();
        if (skillCatalog.size > 0 && !skillCatalog.has(skillId)) {
          throw new Error(
            `Skill "${skillId}" is not available. Use one of: ${[...skillCatalog.keys()].join(", ")}.`,
          );
        }

        const reference = await input.dependencies?.loadSkillReference?.(
          skillId,
          reference_name.trim(),
        );
        if (!reference) {
          throw new Error(
            `Reference "${reference_name}" is unavailable for skill "${skillId}".`,
          );
        }

        return {
          skill_id: reference.skill_id,
          reference_name: reference.reference_name,
          reference_path: reference.reference_path,
          content: reference.content,
        };
      },
    }),
    getViews: tool({
      description:
        "Get the dashboard view list with binding/query/check summary for each view.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (_toolInput: GetViewsToolInput) =>
        buildViewListSummary({
          document: buildCandidateDocument(input.dashboard, workingDraft),
          dashboardId: input.dashboardId,
          checks: input.checks,
        }),
    }),
    getDatasources: tool({
      description: "Get the list of available datasources for report authoring.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (_toolInput: GetDatasourcesToolInput): Promise<GetDatasourcesToolOutput> => {
        const datasources = await getDatasourceList();
        return {
          datasource_count: datasources.length,
          datasources,
        };
      },
    }),
    getView: tool({
      description:
        "Get full details for a specific view by id or by title. If title matches multiple views, return candidates instead of guessing.",
      inputSchema: z.object({
        view_id: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      }),
      execute: async (toolInput: GetViewToolInput) => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const viewSummary = buildViewListSummary({
          document,
          dashboardId: input.dashboardId,
          checks: input.checks,
        });
        const requestedViewId = toolInput.view_id?.trim();
        const requestedTitle = toolInput.title?.trim();

        const exactView = requestedViewId
          ? document.dashboard_spec.views.find((view) => view.id === requestedViewId)
          : undefined;

        if (exactView) {
          return {
            match_status: "exact" as const,
            view: buildViewDetail({
              document,
              view: exactView,
              latestCheck: findCheckSnapshot(input.checks, exactView.id),
            }),
          };
        }

        if (!requestedTitle) {
          return {
            match_status: "missing" as const,
            matches: [],
          };
        }

        const matches = viewSummary.views.filter((view) => view.title === requestedTitle);

        if (matches.length === 1) {
          const view = document.dashboard_spec.views.find(
            (candidate) => candidate.id === matches[0].id,
          );
          if (!view) {
            return {
              match_status: "missing" as const,
              matches: [],
            };
          }
          return {
            match_status: "exact" as const,
            view: buildViewDetail({
              document,
              view,
              latestCheck: findCheckSnapshot(input.checks, view.id),
            }),
          };
        }

        return {
          match_status: matches.length > 1 ? ("ambiguous" as const) : ("missing" as const),
          matches,
        };
      },
    }),
    getQuery: tool({
      description: "Get SQL, params, output, and usage information for one query.",
      inputSchema: z.object({
        query_id: z.string().min(1),
      }),
      execute: async ({ query_id }: GetQueryToolInput): Promise<QueryDetail> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const query = document.query_defs.find((candidate) => candidate.id === query_id);

        if (!query) {
          throw new Error(`Query "${query_id}" was not found.`);
        }

        return buildQueryDetail(document, query);
      },
    }),
    getBinding: tool({
      description: "Get binding details for one view, optionally narrowed to one slot.",
      inputSchema: z.object({
        view_id: z.string().min(1),
        slot_id: z.string().min(1).optional(),
      }),
      execute: async ({ view_id, slot_id }: GetBindingToolInput) => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const view = document.dashboard_spec.views.find((candidate) => candidate.id === view_id);

        if (!view) {
          throw new Error(`View "${view_id}" was not found.`);
        }

        const bindings = document.bindings
          .filter(
            (binding) =>
              binding.view_id === view_id &&
              (!slot_id || binding.slot_id === slot_id),
          )
          .map((binding) =>
            buildBindingDetail({
              binding,
              view,
              query: document.query_defs.find(
                (query) => query.id === binding.query_id,
              ),
            }),
          );

        return { bindings };
      },
    }),
    getSchemaByDatasource: tool({
      description:
        "Get the full schema, fields, and metrics for one datasource.",
      inputSchema: z.object({
        datasource_id: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async (
        toolInput: GetSchemaByDatasourceToolInput,
      ): Promise<GetSchemaByDatasourceToolOutput> =>
        getDatasourceSchema(toolInput.datasource_id),
    }),
    runCheck: tool({
      description:
        "Run a runtime check on the current staged candidate or on a single view.",
      inputSchema: z.object({
        scope: z.enum(["dashboard", "view"]),
        view_id: z.string().optional(),
        reason: z.string().optional(),
      }),
      execute: async (toolInput: RunCheckToolInput): Promise<RunCheckToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const phase = determineDraftPhase(workingDraft);
        const visibleViewIds =
          toolInput.scope === "view"
            ? [resolveRequiredView(document, toolInput.view_id).id]
            : collectVisibleViewIds(document);
        const validation = validateDashboardDocument(document, "save");

        if (!validation.ok) {
          const runtimeCheck = buildValidationRuntimeCheck(validation.issues, document);
          const checks = buildViewCheckSnapshots({
            document,
            runtimeCheck,
            rendererChecks: {},
            visibleViewIds,
          });
          lastRunCheckState = registerRunCheckState({
            previous: lastRunCheckState,
            fingerprint: buildDocumentFingerprint(document),
            failures: runtimeCheck.errors,
          });
          return {
            status: runtimeCheck.status,
            reason: runtimeCheck.reason,
            checks,
            failures: runtimeCheck.errors,
            renderer_checks: checks.map((check) => ({
              view_id: check.view_id,
              checks: check.renderer_checks ?? {},
            })),
          };
        }

        const previewCheck = await executePreviewCheckForDocument(
          document,
          input.dependencies,
          phase,
          visibleViewIds,
        );
        const failures = collectRunCheckFailures({
          document,
          phase,
          runtimeCheck: previewCheck.runtimeCheck,
          rendererChecks: previewCheck.rendererChecks,
          visibleViewIds,
        });
        const rendererChecks = mergeRendererChecksByView(
          previewCheck.rendererChecks,
          input.checks,
          visibleViewIds,
        );
        const checks = buildViewCheckSnapshots({
          document,
          runtimeCheck: previewCheck.runtimeCheck,
          rendererChecks,
          visibleViewIds,
        });
        lastRunCheckState = registerRunCheckState({
          previous: lastRunCheckState,
          fingerprint: buildDocumentFingerprint(document),
          failures,
        });
        return {
          status: previewCheck.runtimeCheck.status,
          reason: previewCheck.runtimeCheck.reason,
          checks,
          failures,
          renderer_checks: checks.map((check) => ({
            view_id: check.view_id,
            checks: check.renderer_checks ?? {},
          })),
        };
      },
    }),
    upsertView: tool({
      description:
        "Stage a single view and its layout into the draft dashboard spec.",
      inputSchema: z.object({
        request: z.string().min(1),
        view_spec: z.object({
          view_id: z.string().min(1).optional(),
          title: z.string().min(1),
          description: z.string().optional(),
          renderer: rendererSchema,
        }),
        layout: z
          .object({
            desktop: layoutItemSchema.optional(),
            mobile: layoutItemSchema.optional(),
          })
          .optional(),
      }),
      execute: async (toolInput: UpsertViewToolInput): Promise<UpsertViewToolOutput> => {
        ensureRepairWindowOpen("upsertView");
        const isEmptyDashboardFirstPhase =
          input.dashboard.dashboard_spec.views.length === 0 &&
          determineDraftPhase(workingDraft) === "view";
        if (isEmptyDashboardFirstPhase && workingDraft.dashboardSpec?.views.length) {
          clearViewPhaseDraft();
        }
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextViewId =
          toolInput.view_spec.view_id?.trim() ||
          `v_ai_${document.dashboard_spec.views.length + 1}`;
        const nextView: DashboardView = {
          id: nextViewId,
          title: toolInput.view_spec.title.trim(),
          description: toolInput.view_spec.description?.trim() || undefined,
          renderer: cloneRenderer(toolInput.view_spec.renderer),
        };
        const nextCandidate = upsertViewInDocument(document, nextView, {
          desktopItem: normalizeLayoutItem(toolInput.layout?.desktop, nextViewId),
          mobileItem: normalizeLayoutItem(toolInput.layout?.mobile, nextViewId),
        });
        const mockBinding = isEmptyDashboardFirstPhase
          ? createMockBindingForView(nextView)
          : null;
        const finalCandidate = mockBinding
          ? upsertBindingInDocument(nextCandidate, mockBinding)
          : nextCandidate;

        const afterFingerprint = buildDocumentFingerprint(finalCandidate);
        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic view change was staged for "${nextView.title}". Inspect the current view and submit a different explicit view contract.`,
          );
        }

        workingDraft.dashboardSpec = cloneDashboardDocument(finalCandidate).dashboard_spec;
        workingDraft.dirtyViewIds.add(nextViewId);
        if (
          JSON.stringify(document.dashboard_spec.layout) !==
          JSON.stringify(finalCandidate.dashboard_spec.layout)
        ) {
          workingDraft.layoutTouched = true;
        }
        if (mockBinding) {
          workingDraft.bindings = finalCandidate.bindings.map(cloneBinding);
          workingDraft.bindingMode = "mock";
          workingDraft.dirtyBindingIds.clear();
          workingDraft.dirtyBindingIds.add(mockBinding.id);
        }
        markWorkingDraftUpdated();
        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
        const view = resolveRequiredView(candidate, nextViewId);
        return {
          summary: `Staged view "${view.title}".`,
          view: buildViewDetail({
            document: candidate,
            view,
            latestCheck: findCheckSnapshot(input.checks, view.id),
          }),
        };
      },
    }),
    upsertQuery: tool({
      description:
        "Stage one explicit query contract exactly as provided.",
      inputSchema: z.object({
        reason: z.string().optional(),
        query: querySchema,
      }),
      execute: async (toolInput: UpsertQueryToolInput): Promise<UpsertQueryToolOutput> => {
        ensureRepairWindowOpen("upsertQuery");
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextQuery = cloneQuery(toolInput.query);
        const nextCandidate = upsertQueryInDocument(document, nextQuery);
        const afterFingerprint = buildDocumentFingerprint(nextCandidate);

        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic query change was staged for "${nextQuery.id}". Inspect the current query and submit a different explicit query contract.`,
          );
        }

        workingDraft.queryDefs = nextCandidate.query_defs;
        workingDraft.dirtyQueryIds.add(nextQuery.id);
        markWorkingDraftUpdated();
        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
        const targetViews = candidate.bindings
          .filter((binding) => binding.query_id === nextQuery.id)
          .map((binding) => candidate.dashboard_spec.views.find((view) => view.id === binding.view_id)?.title)
          .filter((title): title is string => typeof title === "string");
        const targetLabel =
          targetViews[0] ??
          candidate.dashboard_spec.views.find((view) =>
            candidate.bindings.some(
              (binding) => binding.view_id === view.id && binding.query_id === nextQuery.id,
            ),
          )?.title;

        return {
          summary: targetLabel
            ? `Staged query "${nextQuery.name}" for view "${targetLabel}".`
            : `Staged query "${nextQuery.name}".`,
          query: buildQueryDetail(
            candidate,
            candidate.query_defs.find((query) => query.id === nextQuery.id) ?? nextQuery,
          ),
        };
      },
    }),
    upsertBinding: tool({
      description:
        "Stage one explicit binding contract exactly as provided.",
      inputSchema: z.object({
        reason: z.string().optional(),
        binding: bindingSchema,
      }),
      execute: async (toolInput: UpsertBindingToolInput): Promise<UpsertBindingToolOutput> => {
        ensureRepairWindowOpen("upsertBinding");
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextBinding = cloneBinding(toolInput.binding);
        const view = resolveRequiredView(document, nextBinding.view_id);

        if (
          nextBinding.mode !== "mock" &&
          (!nextBinding.query_id ||
            !document.query_defs.some((query) => query.id === nextBinding.query_id))
        ) {
          throw new Error(
            `Live binding "${nextBinding.id}" must reference an existing query before it can be staged.`,
          );
        }

        let nextCandidate = document;
        const removedBindingIds: string[] = [];
        for (const existingBinding of nextCandidate.bindings.filter(
          (binding) =>
            binding.view_id === nextBinding.view_id &&
            binding.slot_id === nextBinding.slot_id &&
            binding.id !== nextBinding.id,
        )) {
          removedBindingIds.push(existingBinding.id);
          nextCandidate = removeBindingFromDocument(nextCandidate, existingBinding.id);
        }
        nextCandidate = upsertBindingInDocument(nextCandidate, nextBinding);
        const afterFingerprint = buildDocumentFingerprint(nextCandidate);

        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic binding change was staged for "${nextBinding.id}". Inspect the current binding and submit a different explicit binding contract.`,
          );
        }

        workingDraft.bindings = nextCandidate.bindings;
        workingDraft.bindingMode = nextBinding.mode ?? "live";
        workingDraft.dirtyBindingIds.add(nextBinding.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        markWorkingDraftUpdated();

        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
        const bindings = candidate.bindings
          .filter(
            (binding) =>
              binding.view_id === view.id &&
              binding.slot_id === nextBinding.slot_id,
          )
          .map((binding) =>
            buildBindingDetail({
              binding,
              view,
              query: candidate.query_defs.find(
                (query) => query.id === binding.query_id,
              ),
            }),
          );

        return {
          summary: `Staged ${(nextBinding.mode ?? "live")} binding${bindings.length === 1 ? "" : "s"} for "${view.title}".`,
          bindings,
        };
      },
    }),
    deleteView: tool({
      description:
        "Remove one view and its layout entries from the staged dashboard draft.",
      inputSchema: z.object({
        reason: z.string().optional(),
        view_id: z.string().min(1),
      }),
      execute: async ({ view_id }: DeleteViewToolInput): Promise<DeleteViewToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const view = resolveRequiredView(document, view_id);
        const removedBindingIds = document.bindings
          .filter((binding) => binding.view_id === view.id)
          .map((binding) => binding.id);
        const nextCandidate = removeViewFromDocument(document, view.id);

        if (buildDocumentFingerprint(document) === buildDocumentFingerprint(nextCandidate)) {
          throw new Error(`No view removal was staged for "${view.title}".`);
        }

        workingDraft.dashboardSpec = cloneDashboardSpec(nextCandidate.dashboard_spec);
        workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
        workingDraft.dirtyViewIds.add(view.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        workingDraft.layoutTouched = true;
        markWorkingDraftUpdated();

        return {
          summary: `Removed view "${view.title}" from the staged dashboard draft.`,
          view_id: view.id,
          removed_binding_ids: removedBindingIds,
        };
      },
    }),
    deleteQuery: tool({
      description:
        "Remove one query and any live bindings that still reference it from the staged draft.",
      inputSchema: z.object({
        reason: z.string().optional(),
        query_id: z.string().min(1),
      }),
      execute: async ({ query_id }: DeleteQueryToolInput): Promise<DeleteQueryToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const query = document.query_defs.find((candidate) => candidate.id === query_id);
        if (!query) {
          throw new Error(`Query "${query_id}" was not found.`);
        }

        const removedBindingIds = document.bindings
          .filter((binding) => binding.query_id === query.id)
          .map((binding) => binding.id);
        const nextCandidate = removeQueryFromDocument(document, query.id);

        if (buildDocumentFingerprint(document) === buildDocumentFingerprint(nextCandidate)) {
          throw new Error(`No query removal was staged for "${query.name}".`);
        }

        workingDraft.queryDefs = nextCandidate.query_defs.map(cloneQuery);
        workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
        workingDraft.dirtyQueryIds.add(query.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        markWorkingDraftUpdated();

        return {
          summary: `Removed query "${query.name}" from the staged dashboard draft.`,
          query_id: query.id,
          removed_binding_ids: removedBindingIds,
        };
      },
    }),
    deleteBinding: tool({
      description:
        "Remove one binding from the staged dashboard draft.",
      inputSchema: z.object({
        reason: z.string().optional(),
        binding_id: z.string().min(1),
      }),
      execute: async ({
        binding_id,
      }: DeleteBindingToolInput): Promise<DeleteBindingToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const binding = document.bindings.find((candidate) => candidate.id === binding_id);
        if (!binding) {
          throw new Error(`Binding "${binding_id}" was not found.`);
        }

        const nextCandidate = removeBindingFromDocument(document, binding.id);
        if (buildDocumentFingerprint(document) === buildDocumentFingerprint(nextCandidate)) {
          throw new Error(`No binding removal was staged for "${binding.id}".`);
        }

        workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
        workingDraft.dirtyBindingIds.add(binding.id);
        markWorkingDraftUpdated();

        return {
          summary: `Removed binding "${binding.id}" for view "${binding.view_id}".`,
          binding_id: binding.id,
          view_id: binding.view_id,
        };
      },
    }),
    composePatch: tool({
      description:
        "Compose the staged candidate document into one approval-ready patch.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (): Promise<DashboardAgentDraftOutput> => {
        const phase = determineDraftPhase(workingDraft);
        const includesDataDraft = phase === "data";
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = await stabilizeCandidateDocument({
          dashboard: buildCandidateDocument(input.dashboard, workingDraft),
          phase,
          dependencies: input.dependencies,
        });

        if (stabilization.repair.status === "failed") {
          throw new Error(
            stabilization.repair.notes[0] ??
              stabilization.runtimeCheck?.reason ??
              "Compose patch is blocked until the staged contract passes reliability checks.",
          );
        }

        const patch = buildPatchFromDocument(
          input.dashboard,
          stabilization.dashboard,
          kind,
          workingDraft,
        );
        if (patch.operations.length === 0) {
          throw new Error(
            "Compose patch produced no contract changes. The staged draft did not create a real diff.",
          );
        }
        if (
          phase === "view" &&
          input.dashboard.dashboard_spec.views.length === 0 &&
          !patch.operations.some((operation) =>
            operation.path.startsWith("dashboard_spec.views."),
          )
        ) {
          throw new Error(
            "The first staged patch must add at least one visible view before approval.",
          );
        }

        return {
          suggestion: {
            id: `patch-${Date.now()}`,
            kind,
            title: kind === "layout" ? "Dashboard Layout Patch" : "Dashboard Data Patch",
            summary:
              kind === "layout"
                ? "Prepared a patch for the staged views and layout."
                : "Prepared a patch for the staged views, query definitions, and bindings.",
            details: buildPatchDetails({
              dashboard: stabilization.dashboard,
              bindingMode: workingDraft.bindingMode,
              runtimeCheck: stabilization.runtimeCheck,
              repair: stabilization.repair,
            }),
            patch,
            dashboard: stabilization.dashboard,
          },
          approval: {
            required: true,
            status: "pending",
            summary:
              "This patch changes the dashboard contract and requires approval before apply.",
            operation_count: patch.operations.length,
            affected_paths: patch.operations.map((operation) => operation.path),
          },
          ...(stabilization.runtimeCheck
            ? { runtime_check: stabilization.runtimeCheck }
            : {}),
          repair: stabilization.repair,
        };
      },
    }),
    applyPatch: tool({
      description:
        "Request approval to apply the staged composePatch proposal to the local dashboard draft.",
      inputSchema: z.object({
        suggestion_id: z.string().min(1).optional(),
      }),
      needsApproval: async (
        _toolInput: ApplyPatchToolInput,
        { messages: modelMessages }: { messages: unknown[] },
      ): Promise<boolean> => {
        // Single logical gate: UI state (authoritative for this app) + model messages
        // (approvalId-linked; SDK does not put toolName on tool-approval-response).
        if (hasPendingApprovalResponse(input.messages ?? [])) {
          return false;
        }
        if (hasGrantedApplyPatchApprovalInModelMessages(modelMessages)) {
          return false;
        }
        return true;
      },
      execute: async ({
        suggestion_id: inputSuggestionId,
      }: ApplyPatchToolInput): Promise<ApplyPatchToolOutput> => {
        // Prefer the in-memory workingDraft when it has staged changes; this avoids
        // suggestion_id mismatches that occur when composePatch ran in a prior round.
        const hasWorkingDraftChanges =
          Boolean(workingDraft.dashboardSpec) ||
          Boolean(workingDraft.queryDefs) ||
          Boolean(workingDraft.bindings) ||
          workingDraft.dirtyViewIds.size > 0 ||
          workingDraft.dirtyQueryIds.size > 0 ||
          workingDraft.dirtyBindingIds.size > 0 ||
          workingDraft.layoutTouched;
        const workingDraftCandidate = hasWorkingDraftChanges
          ? buildCandidateDocument(input.dashboard, workingDraft)
          : null;

        const draftOutput =
          inputSuggestionId && input.messages
            ? findDraftOutputBySuggestionId(input.messages, inputSuggestionId)
            : findLatestDraftOutput(input.messages ?? []);

        // Use workingDraft as the primary source; fall back to the persisted proposal.
        const candidate = workingDraftCandidate ?? draftOutput?.suggestion.dashboard ?? null;

        if (!candidate) {
          throw new Error(
            "No staged composePatch proposal is available to apply. Call composePatch first.",
          );
        }
        const candidatePatch =
          draftOutput?.suggestion.patch ??
          (workingDraftCandidate
            ? buildPatchFromDocument(
                input.dashboard,
                workingDraftCandidate,
                determineDraftPhase(workingDraft) === "data" ? "data" : "layout",
                workingDraft,
              )
            : null);
        if (!candidatePatch || candidatePatch.operations.length === 0) {
          throw new Error(
            "applyPatch cannot apply an empty proposal. Compose a non-empty patch first.",
          );
        }

        const phase = determineDraftPhase(workingDraft);
        const reliability = await stabilizeCandidateDocument({
          dashboard: candidate,
          phase,
          dependencies: input.dependencies,
        });
        if (reliability.repair.status === "failed") {
          throw new Error(
            reliability.repair.notes[0] ??
              reliability.runtimeCheck?.reason ??
              "Apply patch is blocked until the staged contract passes reliability checks.",
          );
        }

        resetWorkingDraft();

        const syntheticSuggestionId =
          workingDraftCandidate && !draftOutput
            ? `working-draft-${workingDraft.stagedAt ?? `t-${Date.now()}`}`
            : null;
        const resolvedSuggestionId =
          draftOutput?.suggestion.id ?? syntheticSuggestionId ?? "";

        if (!resolvedSuggestionId) {
          throw new Error(
            "applyPatch could not determine suggestion_id. Call composePatch before applyPatch.",
          );
        }

        return {
          applied: true,
          suggestion_id: resolvedSuggestionId,
          kind: draftOutput?.suggestion.kind ?? "layout",
          title: draftOutput?.suggestion.title ?? "Dashboard update",
          summary: draftOutput?.suggestion.summary ?? "Applied staged patch.",
          patch_summary: draftOutput?.suggestion.patch.summary ?? "",
          focused_view_id: draftOutput
            ? resolveFocusedViewIdFromPatch({
                patch: draftOutput.suggestion.patch,
                currentDashboard: input.dashboard,
                nextDashboard: candidate,
              })
            : null,
          dashboard: cloneDashboardDocument(candidate),
        };
      },
    }),
  } satisfies ToolSet;

  return {
    tools,
    getDraftSnapshot,
  };
}

function buildCandidateDocument(
  dashboard: DashboardDocument,
  workingDraft: WorkingDraftState,
): DashboardDocument {
  const nextDocument = cloneDashboardDocument(dashboard);
  const pruneUnusedQueries =
    Boolean(workingDraft.dashboardSpec) && !workingDraft.queryDefs;

  if (workingDraft.dashboardSpec) {
    nextDocument.dashboard_spec = cloneDashboardDocument({
      dashboard_spec: workingDraft.dashboardSpec,
      query_defs: [],
      bindings: [],
    }).dashboard_spec;
  }

  if (workingDraft.queryDefs) {
    nextDocument.query_defs = workingDraft.queryDefs;
  }

  if (workingDraft.bindings) {
    nextDocument.bindings = workingDraft.bindings;
  }

  return reconcileDashboardDocumentContract(nextDocument, {
    pruneUnusedQueries,
  });
}

function buildViewDetail(input: {
  document: DashboardDocument;
  view: DashboardView;
  latestCheck?: ViewCheckSnapshot | null;
}): ViewDetail {
  const rendererSummary = summarizeEChartsRenderer(input.view.renderer);
  const layout = getLayoutItemsForView(input.document, input.view.id);

  return {
    view: input.view,
    renderer_kind: input.view.renderer.kind,
    slot_summaries: rendererSummary.slot_summaries,
    renderer_summary: rendererSummary,
    layout: {
      desktop: layout.desktop ?? null,
      mobile: layout.mobile ?? null,
    },
    bindings: input.document.bindings
      .filter((binding) => binding.view_id === input.view.id)
      .map((binding) =>
        buildBindingDetail({
          binding,
          view: input.view,
          query: input.document.query_defs.find(
            (query) => query.id === binding.query_id,
          ),
        }),
      ),
    query_ids: collectViewQueryIds(input.view.id, input.document.bindings),
    latest_check: input.latestCheck ?? null,
  };
}

function buildQueryDetail(document: DashboardDocument, query: QueryDef): QueryDetail {
  return {
    query,
    used_by: document.bindings
      .filter((binding) => binding.query_id === query.id)
      .map((binding) => ({
        binding_id: binding.id,
        view_id: binding.view_id,
        slot_id: binding.slot_id,
      })),
  };
}

function resolveRequiredView(document: DashboardDocument, viewId?: string) {
  const view = viewId
    ? document.dashboard_spec.views.find((candidate) => candidate.id === viewId)
    : document.dashboard_spec.views[0];

  if (!view) {
    throw new Error("Requested view was not found.");
  }

  return view;
}

function findCheckSnapshot(
  checks: ViewCheckSnapshot[] | null | undefined,
  viewId: string,
) {
  return checks?.find((check) => check.view_id === viewId) ?? null;
}

function mergeRendererChecksByView(
  serverChecks: RendererChecksByView,
  existingChecks: ViewCheckSnapshot[] | null | undefined,
  visibleViewIds: string[],
): RendererChecksByView {
  const existingByViewId = new Map(
    (existingChecks ?? []).map((check) => [check.view_id, check.renderer_checks ?? {}]),
  );

  return Object.fromEntries(
    visibleViewIds.map((viewId) => [
      viewId,
      {
        ...(existingByViewId.get(viewId) ?? {}),
        ...(serverChecks[viewId] ?? {}),
      },
    ]),
  );
}

function buildPatchFromDocument(
  currentDocument: DashboardDocument,
  nextDocument: DashboardDocument,
  kind: AiSuggestionKind,
  workingDraft: WorkingDraftState,
): ContractPatch {
  const operations: ContractPatchOperation[] = [];
  const currentViews = new Map(
    currentDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const nextViews = new Map(
    nextDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const currentQueries = new Map(
    currentDocument.query_defs.map((query) => [query.id, query]),
  );
  const nextQueries = new Map(
    nextDocument.query_defs.map((query) => [query.id, query]),
  );
  const currentBindings = new Map(
    currentDocument.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindings = new Map(
    nextDocument.bindings.map((binding) => [binding.id, binding]),
  );
  const viewIds = collectRelevantPatchIds(
    currentViews,
    nextViews,
    workingDraft.dirtyViewIds,
  );

  for (const viewId of viewIds) {
    const previous = currentViews.get(viewId);
    const next = nextViews.get(viewId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "update",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Update view "${next.title}".`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Add view "${next.title}".`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `dashboard_spec.views.${viewId}`,
        summary: `Remove view "${previous.title}".`,
      });
    }
  }

  if (
    JSON.stringify(currentDocument.dashboard_spec.layout) !==
      JSON.stringify(nextDocument.dashboard_spec.layout) &&
    (workingDraft.layoutTouched || operations.some((operation) => operation.path.startsWith("dashboard_spec.views.")))
  ) {
    operations.push({
      op: "update",
      path: "dashboard_spec.layout",
      summary:
        kind === "layout"
          ? "Refresh desktop/mobile layout positions for the active canvas."
          : "Adjust layout references to keep views and bindings aligned.",
    });
  }

  const queryIds = collectRelevantPatchIds(
    currentQueries,
    nextQueries,
    workingDraft.dirtyQueryIds,
  );

  for (const queryId of queryIds) {
    const previous = currentQueries.get(queryId);
    const next = nextQueries.get(queryId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "upsert",
        path: `query_defs.${queryId}`,
        summary: `Update query "${next.name}" (${queryId}).`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `query_defs.${queryId}`,
        summary: `Add query "${next.name}" (${queryId}).`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `query_defs.${queryId}`,
        summary: `Remove query "${previous.name}" (${queryId}).`,
      });
    }
  }

  const bindingIds = collectRelevantPatchIds(
    currentBindings,
    nextBindings,
    workingDraft.dirtyBindingIds,
  );

  for (const bindingId of bindingIds) {
    const previous = currentBindings.get(bindingId);
    const next = nextBindings.get(bindingId);

    if (previous && next) {
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      operations.push({
        op: "upsert",
        path: `bindings.${bindingId}`,
        summary: `Update binding for view "${next.view_id}".`,
      });
      continue;
    }

    if (next) {
      operations.push({
        op: "add",
        path: `bindings.${bindingId}`,
        summary: `Add binding for view "${next.view_id}".`,
      });
      continue;
    }

    if (previous) {
      operations.push({
        op: "remove",
        path: `bindings.${bindingId}`,
        summary: `Remove binding for view "${previous.view_id}".`,
      });
    }
  }

  const uniqueOperations = dedupePatchOperations(operations);
  return {
    summary:
      kind === "layout"
        ? `Prepare ${uniqueOperations.length} layout-side contract updates.`
        : `Prepare ${uniqueOperations.length} data-side contract updates.`,
    operations: uniqueOperations,
  };
}

function resolveFocusedViewIdFromPatch(input: {
  patch: ContractPatch;
  currentDashboard: DashboardDocument;
  nextDashboard: DashboardDocument;
}): string | null {
  const currentBindings = new Map(
    input.currentDashboard.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindings = new Map(
    input.nextDashboard.bindings.map((binding) => [binding.id, binding]),
  );
  const nextViewIds = new Set(input.nextDashboard.dashboard_spec.views.map((view) => view.id));

  for (const operation of input.patch.operations) {
    const viewId = resolveViewIdFromPatchOperation(
      operation,
      currentBindings,
      nextBindings,
    );
    if (viewId && nextViewIds.has(viewId)) {
      return viewId;
    }
  }

  return null;
}

function resolveViewIdFromPatchOperation(
  operation: ContractPatchOperation,
  currentBindings: Map<string, Binding>,
  nextBindings: Map<string, Binding>,
): string | null {
  if (operation.path.startsWith("dashboard_spec.views.")) {
    return operation.path.slice("dashboard_spec.views.".length) || null;
  }

  if (!operation.path.startsWith("bindings.")) {
    return null;
  }

  const bindingId = operation.path.slice("bindings.".length);
  if (!bindingId) {
    return null;
  }

  if (operation.op === "remove") {
    return currentBindings.get(bindingId)?.view_id ?? null;
  }

  return nextBindings.get(bindingId)?.view_id ?? null;
}

function collectRelevantPatchIds<T extends { id: string }>(
  currentMap: Map<string, T>,
  nextMap: Map<string, T>,
  dirtyIds: Set<string>,
): string[] {
  if (dirtyIds.size > 0) {
    return [...dirtyIds];
  }

  return [...new Set([...currentMap.keys(), ...nextMap.keys()])];
}

function dedupePatchOperations(
  operations: ContractPatchOperation[],
): ContractPatchOperation[] {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.op}:${operation.path}:${operation.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createWorkingDraftState(
  snapshot?: DashboardAgentWorkingDraftSnapshot | null,
): WorkingDraftState {
  return {
    ...(snapshot?.dashboardSpec
      ? { dashboardSpec: cloneDashboardSpec(snapshot.dashboardSpec) }
      : {}),
    ...(snapshot?.queryDefs
      ? { queryDefs: snapshot.queryDefs.map(cloneQuery) }
      : {}),
    ...(snapshot?.bindings
      ? { bindings: snapshot.bindings.map(cloneBinding) }
      : {}),
    ...(snapshot?.bindingMode ? { bindingMode: snapshot.bindingMode } : {}),
    dirtyViewIds: new Set(snapshot?.dirtyViewIds ?? []),
    dirtyQueryIds: new Set(snapshot?.dirtyQueryIds ?? []),
    dirtyBindingIds: new Set(snapshot?.dirtyBindingIds ?? []),
    layoutTouched: snapshot?.layoutTouched ?? false,
    stagedAt: snapshot?.stagedAt ?? null,
  };
}

function cloneDashboardSpec(
  dashboardSpec: DashboardDocument["dashboard_spec"],
): DashboardDocument["dashboard_spec"] {
  return JSON.parse(JSON.stringify(dashboardSpec)) as DashboardDocument["dashboard_spec"];
}

function cloneRenderer(renderer: DashboardRenderer): DashboardRenderer {
  return JSON.parse(JSON.stringify(renderer)) as DashboardRenderer;
}

function cloneDatasourceSchema(
  datasourceSchema: DatasourceContext,
): DatasourceContext {
  return JSON.parse(JSON.stringify(datasourceSchema)) as DatasourceContext;
}

function cloneQuery(query: QueryDef): QueryDef {
  return JSON.parse(JSON.stringify(query)) as QueryDef;
}

function cloneBinding(binding: Binding): Binding {
  return JSON.parse(JSON.stringify(binding)) as Binding;
}

function buildDocumentFingerprint(document: DashboardDocument) {
  return dashboardDocumentPersistenceFingerprint(document);
}

function buildPreviewFilterValues(document: DashboardDocument): Record<string, JsonValue> {
  return Object.fromEntries(
    document.dashboard_spec.filters
      .filter((filter) => filter.default_value !== undefined)
      .map((filter) => [filter.id, filter.default_value as JsonValue]),
  );
}

function buildFailureSignature(failure: DashboardAgentCheckFailure) {
  return [
    failure.source,
    failure.code,
    failure.path ?? "*",
    failure.view_id ?? "*",
    failure.query_id ?? "*",
    failure.binding_id ?? "*",
  ].join(":");
}

function registerRunCheckState(input: {
  previous: LastRunCheckState | null;
  fingerprint: string;
  failures: DashboardAgentCheckFailure[];
}): LastRunCheckState {
  const signatures = input.failures.map(buildFailureSignature).sort();
  const sameAsPrevious =
    input.previous &&
    signatures.length > 0 &&
    input.previous.signatures.length === signatures.length &&
    input.previous.signatures.every((signature, index) => signature === signatures[index]);

  return {
    fingerprint: input.fingerprint,
    signatures,
    consecutive_repeat_count: sameAsPrevious
      ? (input.previous?.consecutive_repeat_count ?? 0) + 1
      : signatures.length > 0
        ? 1
        : 0,
  };
}

function normalizeLayoutItem(
  layoutItem: DashboardLayoutItem | undefined,
  viewId: string,
): DashboardLayoutItem | undefined {
  if (!layoutItem) {
    return undefined;
  }

  return {
    ...layoutItem,
    view_id: viewId,
  };
}

function buildPatchDetails(input: {
  dashboard: DashboardDocument;
  bindingMode?: "mock" | "live";
  runtimeCheck?: DashboardAgentCheckSummary;
  repair: DashboardAgentDraftOutput["repair"];
}) {
  const details = [
    `Prepared ${input.dashboard.dashboard_spec.views.length} view${input.dashboard.dashboard_spec.views.length === 1 ? "" : "s"} in the candidate dashboard.`,
    `Prepared ${input.dashboard.query_defs.length} query definition${input.dashboard.query_defs.length === 1 ? "" : "s"} and ${input.dashboard.bindings.length} binding${input.dashboard.bindings.length === 1 ? "" : "s"}.`,
  ];

  if (input.bindingMode) {
    details.push(`Binding mode for the candidate patch is "${input.bindingMode}".`);
  }

  if (input.runtimeCheck) {
    details.push(`Runtime check: ${input.runtimeCheck.reason}`);
  }

  if (input.repair.attempted > 0) {
    details.push(
      `${input.repair.status === "repaired" ? "Auto-repair stabilized" : "Auto-repair attempted"} in ${input.repair.attempted} round${input.repair.attempted === 1 ? "" : "s"}.`,
    );
  }

  return details;
}

async function stabilizeCandidateDocument(input: {
  dashboard: DashboardDocument;
  phase: DraftPhase;
  dependencies?: DashboardAgentDependencies;
}): Promise<{
  dashboard: DashboardDocument;
  runtimeCheck?: DashboardAgentCheckSummary;
  repair: DashboardAgentDraftOutput["repair"];
}> {
  const document = reconcileDashboardDocumentContract(
    cloneDashboardDocument(input.dashboard),
  );
  const validation = validateDashboardDocument(document, "save");
  if (!validation.ok) {
    return {
      dashboard: document,
      runtimeCheck: buildValidationRuntimeCheck(validation.issues, document),
      repair: {
        status: "failed",
        attempted: 0,
        max_attempts: MAX_AUTOREPAIR_ATTEMPTS,
        repaired: false,
        notes: ["Compose patch is blocked until the staged contract is valid."],
      },
    };
  }

  const finalPreviewCheck = await executePreviewCheckForDocument(
    document,
    input.dependencies,
    input.phase,
  );
  const failures = collectRunCheckFailures({
    document,
    phase: input.phase,
    runtimeCheck: finalPreviewCheck.runtimeCheck,
    rendererChecks: finalPreviewCheck.rendererChecks,
    visibleViewIds: collectVisibleViewIds(document),
  });

  return {
    dashboard: document,
    runtimeCheck: finalPreviewCheck.runtimeCheck,
    repair: {
      status: failures.length > 0 ? "failed" : "not-needed",
      attempted: 0,
      max_attempts: MAX_AUTOREPAIR_ATTEMPTS,
      repaired: false,
      notes:
        failures.length > 0
          ? ["Compose patch is blocked until all reliability failures are resolved."]
          : [],
    },
  };
}

function buildValidationRuntimeCheck(
  issues: ValidationIssue[],
  document: DashboardDocument,
): DashboardAgentCheckSummary {
  return {
    status: "error",
    reason: `${issues.length} contract validation issue${issues.length === 1 ? "" : "s"} blocked runtime preview.`,
    counts: {
      ok: 0,
      empty: 0,
      error: issues.length,
    },
    errors: issues.map((issue) => buildValidationFailure(document, issue)),
  };
}

async function executePreviewCheckForDocument(
  document: DashboardDocument,
  dependencies?: DashboardAgentDependencies,
  phase: DraftPhase = "data",
  visibleViewIds: string[] = collectVisibleViewIds(document),
): Promise<{
  runtimeCheck: DashboardAgentCheckSummary;
  rendererChecks: RendererChecksByView;
}> {
  if (!dependencies?.executePreview) {
    return {
      runtimeCheck: {
        status: "error",
        reason: "Runtime preview capability is unavailable.",
        counts: {
          ok: 0,
          empty: 0,
          error: 0,
        },
        errors: [],
      },
      rendererChecks: {},
    };
  }

  const request: PreviewRequest = {
    dashboard_spec: document.dashboard_spec,
    query_defs: document.query_defs,
    bindings: document.bindings,
    visible_view_ids: visibleViewIds,
    filter_values: buildPreviewFilterValues(document),
  };
  const outcome = await dependencies.executePreview(request);

  if (outcome.body.status_code !== 200 || !outcome.body.data) {
    return {
      runtimeCheck: {
        status: "error",
        reason: outcome.body.reason,
        counts: {
          ok: 0,
          empty: 0,
          error: 1,
        },
        errors: [
          {
            source: "runtime",
            code: outcome.body.reason,
            message: outcome.body.reason,
          },
        ],
      },
      rendererChecks: {},
    };
  }

  const results: BindingResult[] = Object.values(outcome.body.data.binding_results);
  const blockingErrorResults = results
    .filter((result) => result.status === "error")
    .filter((result) => !isAllowedFirstPhaseGap(result, phase));
  const counts = {
    ok: results.filter((result) => result.status === "ok").length,
    empty: results.filter((result) => result.status === "empty").length,
    error: blockingErrorResults.length,
  };
  const errors = blockingErrorResults
    .map((result) => ({
      source: "runtime" as const,
      view_id: result.view_id,
      query_id: result.query_id,
      binding_id: findBindingIdForResult(document, result),
      code: result.code ?? "RUNTIME_CHECK_FAILED",
      message: result.message ?? "Runtime preview failed for this binding.",
    }));

  return {
    runtimeCheck: {
      status: counts.error > 0 ? "error" : counts.empty > 0 ? "warning" : "ok",
      reason:
        counts.error > 0
          ? `${counts.error} binding checks failed.`
          : counts.empty > 0
            ? `${counts.ok} bindings passed and ${counts.empty} returned empty rows.`
            : `${counts.ok} bindings passed runtime check.`,
      counts,
      errors,
    },
    rendererChecks: outcome.body.data.renderer_checks,
  };
}

function buildViewCheckSnapshots(input: {
  document: DashboardDocument;
  runtimeCheck: DashboardAgentCheckSummary;
  rendererChecks: RendererChecksByView;
  visibleViewIds: string[];
}): ViewCheckSnapshot[] {
  const visibleSet = new Set(input.visibleViewIds);

  return input.document.dashboard_spec.views
    .filter((view) => visibleSet.has(view.id))
    .map((view) => {
      const viewErrors = input.runtimeCheck.errors.filter(
        (error) => !error.view_id || error.view_id === view.id,
      );
      const hasBindings = input.document.bindings.some(
        (binding) => binding.view_id === view.id,
      );
      const rendererChecks = input.rendererChecks[view.id] ?? {};
      const rendererSummary = summarizeRendererValidationChecks(rendererChecks);
      const status = viewErrors.length || rendererSummary.status === "error"
        ? "error"
        : hasBindings && input.runtimeCheck.counts.empty > 0
          ? "empty"
          : hasBindings
            ? "ok"
            : "stale";

      return {
        view_id: view.id,
        status,
        reason:
          viewErrors[0]?.message ??
          (rendererSummary.status === "error" ? rendererSummary.reason : undefined) ??
          (status === "empty"
            ? "Preview returned empty rows."
            : status === "ok"
              ? "Runtime check passed."
              : "No active binding was checked."),
        last_checked_at: new Date().toISOString(),
        query_ids: collectViewQueryIds(view.id, input.document.bindings),
        binding_ids: input.document.bindings
          .filter((binding) => binding.view_id === view.id)
          .map((binding) => binding.id),
        runtime_summary: input.runtimeCheck,
        renderer_checks: {
          server:
            rendererChecks.server ??
            createUnknownRendererCheck("server"),
          browser:
            rendererChecks.browser ??
            createUnknownRendererCheck("browser"),
        },
      };
    });
}

function buildValidationFailure(
  document: DashboardDocument,
  issue: ValidationIssue,
): DashboardAgentCheckFailure {
  const bindingMatch = issue.path.match(/^bindings\[(\d+)\]/);
  if (bindingMatch) {
    const binding = document.bindings[Number(bindingMatch[1])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: binding?.view_id,
      query_id: binding?.query_id,
      binding_id: binding?.id,
    };
  }

  const queryMatch = issue.path.match(/^query_defs\[(\d+)\]/);
  if (queryMatch) {
    const query = document.query_defs[Number(queryMatch[1])];
    const binding = query
      ? document.bindings.find((candidate) => candidate.query_id === query.id)
      : undefined;
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: binding?.view_id,
      query_id: query?.id,
      binding_id: binding?.id,
    };
  }

  const viewMatch = issue.path.match(/^dashboard_spec\.views\[(\d+)\]/);
  if (viewMatch) {
    const view = document.dashboard_spec.views[Number(viewMatch[1])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: view?.id,
    };
  }

  const layoutMatch = issue.path.match(
    /^dashboard_spec\.layout\.(desktop|mobile)\.items\[(\d+)\]/,
  );
  if (layoutMatch) {
    const layout = document.dashboard_spec.layout[
      layoutMatch[1] as "desktop" | "mobile"
    ];
    const item = layout?.items[Number(layoutMatch[2])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: item?.view_id,
    };
  }

  return {
    source: "contract",
    code: "CONTRACT_VALIDATION_ERROR",
    message: issue.message,
    path: issue.path,
  };
}

function findBindingIdForResult(
  document: DashboardDocument,
  result: BindingResult,
) {
  return document.bindings.find(
    (binding) =>
      binding.view_id === result.view_id &&
      binding.query_id === result.query_id &&
      binding.slot_id === result.slot_id,
  )?.id;
}

function collectRunCheckFailures(input: {
  document: DashboardDocument;
  phase: DraftPhase;
  runtimeCheck: DashboardAgentCheckSummary;
  rendererChecks: RendererChecksByView;
  visibleViewIds: string[];
}): DashboardAgentCheckFailure[] {
  const failures = [...input.runtimeCheck.errors];

  for (const viewId of input.visibleViewIds) {
    const checks = input.rendererChecks[viewId] ?? {};
    for (const check of Object.values(checks)) {
      if (check?.status === "error") {
        failures.push({
          source: "renderer",
          code: `RENDERER_${check.target.toUpperCase()}_ERROR`,
          message: check.message ?? check.reason,
          view_id: viewId,
        });
      }
    }
  }

  return failures;
}

function determineDraftPhase(workingDraft: WorkingDraftState): DraftPhase {
  const hasLiveQueryDraft = Boolean(workingDraft.queryDefs);
  const hasLiveBindingDraft = Boolean(
    workingDraft.bindings?.some((binding) => (binding.mode ?? "live") === "live"),
  );
  return hasLiveQueryDraft || hasLiveBindingDraft ? "data" : "view";
}

function isAllowedFirstPhaseGap(
  result: BindingResult,
  phase: DraftPhase,
) {
  return (
    phase === "view" &&
    result.status === "error" &&
    result.code === "BINDING_NOT_FOUND"
  );
}

function collectVisibleViewIds(document: DashboardDocument) {
  const layoutViewIds = new Set<string>();

  for (const breakpoint of Object.values(document.dashboard_spec.layout)) {
    for (const item of breakpoint.items) {
      layoutViewIds.add(item.view_id);
    }
  }

  return layoutViewIds.size > 0
    ? Array.from(layoutViewIds)
    : document.dashboard_spec.views.map((view) => view.id);
}
