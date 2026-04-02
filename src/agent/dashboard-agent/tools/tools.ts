import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  Binding,
  BindingResult,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
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
  DashboardAgentCheckSummary,
  DashboardAgentDraftOutput,
  DashboardAgentMessage,
  DatasourceListItemSummary,
  GetBindingToolInput,
  GetDatasourcesToolInput,
  GetDatasourcesToolOutput,
  GetQueryToolInput,
  GetSchemaByDatasourceToolInput,
  GetSchemaByDatasourceToolOutput,
  GetViewToolInput,
  GetViewsToolInput,
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
} from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
} from "@/agent/dashboard-agent/messages/message-inspection";
import {
  buildBindingsForViews,
  buildMockBindingsForViews,
  buildPatchFromDocument,
  buildQueryDefsForViews,
  shouldGenerateMockBindings,
} from "@/agent/dashboard-agent/tools/ai-assist";
import {
  cloneDashboardDocument,
  getLayoutItemsForView,
  getBindingsForView,
  reconcileDashboardDocumentContract,
  removeBindingFromDocument,
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";
import {
  buildViewListSummary,
} from "@/agent/dashboard-agent/context";
import type { DashboardAgentDependencies } from "@/agent/dashboard-agent/runtime/dependencies";
import { summarizeEChartsRenderer } from "@/renderers/echarts/summary";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  createUnknownRendererCheck,
  summarizeRendererValidationChecks,
} from "@/renderers/core/validation-result";

const PREVIEW_FILTER_VALUES = {
  f_time_range: "last_12_weeks",
  f_region: "all",
} as const;

const RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

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
});
const rendererSchema = z.object({
  kind: z.literal("echarts"),
  option_template: z.record(z.string(), z.any()),
  slots: z.array(rendererSlotSchema),
});

interface WorkingDraftState {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
}

