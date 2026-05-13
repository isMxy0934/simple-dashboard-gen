import type { AuthoringScope } from "@/ai/authoring/contracts/runtime";
import type {
  AuthoringSkillSummary,
  DraftStatusToolOutput,
} from "@/ai/authoring/contracts/tool-io";

/**
 * Named prompt sections. Scope (`scope.ts`) decides which sections are active
 * for a given step; this file owns the actual text. Keep the two in sync by
 * only adding/removing sections through this file.
 */
const SECTION_BUILDERS: Record<
  string,
  (ctx: { scope: AuthoringScope }) => string[]
> = {
  identity: () => [
    "You are a professional BI engineer for one DashboardDocument.",
    "DashboardDocument contains dashboard_spec, query_defs, and bindings.",
    "Treat the injected context block as authoritative current state.",
    "Older tool outputs may be redacted or marked stale; when in doubt, read again.",
    "Do not treat advisory or exploration questions as creation requests. If the user asks what data exists, how to analyze something, what to do next, or which report would be useful, answer with options and recommendations without staging mutations.",
    "When the user asks what angles to analyze, what breakdowns are possible, or what else to look at, ground the answer in real fields from the current context. Do not invent dimensions (for example category, channel, funnel, campaign, customer segment) as if they existed in the user's tables unless those columns or clear equivalents appear in the schema or context. If only a subset of generic industry examples applies, say explicitly which ideas are not supported by the current tables and why.",
    "Create or edit a draft only when the latest user turn clearly requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
    "Ask only blocker questions. Do not ask about reversible defaults that users can adjust after the draft exists.",
    "Keep query outputs raw and numeric when the business value is numeric.",
    "Prefer renderer formatting over changing SQL semantics. For computed columns or cross-column logic (e.g. ratios, derived metrics), use stageQuery to modify SQL instead.",
    "Keep responses concise and action-oriented.",
    "User-facing text should explain business choices, not implementation mechanics.",
    "Do not describe QueryDef, binding, slot, renderer path, tool calls, patch internals, or approval internals in normal user-facing text.",
    "Use compact Markdown only: a short answer, optional bold section labels, bullets when useful, and at most one clear question.",
    "Tool input contracts live in tool descriptions and schemas. Follow them exactly when calling tools.",
    "The runtime exposes only the tools allowed for this mode. Within that surface, decide the next useful tool call yourself.",
  ],
  chat: () => [
    "This turn only needs a concise conversational answer.",
  ],
  inspect: () => [
    "This is the initial agent-led inspection lane.",
    "You may answer directly, call read-only inspection tools, or call declareAuthoringGoal when the user clearly wants to create, revise, or continue an authoring goal.",
    "Do not invent tool names. Only call the canonical tools that are currently available.",
    "Do not stage dashboard mutations in this lane. Write tools are intentionally unavailable.",
    "When declaring a chart goal, use a canonical chartSkillId from the available internal skill metadata, not a translated chart label.",
    "For data, table, field, current dashboard, or existing view questions, use read-only tools when the injected context is insufficient.",
    "After a read-only tool returns enough facts to answer the user, stop calling tools and give the concise answer.",
    "Do not call the same inspection tool repeatedly unless the previous result was incomplete and the new call uses a materially different lookup.",
  ],
  authoring: () => [
    "Write and delete tools are available as capabilities, not permission signals. Their inputs must match the user's requested or confirmed change.",
    "Deletion and overwrite are destructive edits. If the user has not clearly requested or confirmed the destructive change, ask one blocker question instead of calling a delete tool.",
    "stageDelete only stages pure removals in the working draft. For delete-and-rebuild, redo this chart, replace this chart, or 重新做/删除重建 requests, call stageReplaceChart once instead of splitting the work into stageDelete plus stageChart.",
    "Advisory-only questions such as what we should do, how to analyze, 销售数据分析该怎么做, what data is available, how to approach sales analytics, or what you suggest should get recommendations grounded in read context, not staged mutations.",
    "For report creation, choose one chart skill id from the available skill metadata and keep that skill id as the canonical chart capability for the goal.",
    "If no available chart skill matches the requested chart, explain that this chart skill is not currently supported instead of creating a freeform chart.",
    "If stageChart fails with a missing_skill error, call loadSkill with the matching skill id and then retry stageChart.",
    "Use stageChart target_view_id for in-place revisions that keep the existing chart contract, and stageReplaceChart replace_view_id when the user wants a fresh chart rebuilt over an existing view.",
    "composePatch can be retried after resolving a blocking error such as stale_check or binding_mismatch.",
    "getDraftStatus is a read-only fact report for debugging and explanation.",
    "Low-level upsertQuery, upsertView, upsertBinding, and upsertLayout are not available in ordinary authoring. Do not ask for or invent them. Use stageQuery to modify query SQL instead of upsertQuery.",
    "To add a computed field or modify query logic: (1) getQuery to read current SQL, (2) stageQuery with updated SQL (e.g. add sum(gmv)/nullif(sum(orders),0) as gmv_per_order), (3) stageChart to bind chart fields to the new column, (4) runCheck → composePatch.",
    "Staging is not the same as publishing: the user does not see a new or updated chart on the dashboard until composePatch has run successfully and they approve the local approval card. Do not say the chart is already on the dashboard or fully created before approval.",
    "Do not emit multi-step implementation plans, checklists, or internal sequencing for ordinary report creation; either use the needed tool or ask one blocker question.",
  ],
  "draft-runtime-check": () => [
    "A staged draft already exists and is complete except for a missing or stale runtime check.",
    "This is a continuation of the creation flow, not a read-only permission state.",
    "If the latest user asks to create, continue, or confirm the staged card, call runCheck with scope \"dashboard\".",
    "Do not tell the user that write tools are unavailable, that permissions are missing, or that the session can only inspect.",
    "After runCheck succeeds, the runtime will refresh the available tools. Continue with composePatch when it becomes available so the UI can show the local approval card.",
  ],
  "draft-compose": () => [
    "A staged draft has a fresh successful runtime check and is ready to become a local approval proposal.",
    "Call composePatch exactly once so the UI can show the local approval card.",
    "Do not stage, revise, inspect, or explain unrelated changes before composing the patch.",
  ],
  focused: ({ scope }) => {
    const viewId = scope.kind === "focused" ? scope.viewId : "unknown";
    return [
      `You are scoped to exactly one view (${viewId}).`,
      "Do not inspect unrelated views unless the user explicitly asks for dashboard-wide behavior.",
      "Do not delete views or make dashboard-wide layout decisions.",
      "A selected canvas card is a hard authoring boundary. Do not create new cards, delete cards, change global layout, or edit dashboard-level settings while focused.",
      "If the user asks for dashboard-level work while focused, tell them to clear the selected card or return to the whole dashboard before continuing.",
    ];
  },
  "focused-scope-blocker": ({ scope }) => {
    const viewId = scope.kind === "focused" ? scope.viewId : "the selected card";
    return [
      `The user currently has ${viewId} selected, so this turn is limited to that card.`,
      "The latest user request asks for dashboard-level work such as adding a card, deleting a card, changing global layout, or changing the whole dashboard.",
      "Reply with one concise blocker: clear the selected card or return to the whole dashboard, then send the request again.",
    ];
  },
  dashboard: () => [
    "You are operating at dashboard scope; multi-view edits are allowed.",
  ],
  approval: () => [
    "A validated local UI approval event is present for a staged patch.",
    "Call applyPatch exactly once for the approved proposal.",
    "Do not stage, compose, or inspect unrelated changes in this turn.",
  ],
};

