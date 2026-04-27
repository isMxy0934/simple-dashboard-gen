export const UPSERT_QUERY_TOOL_CONTRACT = [
  "Stage one explicit canonical QueryDef exactly as provided.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the latest user turn requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
  "Do not stage exploratory queries just to answer what analysis is possible; answer in text or use read-only tools instead.",
  "Staging a query is not a user-visible completed report. Continue with upsertView and upsertBinding; once the draft is complete, call composePatch and then applyPatch.",
  "Input shape must be { reason?, skill_reference?, query } only.",
  "skill_reference must be an exact loaded data-format skill reference key when creating data-backed views.",
  "query must include id, name, datasource_id, sql_template, params, and query.output.",
  "Never send query_spec, sql, parameters, top-level output, output.kind=table, or output.fields.",
  "Use query.output.kind=rows with schema for table, detail, trend, category, and multi-column SQL results.",
  "Use query.output.kind=scalar with value_type for one KPI value.",
].join(" ");

export const UPSERT_VIEW_TOOL_CONTRACT = [
  "Stage a single canonical DashboardView and optional grid layout into the draft dashboard spec.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the latest user turn requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
  "Staging a view is not a user-visible completed report. Continue with upsertQuery and upsertBinding; once the draft is complete, call composePatch and then applyPatch.",
  "Input shape must be { request, skill_reference?, view_spec, layout? } only.",
  "skill_reference must be an exact loaded ECharts skill reference key for the requested chart type.",
  "view_spec must include title and renderer.",
  "view_spec.renderer.kind must be echarts.",
  "view_spec.renderer.option_template is required.",
  "Every renderer slot path must point to an existing node inside option_template.",
  "Use grid layout units, not pixels.",
].join(" ");

export const UPSERT_BINDING_TOOL_CONTRACT = [
  "Stage one explicit canonical Binding exactly as provided.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the latest user turn requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
  "Staging a binding is not a user-visible completed report. When every required view slot is bound, call composePatch and then applyPatch.",
  "Input shape must be { reason?, skill_reference?, binding } only.",
  "skill_reference must be an exact loaded data-format skill reference key when binding query-backed views.",
  "Live bindings must include id, view_id, slot_id, mode, query_id, and param_mapping.",
  "Use param_mapping: {} when the query has no params.",
  "Only use result_selector for rows output selectors: rows, rows[0], rows[].field, or rows[0].field.",
  "For scalar, array, or object query outputs, leave result_selector null or omit it.",
].join(" ");

export function getWriteToolContract(toolName: string): string | null {
  switch (toolName) {
    case "upsertQuery":
      return UPSERT_QUERY_TOOL_CONTRACT;
    case "upsertView":
      return UPSERT_VIEW_TOOL_CONTRACT;
    case "upsertBinding":
      return UPSERT_BINDING_TOOL_CONTRACT;
    default:
      return null;
  }
}