export function buildDashboardAgentTools(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages?: DashboardAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  dependencies?: DashboardAgentDependencies;
}) {
  const workingDraft: WorkingDraftState = {};
  let datasourceListCache =
    input.datasources?.map((datasource) => ({ ...datasource })) ?? null;
  const datasourceSchemaCache = new Map<string, DatasourceContext>();
  let activeDatasourceId: string | null = null;

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
      activeDatasourceId = datasourceId;
      return cloneDatasourceSchema(cached);
    }

    const schema = await input.dependencies?.loadDatasourceSchema?.(datasourceId);
    if (!schema) {
      throw new Error(`Datasource schema "${datasourceId}" is unavailable.`);
    }

    datasourceSchemaCache.set(datasourceId, cloneDatasourceSchema(schema));
    activeDatasourceId = datasourceId;
    return cloneDatasourceSchema(schema);
  };

  const getActiveDatasourceSchema = () => {
    if (!activeDatasourceId) {
      return null;
    }

    const schema = datasourceSchemaCache.get(activeDatasourceId);
    return schema ? cloneDatasourceSchema(schema) : null;
  };

  return {
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
        const visibleViewIds =
          toolInput.scope === "view"
            ? [resolveRequiredView(document, toolInput.view_id).id]
            : collectVisibleViewIds(document);
        const previewCheck = await executePreviewCheckForDocument(
          document,
          input.dependencies,
          visibleViewIds,
        );
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
        return {
          status: previewCheck.runtimeCheck.status,
          reason: previewCheck.runtimeCheck.reason,
          checks,
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
        const document = buildCandidateDocument(input.dashboard, workingDraft);
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

        workingDraft.dashboardSpec = cloneDashboardDocument(nextCandidate).dashboard_spec;
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
        "Stage a live query definition for one view using an explicitly loaded datasource schema.",
      inputSchema: z.object({
        request: z.string().min(1),
        view_id: z.string().optional(),
        query_id: z.string().optional(),
      }),
      execute: async (toolInput: UpsertQueryToolInput): Promise<UpsertQueryToolOutput> => {
        const datasourceSchema = getActiveDatasourceSchema();

        if (!datasourceSchema) {
          throw new Error(
            "Datasource schema is unavailable. Call getSchemaByDatasource before upsertQuery.",
          );
        }

        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const targetView = toolInput.view_id
          ? resolveRequiredView(document, toolInput.view_id)
          : document.dashboard_spec.views[0];

        if (!targetView) {
          throw new Error("No view is available to generate a query for.");
        }

        const nextQuery = buildQueryDefsForViews(
          [targetView],
          datasourceSchema,
        )[0];
        const nextCandidate = upsertQueryInDocument(document, nextQuery);
        workingDraft.queryDefs = nextCandidate.query_defs;
        const candidate = buildCandidateDocument(input.dashboard, workingDraft);

        return {
          summary: `Staged query "${nextQuery.name}" for view "${targetView.title}".`,
          query: buildQueryDetail(
            candidate,
            candidate.query_defs.find((query) => query.id === nextQuery.id) ?? nextQuery,
          ),
        };
      },
    }),
    upsertBinding: tool({
      description:
        "Stage bindings for one view using either live query output or mock data.",
      inputSchema: z.object({
        request: z.string().min(1),
        view_id: z.string().min(1),
        query_id: z.string().optional(),
        binding_mode: z.enum(["mock", "live"]).optional(),
        slot_id: z.string().optional(),
      }),
      execute: async (toolInput: UpsertBindingToolInput): Promise<UpsertBindingToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const view = resolveRequiredView(document, toolInput.view_id);
        const bindingMode =
          toolInput.binding_mode ??
          (shouldGenerateMockBindings(toolInput.request) ? "mock" : "live");
        const queryDefs = workingDraft.queryDefs ?? document.query_defs;

        if (bindingMode === "live" && queryDefs.length === 0) {
          throw new Error("Live bindings require at least one staged query definition.");
        }

        const nextBindings =
          bindingMode === "mock"
            ? buildMockBindingsForViews([view])
            : buildBindingsForViews(
                [view],
                toolInput.query_id
                  ? queryDefs.filter((query) => query.id === toolInput.query_id)
                  : queryDefs,
              );

        let nextCandidate = document;
        for (const existingBinding of getBindingsForView(nextCandidate, view.id)) {
          nextCandidate = removeBindingFromDocument(nextCandidate, existingBinding.id);
        }
        for (const nextBinding of nextBindings) {
          nextCandidate = upsertBindingInDocument(nextCandidate, nextBinding);
        }
        workingDraft.bindings = nextCandidate.bindings;
        workingDraft.bindingMode = bindingMode;

        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
        const bindings = candidate.bindings
          .filter(
            (binding) =>
              binding.view_id === view.id &&
              (!toolInput.slot_id || binding.slot_id === toolInput.slot_id),
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
          summary: `Staged ${bindingMode} binding${bindings.length === 1 ? "" : "s"} for "${view.title}".`,
          bindings,
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
        const includesDataDraft = !!workingDraft.queryDefs || !!workingDraft.bindings;
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = includesDataDraft
          ? await stabilizeCandidateDocument({
              dashboard: buildCandidateDocument(input.dashboard, workingDraft),
              datasourceSchema: getActiveDatasourceSchema(),
              preferredBindingMode: workingDraft.bindingMode,
              dependencies: input.dependencies,
            })
          : {
              dashboard: buildCandidateDocument(input.dashboard, workingDraft),
              runtimeCheck: undefined,
              repair: {
                status: "not-needed" as const,
                attempted: 0,
                max_attempts: 2,
                repaired: false,
                notes: [],
              },
            };
        const patch = buildPatchFromDocument(
          input.dashboard,
          stabilization.dashboard,
          kind,
        );

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
      needsApproval: true,
      execute: async ({
        suggestion_id,
      }: ApplyPatchToolInput): Promise<ApplyPatchToolOutput> => {
        const draftOutput =
          suggestion_id && input.messages
            ? findDraftOutputBySuggestionId(input.messages, suggestion_id)
            : findLatestDraftOutput(input.messages ?? []);

        if (!draftOutput) {
          throw new Error(
            "No staged composePatch proposal is available to apply. Call composePatch first.",
          );
        }

        const candidate = draftOutput.suggestion.dashboard;
        if (!candidate) {
          throw new Error(
            "Staged composePatch proposal is missing its dashboard payload. Call composePatch again.",
          );
        }

        return {
          applied: true,
          suggestion_id: draftOutput.suggestion.id,
          kind: draftOutput.suggestion.kind,
          title: draftOutput.suggestion.title,
          summary: draftOutput.suggestion.summary,
          patch_summary: draftOutput.suggestion.patch.summary,
          dashboard: cloneDashboardDocument(candidate),
        };
      },
    }),
  } satisfies ToolSet;
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