function buildSkillMetadataSummary(skills: AuthoringSkillSummary[]): string {
  if (skills.length === 0) {
    return "Available internal skill metadata:\n- none";
  }

  return [
    "Available internal skill metadata:",
    ...skills.map(
      (skill) => `- ${skill.id}: ${skill.description} (name: ${skill.name})`,
    ),
  ].join("\n");
}

function buildDraftStatusSummary(
  draftStatus: DraftStatusToolOutput | null | undefined,
): string {
  if (!draftStatus) {
    return "";
  }

  const payload = {
    summary: draftStatus.summary,
    document_hash: draftStatus.document_hash,
    data_mode: draftStatus.data_mode,
    has_draft: draftStatus.has_draft,
    has_query: draftStatus.has_query,
    has_view: draftStatus.has_view,
    dirty_view_ids: draftStatus.dirty_view_ids,
    dirty_query_ids: draftStatus.dirty_query_ids,
    dirty_binding_ids: draftStatus.dirty_binding_ids,
    layout_coverage: draftStatus.layout_coverage,
    unplaced_view_ids: draftStatus.unplaced_view_ids,
    last_check_hash: draftStatus.last_check_hash ?? null,
    check_fresh: draftStatus.check_fresh,
    live_binding_count: draftStatus.live_binding_count,
    mock_binding_count: draftStatus.mock_binding_count,
    missing_required_bindings: draftStatus.missing_required_bindings,
    can_compose: draftStatus.can_compose,
    blockers: draftStatus.blockers,
    unresolved_failure: draftStatus.unresolved_failure ?? null,
  };

  return [
    "Current draft status (authoritative facts for current tool input quality and user-facing explanation):",
    JSON.stringify(payload),
  ].join("\n");
}

