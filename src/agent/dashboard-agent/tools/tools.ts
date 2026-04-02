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
import type {
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
} from "@/agent/dashboard-agent/tools/artifacts";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
} from "@/agent/dashboard-agent/messages/message-inspection";
import {
  cloneDashboardDocument,
  getLayoutItemsForView,
  reconcileDashboardDocumentContract,
  removeBindingFromDocument,
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import {
  buildViewListSummary,
} from "@/agent/dashboard-agent/context";
import type { DashboardAgentDependencies } from "@/agent/dashboard-agent/engine/dependencies";
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
  field_mapping: z.record(z.string(), z.string()).optional(),
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
}

interface LastRunCheckState {
  fingerprint: string;
  signatures: string[];
  consecutive_repeat_count: number;
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
          visibleViewIds,
        );
        const failures = collectRunCheckFailures({
          document,
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

        const afterFingerprint = buildDocumentFingerprint(nextCandidate);
        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic view change was staged for "${nextView.title}". Inspect the current view and submit a different explicit view contract.`,
          );
        }

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
        for (const existingBinding of nextCandidate.bindings.filter(
          (binding) =>
            binding.view_id === nextBinding.view_id &&
            binding.slot_id === nextBinding.slot_id &&
            binding.id !== nextBinding.id,
        )) {
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
    composePatch: tool({
      description:
        "Compose the staged candidate document into one approval-ready patch.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (): Promise<DashboardAgentDraftOutput> => {
        const includesDataDraft = !!workingDraft.queryDefs || !!workingDraft.bindings;
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = await stabilizeCandidateDocument({
          dashboard: buildCandidateDocument(input.dashboard, workingDraft),
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

        const reliability = await stabilizeCandidateDocument({
          dashboard: candidate,
          dependencies: input.dependencies,
        });
        if (reliability.repair.status === "failed") {
          throw new Error(
            reliability.repair.notes[0] ??
              reliability.runtimeCheck?.reason ??
              "Apply patch is blocked until the staged contract passes reliability checks.",
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

function buildPatchFromDocument(
  currentDocument: DashboardDocument,
  nextDocument: DashboardDocument,
  kind: AiSuggestionKind,
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

  for (const view of nextDocument.dashboard_spec.views) {
    const previous = currentViews.get(view.id);
    operations.push({
      op: previous ? "update" : "add",
      path: `dashboard_spec.views.${view.id}`,
      summary: previous
        ? `Update view "${view.title}".`
        : `Add view "${view.title}".`,
    });
  }

  for (const view of currentDocument.dashboard_spec.views) {
    if (!nextViews.has(view.id)) {
      operations.push({
        op: "remove",
        path: `dashboard_spec.views.${view.id}`,
        summary: `Remove view "${view.title}".`,
      });
    }
  }

  if (
    JSON.stringify(currentDocument.dashboard_spec.layout) !==
    JSON.stringify(nextDocument.dashboard_spec.layout)
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

  for (const query of nextDocument.query_defs) {
    const previous = currentQueries.get(query.id);
    operations.push({
      op: previous ? "upsert" : "add",
      path: `query_defs.${query.id}`,
      summary: previous
        ? `Update query "${query.name}" (${query.id}).`
        : `Add query "${query.name}" (${query.id}).`,
    });
  }

  for (const query of currentDocument.query_defs) {
    if (!nextQueries.has(query.id)) {
      operations.push({
        op: "remove",
        path: `query_defs.${query.id}`,
        summary: `Remove query "${query.name}" (${query.id}).`,
      });
    }
  }

  for (const binding of nextDocument.bindings) {
    const previous = currentBindings.get(binding.id);
    operations.push({
      op: previous ? "upsert" : "add",
      path: `bindings.${binding.id}`,
      summary: previous
        ? `Update binding for view "${binding.view_id}".`
        : `Add binding for view "${binding.view_id}".`,
    });
  }

  for (const binding of currentDocument.bindings) {
    if (!nextBindings.has(binding.id)) {
      operations.push({
        op: "remove",
        path: `bindings.${binding.id}`,
        summary: `Remove binding for view "${binding.view_id}".`,
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
  );
  const failures = collectRunCheckFailures({
    document,
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
  const counts = {
    ok: results.filter((result) => result.status === "ok").length,
    empty: results.filter((result) => result.status === "empty").length,
    error: results.filter((result) => result.status === "error").length,
  };
  const errors = results
    .filter((result) => result.status === "error")
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
      view_id: item?.view_id,
    };
  }

  return {
    source: "contract",
    code: "CONTRACT_VALIDATION_ERROR",
    message: issue.message,
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
