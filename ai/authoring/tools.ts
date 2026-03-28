import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  Binding,
  BindingResult,
  DashboardDocument,
  DatasourceContext,
  PreviewRequest,
  QueryDef,
} from "../../contracts";
import {
  validateDashboardDocument,
  type ValidationIssue,
} from "../../contracts/validation";
import type {
  AgentDraftOutput,
  ApplyPatchToolOutput,
  DraftBindingsToolInput,
  DraftBindingsToolOutput,
  DraftQueryDefsToolInput,
  DraftQueryDefsToolOutput,
  DraftViewsToolInput,
  DraftViewsToolOutput,
  AuthoringAgentMessage,
  RuntimeCheckSummary,
} from "../runtime/agent-contract";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
} from "../runtime/message-inspection";
import {
  buildBindingsForViews,
  buildMockBindingsForViews,
  buildPatchFromDocument,
  buildQueryDefsForViews,
  generateLayoutSuggestion,
  shouldGenerateMockBindings,
} from "./ai-assist";
import { cloneDashboardDocument } from "../../domain/dashboard/document";
import {
  summarizeContractState,
  summarizeDatasourceContext,
} from "./state";
import type { DashboardAiDependencies } from "../runtime/dependencies";

const PREVIEW_FILTER_VALUES = {
  f_time_range: "last_12_weeks",
  f_region: "all",
} as const;

const RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

