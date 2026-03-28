export function summarizeAgentToolResult(output: unknown) {
  if (!output || typeof output !== "object") {
    return output;
  }

  const record = output as Record<string, unknown>;
  const suggestion = record.suggestion as Record<string, unknown> | undefined;
  const runtimeCheck = record.runtime_check as Record<string, unknown> | undefined;

  if ("dashboard_name" in record && "next_step" in record) {
    return {
      contract: {
        dashboard_name: record.dashboard_name,
        next_step: record.next_step,
        binding_count: record.binding_count,
        query_ids: record.query_ids,
        views: record.views,
        missing_parts: record.missing_parts,
      },
    };
  }

  if ("datasource_id" in record && "table_count" in record) {
    return {
      datasource: {
        datasource_id: record.datasource_id,
        dialect: record.dialect,
        table_count: record.table_count,
        tables: record.tables,
      },
    };
  }

  if ("counts" in record && "status" in record && "reason" in record) {
    return {
      runtime_check: {
        status: record.status,
        reason: record.reason,
        counts: record.counts,
        errors: record.errors,
      },
    };
  }

  if ("view_count" in record && "view_ids" in record) {
    return {
      draft_views: {
        dashboard_name: record.dashboard_name,
        view_count: record.view_count,
        view_ids: record.view_ids,
        next_step: record.next_step,
      },
    };
  }

  if ("query_count" in record && "query_ids" in record) {
    return {
      draft_query_defs: {
        query_count: record.query_count,
        query_ids: record.query_ids,
        next_step: record.next_step,
      },
    };
  }

  if ("binding_count" in record && "binding_ids" in record) {
    return {
      draft_bindings: {
        binding_count: record.binding_count,
        binding_ids: record.binding_ids,
        binding_mode: record.binding_mode,
        next_step: record.next_step,
      },
    };
  }

  if ("applied" in record && "suggestion_id" in record) {
    return {
      apply_patch: {
        suggestion_id: record.suggestion_id,
        title: record.title,
        summary: record.summary,
        patch_summary: record.patch_summary,
        dashboard: summarizeDashboardDocument(
          record.dashboard as Record<string, unknown> | undefined,
        ),
      },
    };
  }

  return {
    suggestion: suggestion
      ? {
          kind: suggestion.kind,
          title: suggestion.title,
          summary: suggestion.summary,
          patchSummary:
            typeof (suggestion.patch as Record<string, unknown> | undefined)?.summary ===
            "string"
              ? (suggestion.patch as Record<string, unknown>).summary
              : undefined,
          patchOperations:
            Array.isArray(
              (suggestion.patch as Record<string, unknown> | undefined)?.operations,
            )
              ? (
                  (suggestion.patch as Record<string, unknown>).operations as Array<
                    Record<string, unknown>
                  >
                )
                  .slice(0, 6)
                  .map((operation) => ({
                    op: operation.op,
                    path: operation.path,
                    summary: operation.summary,
                  }))
              : [],
          dashboard: summarizeDashboardDocument(
            suggestion.dashboard as Record<string, unknown> | undefined,
          ),
        }
      : undefined,
    approval: record.approval,
    runtime_check: runtimeCheck,
    repair: record.repair,
  };
}

export function summarizeDashboardDocument(
  document: Record<string, unknown> | undefined,
) {
  if (!document) {
    return null;
  }

  const spec = document.dashboard_spec as Record<string, unknown> | undefined;
  const views = Array.isArray(spec?.views) ? spec.views : [];
  const queryDefs = Array.isArray(document.query_defs) ? document.query_defs : [];
  const bindings = Array.isArray(document.bindings) ? document.bindings : [];

  return {
    dashboard_name:
      (spec?.dashboard as Record<string, unknown> | undefined)?.name ?? null,
    view_count: views.length,
    view_ids: views
      .slice(0, 8)
      .map((view) => (view as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string"),
    query_count: queryDefs.length,
    binding_count: bindings.length,
  };
}
