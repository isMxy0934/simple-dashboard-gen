import { z } from "zod";
import type {
  DashboardDocument,
  DatasourceContext,
  PreviewRequest,
  QueryDef,
} from "@/contracts";
import type {
  DatasourceListItemSummary,
  GetBindingToolInput,
  GetDatasourcesToolInput,
  GetQueryToolInput,
  GetTableSchemaToolInput,
  GetViewToolInput,
  ListDatasourceTablesToolInput,
  LoadSkillToolInput,
  LoadSkillToolOutput,
  AuthoringSkillSummary,
  PreviewTableDataToolInput,
  PreviewTableDataToolOutput,
  QueryDetail,
  ViewCheckSnapshot,
  ViewDetail,
} from "@/ai/authoring/contracts/tool-io";
import { tool } from "@/ai/authoring/tools/definition";
import {
  buildBindingDetail,
} from "@/ai/authoring/contracts/tool-io";
import type { AiPreviewExecutionResult } from "@/ai/authoring/runtime/dependencies";
import {
  buildMissingFieldMessage,
  buildMissingTableMessage,
  buildTableSchemaOutput,
  findDatasourceField,
  findDatasourceTable,
  listTableSummaries,
  quoteQualifiedSqlName,
  quoteSqlIdentifier,
  shortName,
  standardQueryType,
} from "@/ai/authoring/tools/datasource-schema-utils";

export function buildLoadSkillTool(input: {
  skillCatalog: Map<string, AuthoringSkillSummary>;
  loadSkill?: (skillId: string) => Promise<LoadSkillToolOutput | null>;
  onLoaded?: (skill: LoadSkillToolOutput) => void;
}) {
  return tool({
    description:
      "Load one internal skill by exact id so the agent can use its specialized authoring instructions as context for the current runtime-selected step.",
    inputSchema: z.object({
      name: z.string().min(1),
      reason: z.string().optional(),
    }),
    execute: async ({ name }: LoadSkillToolInput): Promise<LoadSkillToolOutput> => {
      const skillName = name.trim();
      if (input.skillCatalog.size > 0 && !input.skillCatalog.has(skillName)) {
        throw new Error(
          `Skill "${skillName}" is not available. Use one of: ${[...input.skillCatalog.keys()].join(", ")}.`,
        );
      }

      const skill = await input.loadSkill?.(skillName);
      if (!skill) {
        throw new Error(`Skill "${skillName}" is unavailable.`);
      }
      input.onLoaded?.(skill);

      return {
        skill_id: skill.skill_id,
        skill_directory: skill.skill_directory,
        content: skill.content,
      };
    },
  });
}

export function buildGetDatasourcesTool(input: {
  getDatasourceList: () => Promise<DatasourceListItemSummary[]>;
}) {
  return tool({
    description: "Get the list of available datasources for report authoring.",
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
    execute: async (_toolInput: GetDatasourcesToolInput) => {
      const datasources = await input.getDatasourceList();
      return {
        datasource_count: datasources.length,
        datasources,
      };
    },
  });
}