function cloneRenderer(renderer: DashboardRenderer): DashboardRenderer {
  return JSON.parse(JSON.stringify(renderer)) as DashboardRenderer;
}

function cloneDatasourceSchema(
  datasourceSchema: DatasourceContext,
): DatasourceContext {
  return JSON.parse(JSON.stringify(datasourceSchema)) as DatasourceContext;
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
  datasourceSchema?: DatasourceContext | null;
  preferredBindingMode?: "mock" | "live";
  dependencies?: DashboardAgentDependencies;
}): Promise<{
  dashboard: DashboardDocument;
  runtimeCheck?: DashboardAgentCheckSummary;
  repair: DashboardAgentDraftOutput["repair"];
}> {
  let document = reconcileDashboardDocumentContract(
    cloneDashboardDocument(input.dashboard),
  );
  const notes: string[] = [];
  let attempted = 0;

  while (attempted < 2) {
    const validation = validateDashboardDocument(document, "save");
    if (!validation.ok) {
      const repaired = applyDeterministicRepair({
        document,
        datasourceSchema: input.datasourceSchema,
        issues: validation.issues,
        preferredBindingMode: input.preferredBindingMode,
      });

      if (!repaired) {
        return {
          dashboard: document,
          runtimeCheck: buildValidationRuntimeCheck(validation.issues),
          repair: {
            status: "failed",
            attempted,
            max_attempts: 2,
            repaired: false,
            notes,
          },
        };
      }

      attempted += 1;
      document = reconcileDashboardDocumentContract(repaired.dashboard);
      notes.push(repaired.note);
      continue;
    }

    const previewCheck = await executePreviewCheckForDocument(
      document,
      input.dependencies,
    );
    if (previewCheck.runtimeCheck.status !== "error") {
      return {
        dashboard: document,
        runtimeCheck: previewCheck.runtimeCheck,
        repair: {
          status: attempted > 0 ? "repaired" : "not-needed",
          attempted,
          max_attempts: 2,
          repaired: attempted > 0,
          notes,
        },
      };
    }

    const repaired = applyDeterministicRepair({
      document,
      datasourceSchema: input.datasourceSchema,
      runtimeErrors: previewCheck.runtimeCheck.errors,
      preferredBindingMode: input.preferredBindingMode,
    });

    if (!repaired) {
      return {
        dashboard: document,
        runtimeCheck: previewCheck.runtimeCheck,
        repair: {
          status: "failed",
          attempted,
          max_attempts: 2,
          repaired: false,
          notes: [...notes, previewCheck.runtimeCheck.reason],
        },
      };
    }

    attempted += 1;
    document = reconcileDashboardDocumentContract(repaired.dashboard);
    notes.push(repaired.note);
  }

  const finalPreviewCheck = await executePreviewCheckForDocument(
    document,
    input.dependencies,
  );
  return {
    dashboard: document,
    runtimeCheck: finalPreviewCheck.runtimeCheck,
    repair: {
      status: finalPreviewCheck.runtimeCheck.status === "error" ? "failed" : "repaired",
      attempted,
      max_attempts: 2,
      repaired: finalPreviewCheck.runtimeCheck.status !== "error",
      notes,
    },
  };
}

