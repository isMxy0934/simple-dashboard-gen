export const UPSERT_QUERY_TOOL_CONTRACT = [
  "Stage one explicit canonical QueryDef exactly as provided.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the latest user turn requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
  "Do not stage exploratory queries just to answer what analysis is possible; answer in text or use read-only tools instead.",
  "Staging a query is not a user-visible completed report. Query input must be complete and consistent with the active goal's data mode.",
  "Input shape must be { reason?, query } only.",
  "The active chart skill body is the operation manual for query shape and output conventions.",
  "query must include id, name, datasource_id, sql_template, params, and query.output.",
  "Never send query_spec, sql, parameters, top-level output, output.kind=table, or output.fields.",
  "Use query.output.kind=rows with schema for table, detail, trend, category, and multi-column SQL results.",
  "Use query.output.kind=scalar with value_type for one KPI value.",
].join(" ");

export const UPSERT_VIEW_TOOL_CONTRACT = [
  "Stage a single canonical DashboardView and optional grid layout into the draft dashboard spec.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the latest user turn requests a concrete dashboard output, asks to create/build/generate/add a report, or confirms a specific report you just recommended.",
  "Staging a view is not a user-visible completed report. View input must describe only the visible chart semantics and renderer template.",
  "Input shape must be { request, view_spec, layout? } only.",
  "The active loaded chart skill owns the requested chartSkillId and renderer guidance.",
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
  "Staging a binding is not a user-visible completed report. Binding input must cover the requested renderer slots for the active data mode.",
  "Input shape must be { reason?, binding } only.",
  "The active chart skill body describes the binding shape for the requested chart.",
  "Live bindings must include id, view_id, slot_id, mode, query_id, and param_mapping.",
  "Mock bindings must include id, view_id, slot_id, mode: \"mock\", and explicit mock_data or mock_value.",
  "Every required renderer slot must be covered by a binding; mock and live differ only by data source.",
  "Use param_mapping: {} when the query has no params.",
  "Only use result_selector for rows output selectors: rows, rows[0], rows[].field, or rows[0].field.",
  "For scalar, array, or object query outputs, leave result_selector null or omit it.",
].join(" ");

export const UPSERT_LAYOUT_TOOL_CONTRACT = [
  "Stage canonical desktop and mobile layout items for one existing view.",
  "This is a write tool for an active dashboard creation/edit. Do not call it for discovery, advisory, planning, or 'how should we analyze this' questions.",
  "Call it only after the view exists in the working draft or saved dashboard and the draft needs layout coverage.",
  "Input shape must be { reason?, goal_id?, view_id, layout: { desktop, mobile } } only.",
  "desktop and mobile must both include x, y, w, and h grid units.",
  "upsertLayout only changes layout. Do not include renderer, title, query, or binding changes.",
].join(" ");

export function getWriteToolContract(toolName: string): string | null {
  switch (toolName) {
    case "upsertQuery":
      return UPSERT_QUERY_TOOL_CONTRACT;
    case "upsertView":
      return UPSERT_VIEW_TOOL_CONTRACT;
    case "upsertBinding":
      return UPSERT_BINDING_TOOL_CONTRACT;
    case "upsertLayout":
      return UPSERT_LAYOUT_TOOL_CONTRACT;
    default:
      return null;
  }
}