export function buildGetViewTool<TWorkingDraft>(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  checks?: ViewCheckSnapshot[] | null;
  workingDraft: TWorkingDraft;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: TWorkingDraft,
  ) => DashboardDocument;
  buildViewSummary: (args: {
    document: DashboardDocument;
    dashboardId?: string | null;
    checks?: ViewCheckSnapshot[] | null;
  }) => { views: Array<{ id: string; title: string }> };
  buildViewDetail: (args: {
    document: DashboardDocument;
    view: DashboardDocument["dashboard_spec"]["views"][number];
    latestCheck?: ViewCheckSnapshot | null;
  }) => ViewDetail;
  findCheckSnapshot: (
    checks: ViewCheckSnapshot[] | null | undefined,
    viewId: string,
  ) => ViewCheckSnapshot | null;
  onBeforeResolve?: (requestedViewId?: string, requestedTitle?: string) => void;
}) {
  return tool({
    description:
      "Get full details for a specific view by id or by title. If title matches multiple views, return candidates instead of guessing.",
    inputSchema: z.object({
      view_id: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    }),
    execute: async (toolInput: GetViewToolInput) => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const requestedViewId = toolInput.view_id?.trim();
      const requestedTitle = toolInput.title?.trim();
      input.onBeforeResolve?.(requestedViewId, requestedTitle);
      const viewSummary = input.buildViewSummary({
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
          view: input.buildViewDetail({
            document,
            view: exactView,
            latestCheck: input.findCheckSnapshot(input.checks, exactView.id),
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
          view: input.buildViewDetail({
            document,
            view,
            latestCheck: input.findCheckSnapshot(input.checks, view.id),
          }),
        };
      }

      return {
        match_status: matches.length > 1 ? ("ambiguous" as const) : ("missing" as const),
        matches,
      };
    },
  });
}

export function buildGetQueryTool<TWorkingDraft>(input: {
  dashboard: DashboardDocument;
  workingDraft: TWorkingDraft;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: TWorkingDraft,
  ) => DashboardDocument;
  buildQueryDetail: (document: DashboardDocument, query: QueryDef) => QueryDetail;
  onAfterResolve?: (query: QueryDef, document: DashboardDocument) => void;
}) {
  return tool({
    description: "Get SQL, params, output, and usage information for one query.",
    inputSchema: z.object({
      query_id: z.string().min(1),
    }),
    execute: async ({ query_id }: GetQueryToolInput): Promise<QueryDetail> => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const query = document.query_defs.find((candidate) => candidate.id === query_id);

      if (!query) {
        throw new Error(`Query "${query_id}" was not found.`);
      }

      input.onAfterResolve?.(query, document);

      return input.buildQueryDetail(document, query);
    },
  });
}

export function buildGetBindingTool<TWorkingDraft>(input: {
  dashboard: DashboardDocument;
  workingDraft: TWorkingDraft;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: TWorkingDraft,
  ) => DashboardDocument;
  onBeforeResolve?: (viewId: string) => void;
}) {
  return tool({
    description: "Get binding details for one view, optionally narrowed to one slot.",
    inputSchema: z.object({
      view_id: z.string().min(1),
      slot_id: z.string().min(1).optional(),
    }),
    execute: async ({ view_id, slot_id }: GetBindingToolInput) => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      input.onBeforeResolve?.(view_id);
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
  });
}

export function buildListDatasourceTablesTool(input: {
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
}) {
  return tool({
    description:
      "List tables available in one datasource. Returns table-level metadata only; call getTableSchema for field names and types.",
    inputSchema: z.object({
      datasource_id: z.string().min(1),
      reason: z.string().optional(),
    }),
    execute: async (toolInput: ListDatasourceTablesToolInput) => {
      const schema = await input.getDatasourceSchema(toolInput.datasource_id);
      return {
        datasource_id: schema.datasource_id,
        dialect: schema.dialect,
        table_count: schema.tables.length,
        tables: listTableSummaries(schema),
      };
    },
  });
}

export function buildGetTableSchemaTool(input: {
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
}) {
  return tool({
    description:
      "Get field-level schema metadata for one datasource table, including field names, types, comments, semantic hints, and aggregate support.",
    inputSchema: z.object({
      datasource_id: z.string().min(1),
      table: z.string().min(1),
      reason: z.string().optional(),
    }),
    execute: async (toolInput: GetTableSchemaToolInput) => {
      const schema = await input.getDatasourceSchema(toolInput.datasource_id);
      const table = findDatasourceTable(schema, toolInput.table);
      if (!table) {
        throw new Error(buildMissingTableMessage(schema, toolInput.table));
      }
      return buildTableSchemaOutput({ schema, table });
    },
  });
}