function applyDeterministicRepair(input: {
  document: DashboardDocument;
  datasourceSchema?: DatasourceContext | null;
  issues?: ValidationIssue[];
  runtimeErrors?: DashboardAgentCheckSummary["errors"];
  preferredBindingMode?: "mock" | "live";
}): { dashboard: DashboardDocument; note: string } | null {
  const bindingMode = inferBindingMode(input.document, input.preferredBindingMode);
  const views = input.document.dashboard_spec.views;

  if (bindingMode === "mock") {
    return {
      dashboard: {
        ...cloneDashboardDocument(input.document),
        bindings: buildMockBindingsForViews(views),
      },
      note: "Rebuilt mock bindings from the current views.",
    };
  }

  const validationPaths = new Set(
    (input.issues ?? []).map((issue) => issue.path.split(".")[0]),
  );
  const runtimeCodes = new Set(
    (input.runtimeErrors ?? []).map((error) => error.code).filter(Boolean),
  );

  if (
    input.datasourceSchema &&
    (validationPaths.has("query_defs") ||
      runtimeCodes.has("QUERY_EXECUTION_ERROR") ||
      runtimeCodes.has("QUERY_NOT_FOUND") ||
      runtimeCodes.has("RESULT_SCHEMA_MISMATCH"))
  ) {
    const queryDefs = buildQueryDefsForViews(views, input.datasourceSchema);
    return {
      dashboard: {
        ...cloneDashboardDocument(input.document),
        query_defs: queryDefs,
        bindings: buildBindingsForViews(views, queryDefs),
      },
      note: "Rebuilt query definitions and live bindings from the datasource snapshot.",
    };
  }

  if (
    validationPaths.has("bindings") ||
    runtimeCodes.has("BINDING_NOT_FOUND") ||
    runtimeCodes.has("BINDING_INVALID") ||
    runtimeCodes.has("PARAM_MAPPING_MISSING") ||
    runtimeCodes.has("PARAM_RESOLUTION_FAILED") ||
    runtimeCodes.has("RESULT_SCHEMA_MISMATCH")
  ) {
    if (input.document.query_defs.length === 0) {
      return null;
    }

    return {
      dashboard: {
        ...cloneDashboardDocument(input.document),
        bindings: buildBindingsForViews(views, input.document.query_defs),
      },
      note: "Rebuilt live bindings from the current views and query definitions.",
    };
  }

  return null;
}

function inferBindingMode(
  document: DashboardDocument,
  preferredBindingMode?: "mock" | "live",
) {
  if (preferredBindingMode) {
    return preferredBindingMode;
  }

  const firstBinding = document.bindings[0];
  return firstBinding?.mode ?? (document.query_defs.length > 0 ? "live" : "mock");
}

function buildValidationRuntimeCheck(
  issues: ValidationIssue[],
): DashboardAgentCheckSummary {
  return {
    status: "error",
    reason: `${issues.length} contract validation issue${issues.length === 1 ? "" : "s"} blocked runtime preview.`,
    counts: {
      ok: 0,
      empty: 0,
      error: issues.length,
    },
    errors: issues.map((issue) => ({
      view_id: issue.path,
      query_id: issue.path,
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
    })),
  };
}

async function executePreviewCheckForDocument(
  document: DashboardDocument,
  dependencies?: DashboardAgentDependencies,
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
    filter_values: { ...PREVIEW_FILTER_VALUES },
    runtime_context: { ...RUNTIME_CONTEXT },
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
          error: 0,
        },
        errors: [],
      },
      rendererChecks: {},
    };
  }

  const results: BindingResult[] = Object.values(outcome.body.data.binding_results);
  const counts = {
    ok: results.filter((result) => result.status === "ok").length,
    empty: results.filter((result) => result.status === "empty").length,
    error: results.filter((result) => result.status === "error").length,
  };
  const errors = results
    .filter((result) => result.status === "error")
    .map((result) => ({
      view_id: result.view_id,
      query_id: result.query_id,
      code: result.code,
      message: result.message,
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
        (error) => error.view_id === view.id,
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
