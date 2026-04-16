import {
  tool,
  type ToolSet,
} from "ai";
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
  MainAgentCheckFailure,
  MainAgentCheckSummary,
  MainAgentDraftOutput,
  MainAgentMessage,
  MainAgentSkillSummary,
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
} from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentWorkingDraftSnapshot } from "@/ai/main-agent/contracts/session-state";
import type {
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
} from "@/ai/main-agent/tools/artifacts";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/ai/main-agent/contracts/agent-contract";
import {
  buildCandidateDocument,
  buildDocumentFingerprint,
} from "@/ai/shared/worker/candidate-document";
import { createMockBindingForView } from "@/domain/dashboard/bindings";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
  hasGrantedApplyPatchApprovalInModelMessages,
  hasPendingApprovalResponse,
} from "@/ai/main-agent/messages/message-inspection";
import {
  cloneDashboardDocument,
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
} from "@/ai/view-worker/context";
import type { MainAgentDependencies } from "@/ai/main-agent/engine/dependencies";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  createUnknownRendererCheck,
  summarizeRendererValidationChecks,
} from "@/renderers/core/validation-result";
import {
  buildQueryDetail,
  buildViewDetail,
  collectVisibleViewIds,
  findCheckSnapshot,
  mergeRendererChecksByView,
  resolveFocusedViewIdFromPatch,
  resolveRequiredView,
} from "@/ai/shared/worker/detail-builders";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneDatasourceSchema,
  cloneQuery,
  cloneRenderer,
  createWorkingDraftState,
  type WorkingDraftState,
} from "@/ai/shared/worker/draft-state";
import {
  buildPatchDetails,
  buildPatchFromDocument,
} from "@/ai/shared/worker/patch-builder";
import {
  DraftPhase,
  LastRunCheckState,
  MAX_AUTOREPAIR_ATTEMPTS,
  buildValidationRuntimeCheck,
  buildViewCheckSnapshots,
  collectRunCheckFailures,
  determineDraftPhase,
  executePreviewCheckForDocument,
  normalizeLayoutItem,
  registerRunCheckState,
  stabilizeCandidateDocument,
} from "@/ai/shared/worker/reliability";

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

export function buildMainAgentTools(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: MainAgentSkillSummary[] | null;
  messages?: MainAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: MainAgentWorkingDraftSnapshot | null;
  dependencies?: MainAgentDependencies;
}) {
  const focusedViewId = input.focusedViewId?.trim() || null;
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

  const getDraftSnapshot = (): MainAgentWorkingDraftSnapshot | null => {
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
        const requestedViewId = toolInput.view_id?.trim();
        const requestedTitle = toolInput.title?.trim();
        if (focusedViewId && requestedViewId && requestedViewId !== focusedViewId) {
          throw new Error(`View worker is restricted to "${focusedViewId}".`);
        }
        const viewSummary = buildViewListSummary({
          document,
          dashboardId: input.dashboardId,
          checks: input.checks,
        });

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
        if (focusedViewId && view_id !== focusedViewId) {
          throw new Error(`Binding inspection is restricted to "${focusedViewId}".`);
        }
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
        if (focusedViewId && toolInput.scope === "view" && toolInput.view_id && toolInput.view_id !== focusedViewId) {
          throw new Error(`View check is restricted to "${focusedViewId}".`);
        }
        const visibleViewIds =
          toolInput.scope === "view"
            ? [
                resolveRequiredView(
                  document,
                  toolInput.view_id ?? focusedViewId ?? "",
                ).id,
              ]
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
          focusedViewId ||
          toolInput.view_spec.view_id?.trim() ||
          `v_ai_${document.dashboard_spec.views.length + 1}`;
        if (focusedViewId && toolInput.layout) {
          throw new Error("View worker cannot modify layout.");
        }
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
        if (focusedViewId && nextBinding.view_id !== focusedViewId) {
          throw new Error(`Binding updates are restricted to "${focusedViewId}".`);
        }
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
      execute: async (): Promise<MainAgentDraftOutput> => {
        const phase = determineDraftPhase(workingDraft);
        const includesDataDraft = phase === "data";
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = await stabilizeCandidateDocument({
          dashboard: buildCandidateDocument(input.dashboard, workingDraft),
          phase,
          dependencies: input.dependencies,
          validateDocument: (document) => validateDashboardDocument(document, "save"),
          cloneDocument: cloneDashboardDocument,
          reconcileDocument: (document) =>
            reconcileDashboardDocumentContract(document),
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
          validateDocument: (document) => validateDashboardDocument(document, "save"),
          cloneDocument: cloneDashboardDocument,
          reconcileDocument: (document) =>
            reconcileDashboardDocumentContract(document),
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
