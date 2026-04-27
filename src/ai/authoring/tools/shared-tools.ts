import { tool } from "ai";
import { z } from "zod";
import type {
  Binding,
  DashboardDocument,
  DatasourceContext,
  QueryDef,
} from "@/contracts";
import type {
  DatasourceListItemSummary,
  GetBindingToolInput,
  GetDatasourcesToolInput,
  GetQueryToolInput,
  GetSchemaByDatasourceToolInput,
  GetViewToolInput,
  LoadSkillReferenceToolInput,
  LoadSkillReferenceToolOutput,
  LoadSkillToolInput,
  LoadSkillToolOutput,
  AuthoringSkillSummary,
  QueryDetail,
  ViewCheckSnapshot,
  ViewDetail,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildBindingDetail,
} from "@/ai/authoring/contracts/tool-io";

export function buildLoadSkillTool(input: {
  skillCatalog: Map<string, AuthoringSkillSummary>;
  loadSkill?: (skillId: string) => Promise<LoadSkillToolOutput | null>;
}) {
  return tool({
    description:
      "Load one internal skill by exact id so the agent can follow its specialized authoring instructions. This is a preparatory read tool, not a final action. For a concrete creation request, continue with the matching skill reference and write tools in the same turn, or explain the real blocker.",
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

      return {
        skill_id: skill.skill_id,
        skill_directory: skill.skill_directory,
        content: skill.content,
      };
    },
  });
}

export function buildLoadSkillReferenceTool(input: {
  skillCatalog: Map<string, AuthoringSkillSummary>;
  loadSkillReference?: (
    skillId: string,
    referenceName: string,
  ) => Promise<LoadSkillReferenceToolOutput | null>;
  onLoaded?: (reference: LoadSkillReferenceToolOutput) => void;
}) {
  return tool({
    description:
      "Load one reference file from an already known internal skill for variant-specific instructions. This is a preparatory read tool, not a final action. For a concrete creation request, continue with upsertQuery, upsertView, and upsertBinding in the same turn, or explain the real blocker.",
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
      if (input.skillCatalog.size > 0 && !input.skillCatalog.has(skillId)) {
        throw new Error(
          `Skill "${skillId}" is not available. Use one of: ${[...input.skillCatalog.keys()].join(", ")}.`,
        );
      }

      const reference = await input.loadSkillReference?.(
        skillId,
        reference_name.trim(),
      );
      if (!reference) {
        throw new Error(
          `Reference "${reference_name}" is unavailable for skill "${skillId}".`,
        );
      }

      const output = {
        skill_id: reference.skill_id,
        reference_name: reference.reference_name,
        reference_path: reference.reference_path,
        content: reference.content,
        ...(reference.check !== undefined ? { check: reference.check } : {}),
      };
      input.onLoaded?.(reference);
      return output;
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

export function buildGetSchemaByDatasourceTool(input: {
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
}) {
  return tool({
    description: "Get the full schema, fields, and metrics for one datasource.",
    inputSchema: z.object({
      datasource_id: z.string().min(1),
      reason: z.string().optional(),
    }),
    execute: async (toolInput: GetSchemaByDatasourceToolInput) =>
      input.getDatasourceSchema(toolInput.datasource_id),
  });
}

export function buildDeleteBindingTool<TWorkingDraft extends {
  bindings?: Binding[];
  dirtyBindingIds: Set<string>;
}>(input: {
  dashboard: DashboardDocument;
  workingDraft: TWorkingDraft;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: TWorkingDraft,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
  cloneBinding: (binding: Binding) => Binding;
  removeBindingFromDocument: (
    document: DashboardDocument,
    bindingId: string,
  ) => DashboardDocument;
  markWorkingDraftUpdated: () => void;
  onBeforeDelete?: (binding: Binding, document: DashboardDocument) => void;
  onAfterDelete?: (binding: Binding, document: DashboardDocument) => void;
}) {
  return tool({
    description: "Remove one binding from the staged dashboard draft.",
    inputSchema: z.object({
      reason: z.string().optional(),
      binding_id: z.string().min(1),
    }),
    execute: async ({ binding_id }) => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const binding = document.bindings.find((candidate) => candidate.id === binding_id);
      if (!binding) {
        throw new Error(`Binding "${binding_id}" was not found.`);
      }

      input.onBeforeDelete?.(binding, document);

      const nextCandidate = input.removeBindingFromDocument(document, binding.id);
      if (
        input.buildDocumentFingerprint(document) ===
        input.buildDocumentFingerprint(nextCandidate)
      ) {
        throw new Error(`No binding removal was staged for "${binding.id}".`);
      }

      input.workingDraft.bindings = nextCandidate.bindings.map(input.cloneBinding);
      input.workingDraft.dirtyBindingIds.add(binding.id);
      input.markWorkingDraftUpdated();
      input.onAfterDelete?.(binding, nextCandidate);

      return {
        summary: `Removed binding "${binding.id}" for view "${binding.view_id}".`,
        binding_id: binding.id,
        view_id: binding.view_id,
      };
    },
  });
}