const layoutChartTypeSchema = z.enum(["line", "bar", "pie", "metric"]);
const layoutViewSizeSchema = z.enum(["small", "medium", "large", "full"]);
const layoutItemSchema = z.object({
  view_id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

const draftViewsInputSchema = z.object({
  request: z.string().min(1),
  include_filters: z.boolean().optional(),
  replace_existing_views: z.boolean().optional(),
  view_specs: z
    .array(
      z.object({
        view_id: z.string().min(1).optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        chart_type: layoutChartTypeSchema,
        x_field: z.string().optional(),
        y_field: z.string().optional(),
        item_name_field: z.string().optional(),
        value_field: z.string().optional(),
        size: layoutViewSizeSchema.optional(),
        smooth: z.boolean().optional(),
      }),
    )
    .min(1),
  layout: z
    .object({
      desktop: z
        .object({
          cols: z.number().int().min(1).optional(),
          row_height: z.number().int().min(1).optional(),
          items: z.array(layoutItemSchema),
        })
        .optional(),
      mobile: z
        .object({
          cols: z.number().int().min(1).optional(),
          row_height: z.number().int().min(1).optional(),
          items: z.array(layoutItemSchema),
        })
        .optional(),
    })
    .optional(),
});

const draftQueryDefsInputSchema = z.object({
  request: z.string().min(1),
  view_ids: z.array(z.string().min(1)).optional(),
});

const draftBindingsInputSchema = z.object({
  request: z.string().min(1),
  view_ids: z.array(z.string().min(1)).optional(),
  query_ids: z.array(z.string().min(1)).optional(),
  binding_mode: z.enum(["mock", "live"]).optional(),
});

interface WorkingDraftState {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
}

export function buildDashboardAgentTools(input: {
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages?: AuthoringAgentMessage[];
  dependencies?: DashboardAiDependencies;
}) {
  const workingDraft: WorkingDraftState = {};

  return {
    inspectContractState: tool({
      description:
        "Inspect the current dashboard contract state and summarize what exists, what is missing, and what the next step should be.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async () => summarizeContractState(input.dashboard),
    }),
    inspectDatasourceContext: tool({
      description:
        "Inspect the datasource snapshot that the dashboard agent can use for query and binding generation.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async () => summarizeDatasourceContext(input.datasourceContext),
    }),
    draftViews: tool({
      description:
        "Draft the dashboard views and layout from explicit view specs. This prepares staged dashboard_spec changes only and does not apply them.",
      inputSchema: draftViewsInputSchema,
      execute: async (toolInput): Promise<DraftViewsToolOutput> => {
        const suggestion = await generateLayoutSuggestion({
          ...(toolInput as DraftViewsToolInput),
          currentDocument: input.dashboard,
        });
        if (!suggestion.dashboard) {
          throw new Error("Layout draft is missing its dashboard document.");
        }
        const nextSpec = cloneDashboardDocument(suggestion.dashboard).dashboard_spec;
        const viewIds = nextSpec.views.map((view) => view.id);

        workingDraft.dashboardSpec = nextSpec;

        return {
          summary: `Drafted ${viewIds.length} view${viewIds.length === 1 ? "" : "s"} for the next patch.`,
          dashboard_name: nextSpec.dashboard.name,
          view_count: viewIds.length,
          view_ids: viewIds,
          next_step:
            input.datasourceContext || hasCurrentLiveData(input.dashboard)
              ? "draftQueryDefs"
              : "composePatch",
        };
      },
    }),
    draftQueryDefs: tool({
      description:
        "Draft query definitions for the active dashboard views using the datasource snapshot. This stages query_defs only.",
      inputSchema: draftQueryDefsInputSchema,
      execute: async ({
        view_ids,
      }: DraftQueryDefsToolInput): Promise<DraftQueryDefsToolOutput> => {
        if (!input.datasourceContext) {
          throw new Error("DatasourceContext is unavailable for query drafting.");
        }

        const activeViews = selectActiveViews({
          dashboard: input.dashboard,
          dashboardSpec: workingDraft.dashboardSpec,
          requestedViewIds: view_ids,
        });
        const queryDefs = buildQueryDefsForViews(activeViews, input.datasourceContext);

        workingDraft.queryDefs = queryDefs;

        return {
          summary: `Drafted ${queryDefs.length} query definition${queryDefs.length === 1 ? "" : "s"} from the datasource snapshot.`,
          query_count: queryDefs.length,
          query_ids: queryDefs.map((query) => query.id),
          next_step: "draftBindings",
        };
      },
    }),
    draftBindings: tool({
      description:
        "Draft bindings for the active dashboard views. Use mock mode for sample/demo data and live mode when query definitions are ready.",
      inputSchema: draftBindingsInputSchema,
      execute: async ({
        request,
        view_ids,
        query_ids,
        binding_mode,
      }: DraftBindingsToolInput): Promise<DraftBindingsToolOutput> => {
        const activeViews = selectActiveViews({
          dashboard: input.dashboard,
          dashboardSpec: workingDraft.dashboardSpec,
          requestedViewIds: view_ids,
        });
        const mode =
          binding_mode ?? (shouldGenerateMockBindings(request) ? "mock" : "live");
        const queryDefs =
          mode === "live"
            ? selectActiveQueryDefs({
                dashboard: input.dashboard,
                stagedQueryDefs: workingDraft.queryDefs,
                requestedQueryIds: query_ids,
              })
            : [];

        if (mode === "live" && queryDefs.length === 0) {
          throw new Error(
            "Live bindings require staged query definitions. Call draftQueryDefs first.",
          );
        }

        const bindings =
          mode === "mock"
            ? buildMockBindingsForViews(activeViews)
            : buildBindingsForViews(activeViews, queryDefs);

        workingDraft.bindings = bindings;
        workingDraft.bindingMode = mode;

        return {
          summary: `Drafted ${bindings.length} ${mode} binding${bindings.length === 1 ? "" : "s"} for the active views.`,
          binding_count: bindings.length,
          binding_ids: bindings.map((binding) => binding.id),
          binding_mode: mode,
          next_step: "composePatch",
        };
      },
    }),
    composePatch: tool({
      description:
        "Compose the currently staged views, query definitions, and bindings into a single dashboard patch proposal that can be reviewed and applied.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (): Promise<AgentDraftOutput> => {
        const includesDataDraft = !!workingDraft.queryDefs || !!workingDraft.bindings;
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = includesDataDraft
          ? await stabilizeCandidateDocument({
              dashboard: buildCandidateDocument(input.dashboard, workingDraft),
              datasourceContext: input.datasourceContext,
              preferredBindingMode: workingDraft.bindingMode,
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
            title:
              kind === "layout"
                ? "AI Layout Patch"
                : "AI Dashboard Patch",
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
            summary: "This patch changes the dashboard contract and requires approval before apply.",
            operation_count: patch.operations.length,
            affected_paths: patch.operations
              .slice(0, 8)
              .map((operation) => operation.path),
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
        "Request approval to apply the staged composePatch proposal to the local dashboard draft. Call this immediately after composePatch when the patch is ready for user approval.",
      inputSchema: z.object({
        suggestion_id: z.string().min(1).optional(),
      }),
      needsApproval: true,
      execute: async ({
        suggestion_id,
      }: {
        suggestion_id?: string;
      }): Promise<ApplyPatchToolOutput> => {
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
    runRuntimeCheck: tool({
      description:
        "Run a runtime check on the staged candidate dashboard if one exists, otherwise on the current dashboard contract.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async () =>
        runRuntimeCheckForDocument(
          buildCandidateDocument(input.dashboard, workingDraft),
          input.dependencies,
        ),
    }),
  } satisfies ToolSet;
}

function buildCandidateDocument(
  dashboard: DashboardDocument,
  workingDraft: WorkingDraftState,
): DashboardDocument {
  const nextDocument = cloneDashboardDocument(dashboard);

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

  return nextDocument;
}

function selectActiveViews(input: {
  dashboard: DashboardDocument;
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  requestedViewIds?: string[];
}) {
  const views = input.dashboardSpec?.views ?? input.dashboard.dashboard_spec.views;
  const requestedIds = new Set(input.requestedViewIds ?? []);

  if (requestedIds.size === 0) {
    return views;
  }

  const filteredViews = views.filter((view) => requestedIds.has(view.id));
  if (filteredViews.length === 0) {
    throw new Error("No matching views were available for the requested view ids.");
  }

  return filteredViews;
}

function selectActiveQueryDefs(input: {
  dashboard: DashboardDocument;
  stagedQueryDefs?: QueryDef[];
  requestedQueryIds?: string[];
}) {
  const queryDefs = input.stagedQueryDefs ?? input.dashboard.query_defs;
  const requestedIds = new Set(input.requestedQueryIds ?? []);

  if (requestedIds.size === 0) {
    return queryDefs;
  }

  const filteredQueries = queryDefs.filter((query) => requestedIds.has(query.id));
  if (filteredQueries.length === 0) {
    throw new Error("No matching query definitions were available for the requested query ids.");
  }

  return filteredQueries;
}

function hasCurrentLiveData(dashboard: DashboardDocument) {
  return dashboard.query_defs.length > 0 || dashboard.bindings.length > 0;
}

function buildPatchDetails(input: {
  dashboard: DashboardDocument;
  bindingMode?: "mock" | "live";
  runtimeCheck?: RuntimeCheckSummary;
  repair: AgentDraftOutput["repair"];
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
  dependencies?: DashboardAiDependencies;
}): Promise<{
  dashboard: DashboardDocument;
  runtimeCheck?: RuntimeCheckSummary;
  repair: AgentDraftOutput["repair"];
}> {
  let document = cloneDashboardDocument(input.dashboard);
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
      document = repaired.dashboard;
      notes.push(repaired.note);
      continue;
    }

    const runtimeCheck = await runRuntimeCheckForDocument(
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
    document = repaired.dashboard;
    notes.push(repaired.note);
  }

  const finalRuntimeCheck = await runRuntimeCheckForDocument(
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
  runtimeErrors?: RuntimeCheckSummary["errors"];
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
): RuntimeCheckSummary {
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

async function runRuntimeCheckForDocument(
  document: DashboardDocument,
  dependencies?: DashboardAiDependencies,
): Promise<RuntimeCheckSummary> {
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
    visible_view_ids: collectVisibleViewIds(document),
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

  const results: BindingResult[] = Object.values(
    outcome.body.data.binding_results,
  );
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

  const status =
    counts.error > 0 ? "error" : counts.empty > 0 ? "warning" : "ok";
  const reason =
    status === "error"
      ? `${counts.error} binding checks failed.`
      : status === "warning"
        ? `${counts.ok} bindings passed and ${counts.empty} returned empty rows.`
        : `${counts.ok} bindings passed runtime check.`;

  return {
    status,
    reason,
    counts,
    errors,
  };
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
