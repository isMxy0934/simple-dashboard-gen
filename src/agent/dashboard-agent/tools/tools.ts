import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  Binding,
  BindingResult,
  DashboardDocument,
  DatasourceContext,
  PreviewRequest,
  QueryDef,
  DashboardView,
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
  GetBindingToolInput,
  GetQueryToolInput,
  GetViewToolInput,
  GetViewsToolInput,
  InspectDatasourceToolInput,
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
  generateLayoutSuggestion,
  shouldGenerateMockBindings,
} from "@/agent/dashboard-agent/tools/ai-assist";
import { cloneDashboardDocument } from "@/domain/dashboard/document";
import { reconcileDashboardDocumentContract } from "@/domain/dashboard/document";
import {
  buildViewListSummary,
  summarizeDatasourceContext,
} from "@/agent/dashboard-agent/context";
import type { DashboardAgentDependencies } from "@/agent/dashboard-agent/runtime/dependencies";

const PREVIEW_FILTER_VALUES = {
  f_time_range: "last_12_weeks",
  f_region: "all",
} as const;

const RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

const chartTypeSchema = z.enum(["line", "bar", "pie", "metric"]);
const viewSizeSchema = z.enum(["small", "medium", "large", "full"]);
const layoutItemSchema = z.object({
  view_id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
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
  datasourceContext?: DatasourceContext | null;
  messages?: DashboardAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  dependencies?: DashboardAgentDependencies;
}) {
  const workingDraft: WorkingDraftState = {};

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
    inspectDatasource: tool({
      description:
        "Inspect the datasource summary that can be used for query and binding generation.",
      inputSchema: z.object({
        reason: z.string().optional(),
        table_name: z.string().optional(),
        field_name: z.string().optional(),
        metric_id: z.string().optional(),
      }),
      execute: async (_toolInput: InspectDatasourceToolInput) =>
        summarizeDatasourceContext(input.datasourceContext),
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
        const runtimeCheck = await executePreviewCheckForDocument(
          document,
          input.dependencies,
          visibleViewIds,
        );
        return {
          status: runtimeCheck.status,
          reason: runtimeCheck.reason,
          checks: buildViewCheckSnapshots({
            document,
            runtimeCheck,
            visibleViewIds,
          }),
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
          chart_type: chartTypeSchema,
          x_field: z.string().optional(),
          y_field: z.string().optional(),
          item_name_field: z.string().optional(),
          value_field: z.string().optional(),
          size: viewSizeSchema.optional(),
          smooth: z.boolean().optional(),
        }),
        layout: z
          .object({
            desktop: layoutItemSchema.optional(),
            mobile: layoutItemSchema.optional(),
          })
          .optional(),
      }),
      execute: async (toolInput: UpsertViewToolInput): Promise<UpsertViewToolOutput> => {
        const suggestion = await generateLayoutSuggestion({
          request: toolInput.request,
          include_filters: true,
          replace_existing_views: true,
          view_specs: [toolInput.view_spec],
          layout: toolInput.layout
            ? {
                desktop: toolInput.layout.desktop
                  ? {
                      items: [toolInput.layout.desktop],
                    }
                  : undefined,
                mobile: toolInput.layout.mobile
                  ? {
                      items: [toolInput.layout.mobile],
                    }
                  : undefined,
              }
            : undefined,
          currentDocument: buildCandidateDocument(input.dashboard, workingDraft),
        });

        if (!suggestion.dashboard) {
          throw new Error("View draft is missing its staged dashboard.");
        }

        workingDraft.dashboardSpec = cloneDashboardDocument(suggestion.dashboard).dashboard_spec;
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const viewId =
          toolInput.view_spec.view_id ??
          document.dashboard_spec.views[document.dashboard_spec.views.length - 1]?.id;

        const view = resolveRequiredView(document, viewId);
        return {
          summary: `Staged view "${view.title}".`,
          view: buildViewDetail({
            document,
            view,
            latestCheck: findCheckSnapshot(input.checks, view.id),
          }),
        };
      },
    }),
    upsertQuery: tool({
      description:
        "Stage a live query definition for one view using the datasource summary.",
      inputSchema: z.object({
        request: z.string().min(1),
        view_id: z.string().optional(),
        query_id: z.string().optional(),
      }),
      execute: async (toolInput: UpsertQueryToolInput): Promise<UpsertQueryToolOutput> => {
        if (!input.datasourceContext) {
          throw new Error("Datasource context is unavailable.");
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
          input.datasourceContext,
        )[0];
        const existing = workingDraft.queryDefs ?? document.query_defs;
        workingDraft.queryDefs = upsertById(existing, nextQuery);
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

        workingDraft.bindings = mergeBindingsForView(
          document.bindings,
          nextBindings,
          view.id,
        );
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
              datasourceContext: input.datasourceContext,
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
  return {
    view: input.view,
    layout: {
      desktop:
        input.document.dashboard_spec.layout.desktop?.items.find(
          (item) => item.view_id === input.view.id,
        ) ?? null,
      mobile:
        input.document.dashboard_spec.layout.mobile?.items.find(
          (item) => item.view_id === input.view.id,
        ) ?? null,
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

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const next = [...list];
  const index = next.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    next[index] = item;
    return next;
  }
  next.push(item);
  return next;
}

function mergeBindingsForView(
  currentBindings: Binding[],
  nextBindings: Binding[],
  viewId: string,
) {
  return [
    ...currentBindings.filter((binding) => binding.view_id !== viewId),
    ...nextBindings,
  ];
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
  datasourceContext?: DatasourceContext | null;
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
        datasourceContext: input.datasourceContext,
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

    const runtimeCheck = await executePreviewCheckForDocument(
      document,
      input.dependencies,
    );
    if (runtimeCheck.status !== "error") {
      return {
        dashboard: document,
        runtimeCheck,
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
      datasourceContext: input.datasourceContext,
      runtimeErrors: runtimeCheck.errors,
      preferredBindingMode: input.preferredBindingMode,
    });

    if (!repaired) {
      return {
        dashboard: document,
        runtimeCheck,
        repair: {
          status: "failed",
          attempted,
          max_attempts: 2,
          repaired: false,
          notes: [...notes, runtimeCheck.reason],
        },
      };
    }

    attempted += 1;
    document = reconcileDashboardDocumentContract(repaired.dashboard);
    notes.push(repaired.note);
  }

  const finalRuntimeCheck = await executePreviewCheckForDocument(
    document,
    input.dependencies,
  );
  return {
    dashboard: document,
    runtimeCheck: finalRuntimeCheck,
    repair: {
      status: finalRuntimeCheck.status === "error" ? "failed" : "repaired",
      attempted,
      max_attempts: 2,
      repaired: finalRuntimeCheck.status !== "error",
      notes,
    },
  };
}

function applyDeterministicRepair(input: {
  document: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
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
    input.datasourceContext &&
    (validationPaths.has("query_defs") ||
      runtimeCodes.has("QUERY_EXECUTION_ERROR") ||
      runtimeCodes.has("QUERY_NOT_FOUND") ||
      runtimeCodes.has("RESULT_SCHEMA_MISMATCH"))
  ) {
    const queryDefs = buildQueryDefsForViews(views, input.datasourceContext);
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
): Promise<DashboardAgentCheckSummary> {
  if (!dependencies?.executePreview) {
    return {
      status: "error",
      reason: "Runtime preview capability is unavailable.",
      counts: {
        ok: 0,
        empty: 0,
        error: 0,
      },
      errors: [],
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
      status: "error",
      reason: outcome.body.reason,
      counts: {
        ok: 0,
        empty: 0,
        error: 0,
      },
      errors: [],
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
    status: counts.error > 0 ? "error" : counts.empty > 0 ? "warning" : "ok",
    reason:
      counts.error > 0
        ? `${counts.error} binding checks failed.`
        : counts.empty > 0
          ? `${counts.ok} bindings passed and ${counts.empty} returned empty rows.`
          : `${counts.ok} bindings passed runtime check.`,
    counts,
    errors,
  };
}

function buildViewCheckSnapshots(input: {
  document: DashboardDocument;
  runtimeCheck: DashboardAgentCheckSummary;
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
      const status = viewErrors.length
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