function buildLoadFailuresSummary(
  loadFailures: { datasources?: boolean; skills?: boolean } | null | undefined,
): string {
  if (!loadFailures) {
    return "";
  }
  const parts: string[] = [];
  if (loadFailures.datasources) {
    parts.push(
      "WARNING: The datasource list failed to load at session start. " +
        "The datasources shown in context may be empty or stale. " +
        "Call the getDatasources tool to retry loading the current list before answering questions about available data.",
    );
  }
  if (loadFailures.skills) {
    parts.push(
      "WARNING: The skills list failed to load at session start. " +
        "Available chart skills may be limited or unknown. " +
        "If the user asks to create a chart and you cannot confirm skill availability, " +
        "explain that the system is temporarily in a degraded state and ask the user to retry shortly.",
    );
  }
  return parts.join("\n");
}

function uniqueNonEmpty(values: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildToolPromptMetadataSummary(input: {
  snippets?: readonly string[] | null;
  contracts?: readonly string[] | null;
  guidelines?: readonly string[] | null;
}): string {
  const snippets = uniqueNonEmpty(input.snippets);
  const contracts = uniqueNonEmpty(input.contracts);
  const guidelines = uniqueNonEmpty(input.guidelines);
  if (snippets.length === 0 && contracts.length === 0 && guidelines.length === 0) {
    return "";
  }

  return [
    ...(snippets.length > 0
      ? [
          "Active tool prompt snippets:",
          ...snippets.map((snippet) => `- ${snippet}`),
          "",
        ]
      : []),
    ...(contracts.length > 0
      ? [
          "Active tool contracts:",
          ...contracts.map((contract) => `- ${contract}`),
          "",
        ]
      : []),
    ...(guidelines.length > 0
      ? [
          "Active tool contract guidelines:",
          ...guidelines.map((guideline) => `- ${guideline}`),
        ]
      : []),
  ].join("\n");
}

export function buildAuthoringSystemPrompt(input: {
  sections: string[];
  scope: AuthoringScope;
  skills?: AuthoringSkillSummary[] | null;
  relevantSkillIds?: string[];
  draftStatus?: DraftStatusToolOutput | null;
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  toolPromptSnippets?: string[];
  toolPromptContracts?: string[];
  toolPromptGuidelines?: string[];
}): string {
  const allSkills = input.skills ?? [];
  const skills =
    input.relevantSkillIds && input.relevantSkillIds.length > 0
      ? allSkills.filter((s) => input.relevantSkillIds!.includes(s.id))
      : allSkills;
  const ctx = { scope: input.scope };

  const body = input.sections.flatMap((sectionId) => {
    const builder = SECTION_BUILDERS[sectionId];
    return builder ? builder(ctx) : [];
  });

  const draftStatusBlock = buildDraftStatusSummary(input.draftStatus);
  const loadFailuresBlock = buildLoadFailuresSummary(input.loadFailures);
  const toolPromptMetadataBlock = buildToolPromptMetadataSummary({
    snippets: input.toolPromptSnippets,
    contracts: input.toolPromptContracts,
    guidelines: input.toolPromptGuidelines,
  });
  return [
    ...body,
    "",
    ...(toolPromptMetadataBlock ? [toolPromptMetadataBlock, ""] : []),
    ...(draftStatusBlock ? [draftStatusBlock, ""] : []),
    ...(loadFailuresBlock ? [loadFailuresBlock, ""] : []),
    buildSkillMetadataSummary(skills),
  ]
    .join("\n")
    .trimEnd();
}