function buildPreviewQuery(input: {
  datasourceId: string;
  tableName: string;
  fields: Array<{ source: string; alias: string; type: string; nullable: boolean }>;
  limit: number;
}): QueryDef {
  const selectList = input.fields
    .map((field) => `${quoteSqlIdentifier(shortName(field.source))} as ${quoteSqlIdentifier(field.alias)}`)
    .join(", ");
  return {
    id: "__preview_table_data_query",
    name: `Preview ${input.tableName}`,
    datasource_id: input.datasourceId,
    sql_template: `select ${selectList} from ${quoteQualifiedSqlName(input.tableName)} limit ${input.limit}`,
    params: [],
    output: {
      kind: "rows",
      schema: input.fields.map((field) => ({
        name: field.alias,
        type: standardQueryType({ name: field.source, type: field.type }),
        nullable: field.nullable,
      })),
    },
  };
}

function buildPreviewRequest(query: QueryDef): PreviewRequest {
  return {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: { name: "Preview Table Data" },
      filters: [],
      layout: {},
      views: [
        {
          id: "__preview_table_data_view",
          title: "Preview Table Data",
          renderer: {
            kind: "echarts",
            option_template: { data: [] },
            slots: [{ id: "rows", path: "data", value_kind: "rows", required: true }],
          },
        },
      ],
    },
    query_defs: [query],
    bindings: [
      {
        id: "__preview_table_data_binding",
        view_id: "__preview_table_data_view",
        slot_id: "rows",
        mode: "live",
        query_id: query.id,
        param_mapping: {},
        result_selector: "rows",
      },
    ],
    visible_view_ids: ["__preview_table_data_view"],
  };
}

function extractPreviewRows(result: AiPreviewExecutionResult): Record<string, unknown>[] {
  const binding = result.body.data?.binding_results.__preview_table_data_binding;
  if (!binding || binding.status !== "ok") {
    if (binding?.status === "empty") {
      return [];
    }
    throw new Error(
      binding?.status === "error"
        ? binding.message ?? "Preview query failed."
        : result.body.reason || "Preview query failed.",
    );
  }
  return (binding.data.rows ?? []) as Record<string, unknown>[];
}

export function buildPreviewTableDataTool(input: {
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
  executePreview: (request: PreviewRequest) => Promise<AiPreviewExecutionResult>;
}) {
  return tool({
    description:
      "Preview a small number of rows from one datasource table. This is separate from schema metadata and should be used only when field semantics need examples.",
    inputSchema: z.object({
      datasource_id: z.string().min(1),
      table: z.string().min(1),
      columns: z.array(z.string().min(1)).min(1).max(24).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      reason: z.string().optional(),
    }),
    execute: async (toolInput: PreviewTableDataToolInput): Promise<PreviewTableDataToolOutput> => {
      const schema = await input.getDatasourceSchema(toolInput.datasource_id);
      const table = findDatasourceTable(schema, toolInput.table);
      if (!table) {
        throw new Error(buildMissingTableMessage(schema, toolInput.table));
      }
      const requestedColumns = toolInput.columns?.length
        ? toolInput.columns
        : table.fields.slice(0, 12).map((field) => shortName(field.name));
      const fields = requestedColumns.map((column) => {
        const field = findDatasourceField(table, column);
        if (!field) {
          throw new Error(buildMissingFieldMessage(table, column));
        }
        return {
          source: field.name,
          alias: shortName(field.name),
          type: field.type,
          nullable: field.nullable ?? true,
        };
      });
      const query = buildPreviewQuery({
        datasourceId: schema.datasource_id,
        tableName: table.name,
        fields,
        limit: toolInput.limit ?? 10,
      });
      const result = await input.executePreview(buildPreviewRequest(query));
      const rows = extractPreviewRows(result);
      const limit = toolInput.limit ?? 10;
      return {
        datasource_id: schema.datasource_id,
        table: table.name,
        columns: fields.map((field) => field.alias),
        limit,
        row_count: rows.length,
        rows,
      };
    },
  });
}
